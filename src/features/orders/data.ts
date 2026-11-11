import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor, OrderStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";

/**
 * Order reads and the append-only pieces around them (events, access
 * tokens). Orders are always fetched together with the identity that may see
 * them; nothing here returns an order by id alone to a caller that has not
 * proven ownership.
 */

type Tx = Prisma.TransactionClient;

export const orderItemSelect = {
  id: true,
  variantId: true,
  productSlug: true,
  productTitle: true,
  variantTitle: true,
  sku: true,
  quantity: true,
  unitPriceInPaise: true,
  lineTotalInPaise: true,
  imageUrl: true,
  imageAlt: true,
} satisfies Prisma.OrderItemSelect;

export const paymentAttemptSelect = {
  id: true,
  attemptNo: true,
  method: true,
  status: true,
  amountInPaise: true,
  receipt: true,
  providerOrderId: true,
  providerPaymentId: true,
  failureCode: true,
  failureDescription: true,
  createdAt: true,
} satisfies Prisma.PaymentSelect;

export const orderDetailSelect = {
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
  items: { select: orderItemSelect, orderBy: { productTitle: "asc" } },
  payments: { select: paymentAttemptSelect, orderBy: { attemptNo: "desc" } },
  events: {
    select: {
      id: true,
      type: true,
      actor: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.OrderSelect;

export type OrderDetailRow = Prisma.OrderGetPayload<{
  select: typeof orderDetailSelect;
}>;

export const orderSummarySelect = {
  id: true,
  orderNumber: true,
  status: true,
  paymentMethod: true,
  totalInPaise: true,
  createdAt: true,
  pendingExpiresAt: true,
  items: {
    select: {
      productTitle: true,
      quantity: true,
      imageUrl: true,
      imageAlt: true,
    },
    orderBy: { productTitle: "asc" },
  },
} satisfies Prisma.OrderSelect;

export type OrderSummaryRow = Prisma.OrderGetPayload<{
  select: typeof orderSummarySelect;
}>;

export function findOrderById(orderId: string, tx: Tx = db) {
  return tx.order.findUnique({
    where: { id: orderId },
    select: orderDetailSelect,
  });
}

export function findOrderForUser(userId: string, orderId: string, tx: Tx = db) {
  return tx.order.findFirst({
    where: { id: orderId, userId },
    select: orderDetailSelect,
  });
}

export function findOrderByNumberForUser(
  userId: string,
  orderNumber: string,
  tx: Tx = db,
) {
  return tx.order.findFirst({
    where: { orderNumber, userId },
    select: orderDetailSelect,
  });
}

export function listOrdersForUser(userId: string, tx: Tx = db) {
  return tx.order.findMany({
    where: { userId },
    select: orderSummarySelect,
    orderBy: { createdAt: "desc" },
  });
}

/** The order behind a live guest token, and the token row so it can be touched. */
export function findOrderByAccessTokenHash(
  tokenHash: string,
  now: Date,
  tx: Tx = db,
) {
  return tx.orderAccessToken.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
    select: {
      id: true,
      createdAt: true,
      order: { select: orderDetailSelect },
    },
  });
}

export function findOrderByNumberAndEmail(
  orderNumber: string,
  email: string,
  tx: Tx = db,
) {
  return tx.order.findFirst({
    where: { orderNumber, email },
    select: orderDetailSelect,
  });
}

/** A cart's order that is not cancelled (there is at most one, by index). */
export function findLiveOrderForCart(cartId: string, tx: Tx = db) {
  return tx.order.findFirst({
    where: { cartId, status: { not: "CANCELLED" } },
    select: { id: true, orderNumber: true, status: true, paymentMethod: true },
  });
}

/** Row lock on the order (lock order: carts → orders → …). */
export async function lockOrder(tx: Tx, orderId: string): Promise<void> {
  await tx.$executeRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
}

export function recordOrderEvent(
  tx: Tx,
  input: {
    orderId: string;
    type: string;
    actor: OrderActor;
    fromStatus?: OrderStatus | null;
    toStatus?: OrderStatus | null;
    note?: string | null;
    data?: Prisma.InputJsonValue;
  },
) {
  return tx.orderEvent.create({
    data: {
      orderId: input.orderId,
      type: input.type,
      actor: input.actor,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      note: input.note ?? null,
      data: input.data,
    },
    select: { id: true },
  });
}

/**
 * Issues a token. `createdAt` comes from the caller's clock, like the order
 * row it belongs to, so `expires_at > created_at` holds for any injected clock.
 */
export function createAccessToken(
  tx: Tx,
  input: {
    orderId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  },
) {
  return tx.orderAccessToken.create({ data: input, select: { id: true } });
}

export async function revokeOtherAccessTokens(
  tx: Tx,
  orderId: string,
  keepId: string,
  now: Date,
): Promise<number> {
  const result = await tx.orderAccessToken.updateMany({
    where: { orderId, id: { not: keepId }, revokedAt: null },
    data: { revokedAt: now },
  });
  return result.count;
}

export function touchAccessToken(id: string, now: Date, tx: Tx = db) {
  return tx.orderAccessToken.updateMany({
    where: { id },
    data: { lastUsedAt: now },
  });
}

/** Pending online orders whose deadline has passed (the expiry sweep's candidates). */
export function findExpiredPendingOrderIds(
  now: Date,
  limit: number,
  tx: Tx = db,
) {
  return tx.order.findMany({
    where: { status: "PENDING_PAYMENT", pendingExpiresAt: { lt: now } },
    select: { id: true },
    orderBy: { pendingExpiresAt: "asc" },
    take: limit,
  });
}
