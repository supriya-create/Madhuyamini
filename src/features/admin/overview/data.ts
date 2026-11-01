import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { requirePermission } from "../authz";

/**
 * Overview counts (docs/admin.md §5.1). Every number is a live query; the
 * page shows nothing it cannot count. Requires `admin.view` like every
 * admin read, so a forged or stale context gets nothing.
 */

export interface OverviewCounts {
  readonly awaitingFulfilment: number;
  readonly shipped: number;
  readonly deliveryFailed: number;
  readonly awaitingInspection: number;
  readonly needsReview: number;
  readonly pendingPayment: number;
  readonly lowStock: number;
  readonly failedNotifications: number;
  readonly failedWebhooks: number;
  readonly failedRefunds: number;
  readonly ordersToday: number;
  readonly revenueTodayInPaise: number;
  readonly revenueWeekInPaise: number;
  readonly revealsThisWeek: number;
}

function startOfToday(now: Date): Date {
  // Calendar day in the store's timezone (India), independent of the server's.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${parts}T00:00:00+05:30`);
}

/** Same definition as the reports: confirmed or beyond with a captured (or collected) payment. */
async function paidSince(
  tx: Prisma.TransactionClient,
  since: Date,
): Promise<{ orders: number; grossInPaise: number }> {
  const [row] = await tx.$queryRaw<Array<{ orders: number; gross: bigint }>>`
    SELECT count(*)::int AS orders, coalesce(sum(o.total_in_paise), 0)::bigint AS gross
      FROM orders o
     WHERE o.status IN ('CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED')
       AND o.created_at >= ${since}
       AND EXISTS (
         SELECT 1 FROM payments p
          WHERE p.order_id = o.id AND p.status IN ('CAPTURED', 'REFUNDED')
       )
  `;
  return { orders: row?.orders ?? 0, grossInPaise: Number(row?.gross ?? 0) };
}

export async function loadOverview(
  ctx: StaffContext,
  now = new Date(),
  tx: Prisma.TransactionClient = db,
): Promise<OverviewCounts> {
  await requirePermission(ctx, "admin.view", { tx });
  const today = startOfToday(now);
  const weekAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000); // policy-literal-ok: seven calendar days
  const [
    awaitingFulfilment,
    shipped,
    deliveryFailed,
    awaitingInspection,
    needsReview,
    pendingPayment,
    lowStockRows,
    failedNotifications,
    failedWebhooks,
    failedRefunds,
    todayAggregate,
    weekAggregate,
    revealsThisWeek,
  ] = await Promise.all([
    tx.order.count({ where: { status: { in: ["CONFIRMED", "PROCESSING"] } } }),
    tx.order.count({ where: { status: "SHIPPED" } }),
    tx.order.count({ where: { status: "DELIVERY_FAILED" } }),
    tx.order.count({ where: { status: "RETURNED" } }),
    tx.order.count({ where: { status: "NEEDS_REVIEW" } }),
    tx.order.count({ where: { status: "PENDING_PAYMENT" } }),
    tx.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM inventory i
      JOIN product_variants v ON v.id = i.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE v.is_active AND p.status = 'ACTIVE'
        AND i.stock_on_hand - i.reserved <= i.low_stock_threshold
    `,
    tx.notificationOutbox.count({ where: { status: "FAILED" } }),
    tx.paymentWebhookEvent.count({ where: { status: "FAILED" } }),
    tx.refund.count({ where: { status: "FAILED" } }),
    paidSince(tx, today),
    paidSince(tx, weekAgo),
    tx.staffPiiReveal.count({ where: { createdAt: { gte: weekAgo } } }),
  ]);
  return {
    awaitingFulfilment,
    shipped,
    deliveryFailed,
    awaitingInspection,
    needsReview,
    pendingPayment,
    lowStock: lowStockRows[0]?.count ?? 0,
    failedNotifications,
    failedWebhooks,
    failedRefunds,
    ordersToday: todayAggregate.orders,
    revenueTodayInPaise: todayAggregate.grossInPaise,
    revenueWeekInPaise: weekAggregate.grossInPaise,
    revealsThisWeek,
  };
}
