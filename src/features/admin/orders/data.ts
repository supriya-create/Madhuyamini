import "server-only";

import { getAdminPolicy } from "@/config/admin-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/enums";
import { normalizeOrderNumber } from "@/features/orders/order-number";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { actorFromContext, writeAudit } from "../audit";
import { requirePermission } from "../authz";

/**
 * Admin order reads (docs/admin.md §5.4). Every function takes a live
 * StaffContext and checks `admin.view`; nothing here returns a row to a
 * caller that has not passed the gate.
 */

type Tx = Prisma.TransactionClient;

export interface OrderListFilters {
  readonly status: OrderStatus | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly from: Date | null;
  /** Exclusive upper bound. */
  readonly to: Date | null;
  readonly q: string | null;
  readonly page: number;
}

export const adminOrderListSelect = {
  id: true,
  orderNumber: true,
  status: true,
  paymentMethod: true,
  totalInPaise: true,
  createdAt: true,
  email: true,
  recipientName: true,
  city: true,
  items: { select: { quantity: true } },
  payments: {
    select: { status: true, method: true },
    orderBy: { attemptNo: "desc" },
    take: 1,
  },
  shipment: { select: { carrier: true, shippedAt: true } },
} satisfies Prisma.OrderSelect;

export type AdminOrderListRow = Prisma.OrderGetPayload<{
  select: typeof adminOrderListSelect;
}>;

function whereFor(filters: OrderListFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.paymentMethod) where.paymentMethod = filters.paymentMethod;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lt: filters.to } : {}),
    };
  }
  const q = filters.q?.trim();
  if (q) {
    const orderNumber = normalizeOrderNumber(q);
    if (orderNumber) where.orderNumber = orderNumber;
    else if (q.includes("@")) where.email = q.toLowerCase();
    else where.recipientName = { contains: q, mode: "insensitive" };
  }
  return where;
}

export interface OrderListPage {
  readonly rows: AdminOrderListRow[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly pageSize: number;
}

export async function listOrders(
  ctx: StaffContext,
  filters: OrderListFilters,
  tx: Tx = db,
): Promise<OrderListPage> {
  await requirePermission(ctx, "admin.view", { tx });
  const pageSize = getAdminPolicy().lists.pageSize;
  const where = whereFor(filters);
  const total = await tx.order.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  const rows = await tx.order.findMany({
    where,
    select: adminOrderListSelect,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { rows, total, page, pageCount, pageSize };
}

export const adminOrderDetailSelect = {
  id: true,
  orderNumber: true,
  userId: true,
  email: true,
  phone: true,
  status: true,
  paymentMethod: true,
  currency: true,
  subtotalInPaise: true,
  shippingInPaise: true,
  codFeeInPaise: true,
  discountInPaise: true,
  totalInPaise: true,
  taxInPaise: true,
  recipientName: true,
  addressLine1: true,
  addressLine2: true,
  landmark: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  customerNote: true,
  cartId: true,
  pendingExpiresAt: true,
  deadlineExtensions: true,
  confirmedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      variantId: true,
      productSlug: true,
      productTitle: true,
      variantTitle: true,
      sku: true,
      quantity: true,
      unitPriceInPaise: true,
      lineTotalInPaise: true,
    },
    orderBy: { productTitle: "asc" },
  },
  payments: {
    select: {
      id: true,
      attemptNo: true,
      method: true,
      status: true,
      amountInPaise: true,
      receipt: true,
      providerOrderId: true,
      providerPaymentId: true,
      signatureVerifiedAt: true,
      authorizedAt: true,
      capturedAt: true,
      failedAt: true,
      failureCode: true,
      failureDescription: true,
      createdAt: true,
    },
    orderBy: { attemptNo: "desc" },
  },
  refunds: {
    select: {
      id: true,
      paymentId: true,
      status: true,
      amountInPaise: true,
      reason: true,
      reference: true,
      providerRefundId: true,
      attempts: true,
      lastError: true,
      requestedAt: true,
      processedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  reservations: {
    select: {
      id: true,
      variantId: true,
      quantity: true,
      status: true,
      expiresAt: true,
      closedAt: true,
    },
    orderBy: { variantId: "asc" },
  },
  events: {
    select: {
      id: true,
      type: true,
      actor: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      data: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  shipment: {
    select: {
      id: true,
      carrier: true,
      trackingNumber: true,
      trackingUrl: true,
      shippedAt: true,
      deliveredAt: true,
      deliveryFailedAt: true,
      deliveryFailureReason: true,
      returnedAt: true,
      inspectedAt: true,
      inspectionNote: true,
      carrierClaimReference: true,
    },
  },
} satisfies Prisma.OrderSelect;

export type AdminOrderDetailRow = Prisma.OrderGetPayload<{
  select: typeof adminOrderDetailSelect;
}>;

export interface AdminOrderDetailBundle {
  readonly order: AdminOrderDetailRow;
  readonly adjustments: Array<{
    id: string;
    variantId: string;
    kind: string;
    delta: number;
    stockBefore: number;
    stockAfter: number;
    reason: string;
    createdAt: Date;
  }>;
  readonly audit: Array<{
    id: string;
    actorLabel: string;
    actorRole: string | null;
    action: string;
    outcome: string;
    reason: string | null;
    errorCode: string | null;
    createdAt: Date;
  }>;
}

export async function findOrderDetail(
  ctx: StaffContext,
  orderId: string,
  tx: Tx = db,
): Promise<AdminOrderDetailBundle | null> {
  await requirePermission(ctx, "admin.view", { tx });
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: adminOrderDetailSelect,
  });
  if (!order) return null;
  const [adjustments, audit] = await Promise.all([
    tx.inventoryAdjustment.findMany({
      where: { orderId },
      select: {
        id: true,
        variantId: true,
        kind: true,
        delta: true,
        stockBefore: true,
        stockAfter: true,
        reason: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    tx.adminAuditLog.findMany({
      where: { targetType: "order", targetId: orderId },
      select: {
        id: true,
        actorLabel: true,
        actorRole: true,
        action: true,
        outcome: true,
        reason: true,
        errorCode: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return { order, adjustments, audit };
}

/**
 * Operational address access is logged once per staff member and order
 * (docs/admin.md §5.7); a second visit by the same person adds no row.
 */
export async function recordAddressView(
  ctx: StaffContext,
  orderId: string,
  tx: Tx = db,
): Promise<void> {
  await requirePermission(ctx, "admin.view", { tx });
  const seen = await tx.adminAuditLog.findFirst({
    where: {
      actorId: ctx.user.id,
      action: "order.address.view",
      targetType: "order",
      targetId: orderId,
    },
    select: { id: true },
  });
  if (seen) return;
  await writeAudit(
    {
      actor: actorFromContext(ctx),
      action: "order.address.view",
      targetType: "order",
      targetId: orderId,
      outcome: "SUCCESS",
    },
    tx,
  );
}

/** The facts every order mutation re-reads under the order lock. */
export const orderActionSelect = {
  id: true,
  orderNumber: true,
  status: true,
  paymentMethod: true,
  email: true,
  totalInPaise: true,
  items: {
    select: { id: true, variantId: true, quantity: true, sku: true },
    orderBy: { variantId: "asc" },
  },
  payments: {
    select: {
      id: true,
      attemptNo: true,
      method: true,
      status: true,
      amountInPaise: true,
    },
    orderBy: { attemptNo: "desc" },
  },
  shipment: {
    select: { id: true, deliveryFailureReason: true, shippedAt: true },
  },
} satisfies Prisma.OrderSelect;

export type OrderActionRow = Prisma.OrderGetPayload<{
  select: typeof orderActionSelect;
}>;
