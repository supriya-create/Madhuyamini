import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/generated/prisma/enums";
import * as orders from "@/features/orders/data";
import {
  enqueueNotification,
  enqueueOpsAlert,
} from "@/server/notifications/outbox";

/**
 * Refund intents (docs/checkout.md §9, docs/admin.md §5.5). A row in
 * `refunds` is the only way money goes back: the `refund-payments` job
 * executes it with the provider, retries, and records the outcome. Callers
 * hold the order lock. Idempotent by `reference`.
 */

export type RefundReason =
  | "late_capture_no_stock"
  | "duplicate_payment"
  | "cancelled_by_shop"
  | "review_cancelled"
  | "delivery_failed"
  | "carrier_lost"
  | "shop_refund";

export interface RefundIntentInput {
  readonly order: {
    readonly id: string;
    readonly orderNumber: string;
    readonly email: string;
  };
  readonly attempt: { readonly id: string; readonly attemptNo: number };
  readonly amountInPaise: number;
  readonly actor: OrderActor;
  readonly reason: RefundReason;
  /** Distinguishes several refunds of one attempt (partial refunds). */
  readonly sequence?: number;
}

export async function queueRefundIntent(
  tx: Prisma.TransactionClient,
  input: RefundIntentInput,
): Promise<{ reference: string; created: boolean }> {
  const reference =
    input.sequence && input.sequence > 1
      ? `${input.order.orderNumber}-R${input.attempt.attemptNo}-${input.sequence}`
      : `${input.order.orderNumber}-R${input.attempt.attemptNo}`;
  const result = await tx.refund.createMany({
    data: [
      {
        orderId: input.order.id,
        paymentId: input.attempt.id,
        amountInPaise: input.amountInPaise,
        reason: input.reason,
        reference,
      },
    ],
    skipDuplicates: true,
  });
  if (result.count === 0) return { reference, created: false };
  await orders.recordOrderEvent(tx, {
    orderId: input.order.id,
    type: "refund.requested",
    actor: input.actor,
    data: {
      reference,
      amountInPaise: input.amountInPaise,
      reason: input.reason,
    },
  });
  await enqueueNotification(tx, {
    kind: "order.refund_requested",
    orderId: input.order.id,
    recipient: input.order.email,
    dedupeKey: `order.refund_requested:${reference}`,
    payload: {
      orderId: input.order.id,
      orderNumber: input.order.orderNumber,
      amountInPaise: input.amountInPaise,
      reason: input.reason,
    },
  });
  await enqueueOpsAlert(tx, {
    key: `refund:${reference}`,
    orderId: input.order.id,
    payload: {
      orderId: input.order.id,
      orderNumber: input.order.orderNumber,
      reason: input.reason,
      amountInPaise: input.amountInPaise,
    },
  });
  return { reference, created: true };
}

/**
 * What the provider actually captured for an attempt: the amount recorded on
 * the `payment.captured` event (a mismatch keeps the attempt's own amount
 * untouched), falling back to the attempt amount.
 */
export async function capturedAmountInPaise(
  tx: Prisma.TransactionClient,
  orderId: string,
  attempt: { readonly attemptNo: number; readonly amountInPaise: number },
): Promise<number> {
  const event = await tx.orderEvent.findFirst({
    where: {
      orderId,
      type: "payment.captured",
      data: { path: ["attemptNo"], equals: attempt.attemptNo },
    },
    orderBy: { createdAt: "desc" },
    select: { data: true },
  });
  const data = event?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const amount = (data as Record<string, unknown>).amountInPaise;
    if (typeof amount === "number" && Number.isInteger(amount)) return amount;
  }
  return attempt.amountInPaise;
}

/** Captured online attempts of an order minus what was already queued or refunded. */
export async function refundableAttempts(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<
  Array<{
    id: string;
    attemptNo: number;
    /** Captured at the provider (evidence), not the amount asked for. */
    amountInPaise: number;
    refundedInPaise: number;
    refundCount: number;
  }>
> {
  const attempts = await tx.payment.findMany({
    where: {
      orderId,
      method: "RAZORPAY",
      status: { in: ["CAPTURED", "REFUNDED"] },
    },
    select: {
      id: true,
      attemptNo: true,
      amountInPaise: true,
      refunds: {
        where: { status: { not: "FAILED" } },
        select: { amountInPaise: true },
      },
      // Every refund row, failed ones included: references must never collide.
      _count: { select: { refunds: true } },
    },
    orderBy: { attemptNo: "asc" },
  });
  const result = [];
  for (const attempt of attempts) {
    result.push({
      id: attempt.id,
      attemptNo: attempt.attemptNo,
      amountInPaise: await capturedAmountInPaise(tx, orderId, attempt),
      refundedInPaise: attempt.refunds.reduce(
        (sum, r) => sum + r.amountInPaise,
        0,
      ),
      refundCount: attempt._count.refunds,
    });
  }
  return result;
}

/**
 * After a refund is processed: the attempt becomes REFUNDED only once the
 * processed refunds cover what was captured, so partial refunds leave it
 * CAPTURED and further refunds possible (docs/admin.md §5.5).
 */
export async function settleAttemptIfFullyRefunded(
  tx: Prisma.TransactionClient,
  paymentId: string,
): Promise<boolean> {
  const attempt = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      orderId: true,
      attemptNo: true,
      amountInPaise: true,
      status: true,
      refunds: {
        where: { status: "PROCESSED" },
        select: { amountInPaise: true },
      },
    },
  });
  if (!attempt || attempt.status !== "CAPTURED") return false;
  const captured = await capturedAmountInPaise(tx, attempt.orderId, attempt);
  const refunded = attempt.refunds.reduce((sum, r) => sum + r.amountInPaise, 0);
  if (refunded < captured) return false;
  const result = await tx.payment.updateMany({
    where: { id: paymentId, status: "CAPTURED" },
    data: { status: "REFUNDED" },
  });
  return result.count === 1;
}
