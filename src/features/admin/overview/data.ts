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

export async function loadOverview(
  ctx: StaffContext,
  now = new Date(),
  tx: Prisma.TransactionClient = db,
): Promise<OverviewCounts> {
  await requirePermission(ctx, "admin.view", { tx });
  const today = startOfToday(now);
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
    tx.order.aggregate({
      where: {
        createdAt: { gte: today },
        status: { in: ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"] },
      },
      _count: { _all: true },
      _sum: { totalInPaise: true },
    }),
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
    ordersToday: todayAggregate._count._all,
    revenueTodayInPaise: todayAggregate._sum.totalInPaise ?? 0,
  };
}
