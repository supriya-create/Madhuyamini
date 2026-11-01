import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor, OrderStatus } from "@/generated/prisma/enums";
import {
  consumeOrderHolds,
  tryCommitForOrder,
} from "@/features/inventory/service";
import * as orders from "@/features/orders/data";
import { nextOrderStatus } from "@/features/orders/transitions";
import {
  enqueueOpsAlert,
  enqueueOrderConfirmed,
} from "@/server/notifications/outbox";
import { db } from "@/server/db";

import * as data from "./data";
import { queueRefundIntent } from "./refunds";

/**
 * Applying provider facts to our records: transaction T5 (capture) and T6
 * (failure) of docs/checkout.md §5.5. Both take the facts as parameters and
 * never call the provider. Both are idempotent: a repeated capture or failure
 * for the same attempt changes nothing.
 */

export interface CaptureFacts {
  readonly attemptId: string;
  readonly providerPaymentId: string;
  readonly amountInPaise: number;
  readonly currency: string;
  readonly actor: OrderActor;
  readonly signatureVerified: boolean;
  readonly now: Date;
}

export type CaptureOutcome =
  /** Order confirmed by this capture. */
  | "confirmed"
  /** Nothing to do: the attempt was already captured. */
  | "already_captured"
  /** Captured amount or currency differs from the order: held for review. */
  | "mismatch"
  /** Paid after the deadline cancelled the order; stock re-secured. */
  | "late_confirmed"
  /** Paid after cancellation and the stock is gone: refund queued. */
  | "refund_queued"
  /** A second capture on an already confirmed order: refund queued. */
  | "duplicate_refund_queued"
  /** The attempt is not in a state that can be captured (never issued a provider order). */
  | "not_applicable";

export async function applyCapture(
  facts: CaptureFacts,
): Promise<CaptureOutcome> {
  return db.$transaction(async (tx) => {
    const attempt = await data.findAttempt(facts.attemptId, tx);
    if (!attempt) return "not_applicable";
    await orders.lockOrder(tx, attempt.orderId);
    // Re-read under the lock: everything below trusts only this state.
    const current = await data.findAttempt(facts.attemptId, tx);
    const order = await tx.order.findUnique({
      where: { id: attempt.orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        email: true,
        cartId: true,
        totalInPaise: true,
        currency: true,
        items: { select: { variantId: true, quantity: true } },
      },
    });
    if (!current || !order) return "not_applicable";
    if (current.status === "CAPTURED" || current.status === "REFUNDED")
      return "already_captured";
    if (current.status === "INITIATED") return "not_applicable";

    const captured = await data.markAttemptCaptured(tx, current.id, {
      providerPaymentId: facts.providerPaymentId,
      now: facts.now,
      signatureVerified: facts.signatureVerified,
    });
    if (!captured) return "already_captured";
    await orders.recordOrderEvent(tx, {
      orderId: order.id,
      type: "payment.captured",
      actor: facts.actor,
      data: {
        attemptNo: current.attemptNo,
        amountInPaise: facts.amountInPaise,
        currency: facts.currency,
      },
    });

    const amountsMatch =
      facts.amountInPaise === order.totalInPaise &&
      facts.currency === order.currency;

    if (!amountsMatch) {
      return holdForReview(tx, order, facts, current.attemptNo, {
        reason: "amount_mismatch",
        note: `Captured ${facts.amountInPaise} ${facts.currency}, order total ${order.totalInPaise} ${order.currency}.`,
      });
    }

    if (order.status === "PENDING_PAYMENT") {
      await consumeOrderHolds(tx, order.id, facts.now);
      await confirmOrder(tx, order, facts.now, facts.actor, "payment_captured");
      return "confirmed";
    }

    if (order.status === "CANCELLED") {
      // Late capture (P8): the stock went back when the order expired.
      const restock = await tryCommitForOrder(tx, order.items);
      if (restock.ok) {
        await confirmOrder(
          tx,
          order,
          facts.now,
          facts.actor,
          "late_capture_restocked",
        );
        return "late_confirmed";
      }
      await queueRefund(tx, order, current, facts, "late_capture_no_stock");
      await moveTo(tx, order, "late_capture_no_stock", facts.actor, facts.now, {
        note: "Paid after the deadline; stock no longer available. Refund queued.",
      });
      return "refund_queued";
    }

    // CONFIRMED or NEEDS_REVIEW already: this is a second payment.
    await queueRefund(tx, order, current, facts, "duplicate_payment");
    await orders.recordOrderEvent(tx, {
      orderId: order.id,
      type: "payment.duplicate",
      actor: facts.actor,
      note: "A second capture arrived for an order that was already paid; refund queued.",
    });
    return "duplicate_refund_queued";
  });
}

type OrderUnderLock = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  email: string;
  cartId: string | null;
  totalInPaise: number;
  currency: string;
  items: ReadonlyArray<{ variantId: string; quantity: number }>;
};

async function confirmOrder(
  tx: Prisma.TransactionClient,
  order: OrderUnderLock,
  now: Date,
  actor: OrderActor,
  event: "payment_captured" | "late_capture_restocked",
): Promise<void> {
  const next = nextOrderStatus(order.status, event);
  if (next !== "CONFIRMED")
    throw new Error(`cannot confirm from ${order.status}`);
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: now,
      cancelledAt: null,
      cancellationReason: null,
    },
  });
  if (order.cartId) {
    await tx.cart.updateMany({
      where: { id: order.cartId, status: "ACTIVE" },
      data: { status: "CONVERTED" },
    });
  }
  await orders.recordOrderEvent(tx, {
    orderId: order.id,
    type:
      event === "late_capture_restocked"
        ? "payment.late_capture"
        : "order.confirmed",
    actor,
    fromStatus: order.status,
    toStatus: "CONFIRMED",
    note:
      event === "late_capture_restocked"
        ? "Paid after the deadline; the stock was still available."
        : null,
  });
  if (event === "late_capture_restocked") {
    await orders.recordOrderEvent(tx, {
      orderId: order.id,
      type: "order.confirmed",
      actor,
      fromStatus: order.status,
      toStatus: "CONFIRMED",
    });
  }
  await enqueueOrderConfirmed(tx, {
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerEmail: order.email,
  });
}

async function holdForReview(
  tx: Prisma.TransactionClient,
  order: OrderUnderLock,
  facts: CaptureFacts,
  attemptNo: number,
  detail: { reason: string; note: string },
): Promise<CaptureOutcome> {
  if (order.status === "PENDING_PAYMENT") {
    await moveTo(tx, order, "payment_mismatch", facts.actor, facts.now, {
      note: detail.note,
    });
  } else {
    await orders.recordOrderEvent(tx, {
      orderId: order.id,
      type: "payment.mismatch",
      actor: facts.actor,
      note: detail.note,
    });
  }
  await enqueueOpsAlert(tx, {
    key: `${detail.reason}:${order.id}:${attemptNo}`,
    orderId: order.id,
    payload: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      reason: detail.reason,
      note: detail.note,
    },
  });
  return "mismatch";
}

async function moveTo(
  tx: Prisma.TransactionClient,
  order: OrderUnderLock,
  event: "payment_mismatch" | "late_capture_no_stock",
  actor: OrderActor,
  now: Date,
  detail: { note: string },
): Promise<void> {
  const next = nextOrderStatus(order.status, event);
  if (next !== "NEEDS_REVIEW")
    throw new Error(`cannot review from ${order.status}`);
  await tx.order.update({
    where: { id: order.id },
    // Leaving CANCELLED clears its reason (orders_cancelled_has_reason).
    data: {
      status: "NEEDS_REVIEW",
      cancelledAt: null,
      cancellationReason: null,
    },
  });
  await orders.recordOrderEvent(tx, {
    orderId: order.id,
    type: "order.needs_review",
    actor,
    fromStatus: order.status,
    toStatus: "NEEDS_REVIEW",
    note: detail.note,
  });
  void now;
}

async function queueRefund(
  tx: Prisma.TransactionClient,
  order: OrderUnderLock,
  attempt: { id: string; attemptNo: number },
  facts: CaptureFacts,
  reason: "late_capture_no_stock" | "duplicate_payment",
): Promise<void> {
  await queueRefundIntent(tx, {
    order,
    attempt,
    amountInPaise: facts.amountInPaise,
    actor: facts.actor,
    reason,
  });
}

export interface FailureFacts {
  readonly attemptId: string;
  readonly providerPaymentId: string | null;
  readonly failureCode: string | null;
  readonly failureDescription: string | null;
  readonly actor: OrderActor;
  readonly now: Date;
}

export type FailureOutcome = "failed" | "ignored";

/** T6: a payment try did not go through. Never touches a captured attempt. */
export async function applyFailure(
  facts: FailureFacts,
): Promise<FailureOutcome> {
  return db.$transaction(async (tx) => {
    const attempt = await data.findAttempt(facts.attemptId, tx);
    if (!attempt) return "ignored";
    await orders.lockOrder(tx, attempt.orderId);
    const moved = await data.markAttemptFailed(tx, attempt.id, {
      providerPaymentId: facts.providerPaymentId,
      failureCode: facts.failureCode,
      failureDescription: facts.failureDescription,
      now: facts.now,
    });
    if (!moved) return "ignored";
    await orders.recordOrderEvent(tx, {
      orderId: attempt.orderId,
      type: "payment.failed",
      actor: facts.actor,
      note: facts.failureDescription,
      data: { attemptNo: attempt.attemptNo, code: facts.failureCode },
    });
    return "failed";
  });
}
