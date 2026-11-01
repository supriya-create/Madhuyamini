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
  | "partial_refund";

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

/** Captured online attempts of an order minus what was already queued or refunded. */
export async function refundableAttempts(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<
  Array<{
    id: string;
    attemptNo: number;
    amountInPaise: number;
    refundedInPaise: number;
    refundCount: number;
  }>
> {
  const attempts = await tx.payment.findMany({
    where: { orderId, method: "RAZORPAY", status: "CAPTURED" },
    select: {
      id: true,
      attemptNo: true,
      amountInPaise: true,
      refunds: {
        where: { status: { not: "FAILED" } },
        select: { amountInPaise: true },
      },
    },
    orderBy: { attemptNo: "asc" },
  });
  return attempts.map((attempt) => ({
    id: attempt.id,
    attemptNo: attempt.attemptNo,
    amountInPaise: attempt.amountInPaise,
    refundedInPaise: attempt.refunds.reduce(
      (sum, r) => sum + r.amountInPaise,
      0,
    ),
    refundCount: attempt.refunds.length,
  }));
}
