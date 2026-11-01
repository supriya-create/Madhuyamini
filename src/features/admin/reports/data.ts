import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { requirePermission } from "../authz";
import type { ReportWindow } from "./schemas";

/**
 * Report queries (docs/admin.md §5.8): parameterised SQL over the order,
 * payment, refund and inventory tables. Revenue = `total_in_paise` of
 * orders in CONFIRMED, PROCESSING, SHIPPED or DELIVERED with a captured
 * attempt (online) or collected cash (COD), minus processed refunds.
 */

type Tx = Prisma.TransactionClient;

const PAID_ORDER = Prisma.sql`
  o.status IN ('CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED')
  AND EXISTS (
    SELECT 1 FROM payments p
     WHERE p.order_id = o.id AND p.status IN ('CAPTURED', 'REFUNDED')
  )
`;

function bucketExpression(granularity: ReportWindow["granularity"]) {
  const unit =
    granularity === "week" ? "week" : granularity === "month" ? "month" : "day";
  return Prisma.sql`to_char(date_trunc(${unit}, o.created_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`;
}

export interface SalesRow {
  readonly bucket: string;
  readonly method: string;
  readonly orders: number;
  readonly units: number;
  readonly grossInPaise: number;
}

export async function salesByPeriod(
  ctx: StaffContext,
  window: ReportWindow,
  tx: Tx = db,
): Promise<SalesRow[]> {
  await requirePermission(ctx, "reports.view", { tx });
  const rows = await tx.$queryRaw<
    Array<{
      bucket: string;
      method: string;
      orders: number;
      units: number;
      gross: bigint;
    }>
  >(Prisma.sql`
    SELECT ${bucketExpression(window.granularity)} AS bucket,
           o.payment_method::text AS method,
           count(*)::int AS orders,
           coalesce(sum(items.units), 0)::int AS units,
           coalesce(sum(o.total_in_paise), 0)::bigint AS gross
      FROM orders o
      JOIN LATERAL (
        SELECT coalesce(sum(quantity), 0)::int AS units FROM order_items WHERE order_id = o.id
      ) items ON true
     WHERE ${PAID_ORDER}
       AND o.created_at >= ${window.from} AND o.created_at < ${window.to}
     GROUP BY 1, 2
     ORDER BY 1, 2
  `);
  return rows.map((row) => ({
    bucket: row.bucket,
    method: row.method,
    orders: row.orders,
    units: row.units,
    grossInPaise: Number(row.gross),
  }));
}

export interface SalesTotals {
  readonly orders: number;
  readonly units: number;
  readonly grossInPaise: number;
  readonly refundedInPaise: number;
  readonly cancelledOrders: number;
  readonly cancelledInPaise: number;
  readonly averageOrderInPaise: number;
}

export async function salesTotals(
  ctx: StaffContext,
  window: ReportWindow,
  tx: Tx = db,
): Promise<SalesTotals> {
  await requirePermission(ctx, "reports.view", { tx });
  const [paid] = await tx.$queryRaw<
    Array<{ orders: number; units: number; gross: bigint }>
  >(Prisma.sql`
    SELECT count(*)::int AS orders,
           coalesce(sum(items.units), 0)::int AS units,
           coalesce(sum(o.total_in_paise), 0)::bigint AS gross
      FROM orders o
      JOIN LATERAL (
        SELECT coalesce(sum(quantity), 0)::int AS units FROM order_items WHERE order_id = o.id
      ) items ON true
     WHERE ${PAID_ORDER}
       AND o.created_at >= ${window.from} AND o.created_at < ${window.to}
  `);
  const [refunds] = await tx.$queryRaw<Array<{ refunded: bigint }>>(Prisma.sql`
    SELECT coalesce(sum(amount_in_paise), 0)::bigint AS refunded
      FROM refunds
     WHERE status = 'PROCESSED' AND processed_at >= ${window.from} AND processed_at < ${window.to}
  `);
  const [cancelled] = await tx.$queryRaw<
    Array<{ orders: number; amount: bigint }>
  >(Prisma.sql`
    SELECT count(*)::int AS orders, coalesce(sum(total_in_paise), 0)::bigint AS amount
      FROM orders
     WHERE status = 'CANCELLED' AND cancelled_at >= ${window.from} AND cancelled_at < ${window.to}
  `);
  const orders = paid?.orders ?? 0;
  const gross = Number(paid?.gross ?? 0);
  return {
    orders,
    units: paid?.units ?? 0,
    grossInPaise: gross,
    refundedInPaise: Number(refunds?.refunded ?? 0),
    cancelledOrders: cancelled?.orders ?? 0,
    cancelledInPaise: Number(cancelled?.amount ?? 0),
    averageOrderInPaise: orders === 0 ? 0 : Math.round(gross / orders),
  };
}

export interface ProductRow {
  readonly productTitle: string;
  readonly sku: string;
  readonly units: number;
  readonly revenueInPaise: number;
}

export async function productsReport(
  ctx: StaffContext,
  window: ReportWindow,
  tx: Tx = db,
): Promise<ProductRow[]> {
  await requirePermission(ctx, "reports.view", { tx });
  const rows = await tx.$queryRaw<
    Array<{
      product_title: string;
      sku: string;
      units: number;
      revenue: bigint;
    }>
  >(Prisma.sql`
    SELECT oi.product_title, oi.sku,
           coalesce(sum(oi.quantity), 0)::int AS units,
           coalesce(sum(oi.line_total_in_paise), 0)::bigint AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
     WHERE ${PAID_ORDER}
       AND o.created_at >= ${window.from} AND o.created_at < ${window.to}
     GROUP BY 1, 2
     ORDER BY revenue DESC, units DESC
     LIMIT 200
  `);
  return rows.map((row) => ({
    productTitle: row.product_title,
    sku: row.sku,
    units: row.units,
    revenueInPaise: Number(row.revenue),
  }));
}

export interface InventorySummary {
  readonly variants: number;
  readonly onHand: number;
  readonly reserved: number;
  readonly valueInPaise: number;
  readonly lowStock: number;
  readonly adjustments: ReadonlyArray<{
    kind: string;
    count: number;
    units: number;
  }>;
}

export async function inventoryReport(
  ctx: StaffContext,
  window: ReportWindow,
  tx: Tx = db,
): Promise<InventorySummary> {
  await requirePermission(ctx, "reports.view", { tx });
  const [levels] = await tx.$queryRaw<
    Array<{
      variants: number;
      on_hand: number;
      reserved: number;
      value: bigint;
      low: number;
    }>
  >(Prisma.sql`
    SELECT count(*)::int AS variants,
           coalesce(sum(i.stock_on_hand), 0)::int AS on_hand,
           coalesce(sum(i.reserved), 0)::int AS reserved,
           coalesce(sum((i.stock_on_hand - i.reserved) * v.price_in_paise), 0)::bigint AS value,
           count(*) FILTER (WHERE i.stock_on_hand - i.reserved <= i.low_stock_threshold)::int AS low
      FROM inventory i
      JOIN product_variants v ON v.id = i.variant_id
      JOIN products p ON p.id = v.product_id
     WHERE v.is_active AND p.status = 'ACTIVE'
  `);
  const adjustments = await tx.$queryRaw<
    Array<{ kind: string; count: number; units: number }>
  >(Prisma.sql`
    SELECT kind::text AS kind, count(*)::int AS count, coalesce(sum(delta), 0)::int AS units
      FROM inventory_adjustments
     WHERE created_at >= ${window.from} AND created_at < ${window.to}
     GROUP BY 1 ORDER BY 1
  `);
  return {
    variants: levels?.variants ?? 0,
    onHand: levels?.on_hand ?? 0,
    reserved: levels?.reserved ?? 0,
    valueInPaise: Number(levels?.value ?? 0),
    lowStock: levels?.low ?? 0,
    adjustments,
  };
}

export interface OperationsSummary {
  readonly attemptsByStatus: ReadonlyArray<{ status: string; count: number }>;
  readonly successRatePercent: number | null;
  readonly averageMinutesToCapture: number | null;
  readonly lateCaptures: number;
  readonly refundsByStatus: ReadonlyArray<{
    status: string;
    count: number;
    amountInPaise: number;
  }>;
  readonly failedNotifications: number;
  readonly failedWebhooks: number;
  readonly deliveryFailures: number;
}

export async function operationsReport(
  ctx: StaffContext,
  window: ReportWindow,
  tx: Tx = db,
): Promise<OperationsSummary> {
  await requirePermission(ctx, "reports.view", { tx });
  const attempts = await tx.$queryRaw<
    Array<{ status: string; count: number }>
  >(Prisma.sql`
    SELECT status::text AS status, count(*)::int AS count
      FROM payments
     WHERE method = 'RAZORPAY' AND created_at >= ${window.from} AND created_at < ${window.to}
     GROUP BY 1 ORDER BY 1
  `);
  const issued = attempts
    .filter((a) => a.status !== "INITIATED")
    .reduce((sum, a) => sum + a.count, 0);
  const captured = attempts
    .filter((a) => a.status === "CAPTURED" || a.status === "REFUNDED")
    .reduce((sum, a) => sum + a.count, 0);
  const [timing] = await tx.$queryRaw<
    Array<{ minutes: number | null }>
  >(Prisma.sql`
    SELECT avg(extract(epoch FROM (p.captured_at - o.created_at)) / 60)::float AS minutes
      FROM payments p JOIN orders o ON o.id = p.order_id
     WHERE p.captured_at IS NOT NULL AND p.method = 'RAZORPAY'
       AND o.created_at >= ${window.from} AND o.created_at < ${window.to}
  `);
  const [late] = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT count(*)::int AS count FROM order_events
     WHERE type = 'payment.late_capture' AND created_at >= ${window.from} AND created_at < ${window.to}
  `);
  const refunds = await tx.$queryRaw<
    Array<{ status: string; count: number; amount: bigint }>
  >(Prisma.sql`
    SELECT status::text AS status, count(*)::int AS count, coalesce(sum(amount_in_paise), 0)::bigint AS amount
      FROM refunds
     WHERE created_at >= ${window.from} AND created_at < ${window.to}
     GROUP BY 1 ORDER BY 1
  `);
  const [failedNotifications, failedWebhooks, deliveryFailures] =
    await Promise.all([
      tx.notificationOutbox.count({
        where: {
          status: "FAILED",
          createdAt: { gte: window.from, lt: window.to },
        },
      }),
      tx.paymentWebhookEvent.count({
        where: {
          status: "FAILED",
          receivedAt: { gte: window.from, lt: window.to },
        },
      }),
      tx.shipment.count({
        where: { deliveryFailedAt: { gte: window.from, lt: window.to } },
      }),
    ]);
  return {
    attemptsByStatus: attempts,
    successRatePercent:
      issued === 0 ? null : Math.round((captured / issued) * 1000) / 10, // policy-literal-ok: one decimal place
    averageMinutesToCapture:
      timing?.minutes === null || timing?.minutes === undefined
        ? null
        : Math.round(timing.minutes * 10) / 10,
    lateCaptures: late?.count ?? 0,
    refundsByStatus: refunds.map((r) => ({
      status: r.status,
      count: r.count,
      amountInPaise: Number(r.amount),
    })),
    failedNotifications,
    failedWebhooks,
    deliveryFailures,
  };
}
