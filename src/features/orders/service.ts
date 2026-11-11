import "server-only";

import {
  daysToMs,
  getCheckoutPolicy,
  minutesToMs,
} from "@/config/checkout-policy";
import { releaseOrderHolds } from "@/features/inventory/service";
import { AppError, NotFoundError } from "@/server/errors";
import type { OrderAccess } from "@/server/orders/context";
import {
  generateOrderAccessToken,
  hashOrderAccessToken,
} from "@/server/orders/token";
import { db } from "@/server/db";

import * as data from "./data";
import type { OrderDetailRow, OrderSummaryRow } from "./data";
import { normalizeOrderNumber } from "./order-number";
import { nextOrderStatus } from "./transitions";
import type { OrderDetailView, OrderSummaryView } from "./types";
import { toOrderDetailView, toOrderSummaryView } from "./types";

/**
 * Order access and customer-side operations (docs/checkout.md §7, §10.1).
 * Every read goes through `findAccessibleOrder`, which couples the order with
 * the identity allowed to see it.
 */

export interface AccessibleOrder {
  readonly row: OrderDetailRow;
  /** Guests see a reduced address after the first hour; owners see everything. */
  readonly exposure: "full" | "reduced";
}

export async function findAccessibleOrder(
  access: OrderAccess,
  orderId: string,
  now = new Date(),
): Promise<AccessibleOrder | null> {
  if (access.kind === "user") {
    const row = await data.findOrderForUser(access.userId, orderId);
    return row ? { row, exposure: "full" } : null;
  }
  if (access.kind === "guest") {
    const token = await data.findOrderByAccessTokenHash(access.tokenHash, now);
    if (!token || token.order.id !== orderId) return null;
    await data.touchAccessToken(token.id, now);
    const policy = getCheckoutPolicy();
    const fullUntil =
      token.order.createdAt.getTime() +
      minutesToMs(policy.guestAccess.fullDetailMinutes);
    return {
      row: token.order,
      exposure: now.getTime() <= fullUntil ? "full" : "reduced",
    };
  }
  return null;
}

export async function getOrderView(
  access: OrderAccess,
  orderId: string,
  now = new Date(),
): Promise<OrderDetailView | null> {
  const found = await findAccessibleOrder(access, orderId, now);
  return found ? toOrderDetailView(found.row, found.exposure, now) : null;
}

export async function getOrderViewByNumber(
  userId: string,
  orderNumber: string,
  now = new Date(),
): Promise<OrderDetailView | null> {
  const normalized = normalizeOrderNumber(orderNumber);
  if (!normalized) return null;
  const row = await data.findOrderByNumberForUser(userId, normalized);
  return row ? toOrderDetailView(row, "full", now) : null;
}

export async function listOrderSummaries(
  userId: string,
): Promise<OrderSummaryView[]> {
  const rows: OrderSummaryRow[] = await data.listOrdersForUser(userId);
  return rows.map(toOrderSummaryView);
}

export class OrderNotCancellableError extends AppError {
  constructor() {
    super("This order can no longer be cancelled here.", {
      code: "ORDER_NOT_CANCELLABLE",
      status: 409,
    });
  }
}

/** T7: a customer abandons a pending online order; stock goes back, the cart stays. */
export async function cancelPendingOrder(
  access: OrderAccess,
  orderId: string,
  now = new Date(),
): Promise<void> {
  const found = await findAccessibleOrder(access, orderId, now);
  if (!found) throw new NotFoundError("Order");

  await db.$transaction(async (tx) => {
    await data.lockOrder(tx, orderId);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!order) throw new NotFoundError("Order");
    const next = nextOrderStatus(order.status, "customer_cancelled");
    if (next !== "CANCELLED") throw new OrderNotCancellableError();

    const released = await releaseOrderHolds(tx, orderId, now, "RELEASED");
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancellationReason: "CUSTOMER",
        cancelledAt: now,
      },
    });
    await data.recordOrderEvent(tx, {
      orderId,
      type: "order.cancelled",
      actor: "CUSTOMER",
      fromStatus: order.status,
      toStatus: "CANCELLED",
      note: `Cancelled by the customer; ${released} unit(s) released.`,
    });
  });
}

/**
 * Guest lookup by order number and email (T15). Issues a fresh token and
 * revokes the others; returns null for any unknown pair.
 */
export async function trackOrder(
  input: { orderNumber: string; email: string },
  now = new Date(),
): Promise<{ orderId: string; token: string } | null> {
  const orderNumber = normalizeOrderNumber(input.orderNumber);
  if (!orderNumber) return null;
  const order = await data.findOrderByNumberAndEmail(
    orderNumber,
    input.email.trim().toLowerCase(),
  );
  if (!order) return null;

  const policy = getCheckoutPolicy();
  const token = generateOrderAccessToken();
  await db.$transaction(async (tx) => {
    await data.lockOrder(tx, order.id);
    const created = await data.createAccessToken(tx, {
      orderId: order.id,
      tokenHash: hashOrderAccessToken(token),
      expiresAt: new Date(
        now.getTime() + daysToMs(policy.guestAccess.tokenTtlDays),
      ),
      createdAt: now,
    });
    await data.revokeOtherAccessTokens(tx, order.id, created.id, now);
    await data.recordOrderEvent(tx, {
      orderId: order.id,
      type: "access.token_rotated",
      actor: "CUSTOMER",
    });
  });
  return { orderId: order.id, token };
}
