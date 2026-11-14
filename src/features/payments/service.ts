import "server-only";

import { getCheckoutPolicy, minutesToMs } from "@/config/checkout-policy";
import type { PaymentStatus } from "@/generated/prisma/enums";
import * as orders from "@/features/orders/data";
import { isOpenPaymentStatus } from "@/features/orders/transitions";
import { AppError, NotFoundError } from "@/server/errors";
import { describeError } from "@/server/jobs/queue";
import { getPaymentGateway } from "@/server/payments";
import { PaymentGatewayError } from "@/server/payments/gateway";
import { db } from "@/server/db";

import { applyCapture, applyFailure } from "./capture";
import type { CaptureOutcome } from "./capture";
import * as data from "./data";

/**
 * Payment attempts (docs/checkout.md §5.6). The provider is only ever called
 * between transactions, after an INITIATED row with its receipt exists, so a
 * lost response is found again by receipt and never duplicated.
 */

export interface ProviderOrderOutcome {
  readonly status: PaymentStatus;
  readonly providerOrderId: string | null;
}

/** S2 + S3: create (or find) the provider order for an INITIATED attempt and persist it. */
export async function ensureProviderOrder(
  attemptId: string,
  now = new Date(),
): Promise<ProviderOrderOutcome> {
  const attempt = await data.findAttempt(attemptId);
  if (!attempt) throw new NotFoundError("Payment attempt");
  if (attempt.status !== "INITIATED") {
    return { status: attempt.status, providerOrderId: attempt.providerOrderId };
  }

  let providerOrderId: string;
  try {
    const gateway = getPaymentGateway();
    try {
      providerOrderId = (
        await gateway.createOrder({
          amountInPaise: attempt.amountInPaise,
          currency: "INR",
          receipt: attempt.receipt,
          notes: {
            orderId: attempt.orderId,
            orderNumber: attempt.order.orderNumber,
          },
        })
      ).providerOrderId;
    } catch (error) {
      // The provider already has an order for this receipt: our earlier
      // response was lost. Use it rather than failing the attempt.
      if (
        error instanceof PaymentGatewayError &&
        error.code === "PAYMENT_DUPLICATE_RECEIPT"
      ) {
        const found = await gateway.findOrderByReceipt(attempt.receipt);
        if (!found) throw error;
        providerOrderId = found.providerOrderId;
      } else {
        throw error;
      }
    }
  } catch (error) {
    return recordProviderFailure(attempt.id, attempt.orderId, error, now);
  }

  // T3: persist, unless the attempt moved meanwhile.
  await db.$transaction(async (tx) => {
    await orders.lockOrder(tx, attempt.orderId);
    const moved = await data.markAttemptCreated(
      tx,
      attempt.id,
      providerOrderId,
    );
    if (moved) {
      await orders.recordOrderEvent(tx, {
        orderId: attempt.orderId,
        type: "payment.provider_order_created",
        actor: "SYSTEM",
        data: { attemptNo: attempt.attemptNo, providerOrderId },
      });
    }
  });
  const fresh = await data.findAttempt(attempt.id);
  return {
    status: fresh?.status ?? "CREATED",
    providerOrderId: fresh?.providerOrderId ?? providerOrderId,
  };
}

async function recordProviderFailure(
  attemptId: string,
  orderId: string,
  error: unknown,
  now: Date,
): Promise<ProviderOrderOutcome> {
  const policy = getCheckoutPolicy();
  const retryable =
    error instanceof PaymentGatewayError ? error.retryable : false;
  const message = describeError(error);
  const outcome = await db.$transaction(async (tx) => {
    await orders.lockOrder(tx, orderId);
    const current = await data.findAttempt(attemptId, tx);
    if (!current || current.status !== "INITIATED") return current?.status;
    const giveUp =
      !retryable || current.providerAttempts + 1 >= policy.jobs.maxAttempts;
    await data.recordProviderFailure(tx, attemptId, {
      error: message,
      giveUp,
      now,
    });
    await orders.recordOrderEvent(tx, {
      orderId,
      type: giveUp
        ? "payment.provider_order_failed"
        : "payment.provider_order_retry",
      actor: "SYSTEM",
      note: message,
      data: { attemptNo: current.attemptNo, retryable },
    });
    return giveUp ? "FAILED" : "INITIATED";
  });
  return { status: outcome ?? "INITIATED", providerOrderId: null };
}

export class PaymentNotAllowedError extends AppError {
  constructor(message: string) {
    super(message, { code: "PAYMENT_NOT_ALLOWED", status: 409 });
  }
}

/**
 * The customer wants to pay (again). Returns the open attempt if one exists;
 * otherwise opens the next one, extending the deadline once (D6), then runs
 * S2/S3 for it.
 */
export async function startPaymentAttempt(
  orderId: string,
  now = new Date(),
): Promise<ProviderOrderOutcome & { attemptId: string }> {
  const policy = getCheckoutPolicy();
  const attempt = await db.$transaction(async (tx) => {
    await orders.lockOrder(tx, orderId);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalInPaise: true,
        pendingExpiresAt: true,
        deadlineExtensions: true,
        payments: {
          select: { attemptNo: true, status: true, id: true },
          orderBy: { attemptNo: "desc" },
        },
      },
    });
    if (!order) throw new NotFoundError("Order");
    if (order.status !== "PENDING_PAYMENT") {
      throw new PaymentNotAllowedError("This order is not awaiting payment.");
    }
    if (order.pendingExpiresAt && order.pendingExpiresAt <= now) {
      throw new PaymentNotAllowedError(
        "The payment window for this order has closed.",
      );
    }
    const open = order.payments.find((p) => isOpenPaymentStatus(p.status));
    if (open) return { id: open.id };

    const attemptNo = (order.payments[0]?.attemptNo ?? 0) + 1;
    const created = await data.createAttempt(tx, {
      orderId,
      attemptNo,
      method: "RAZORPAY",
      status: "INITIATED",
      amountInPaise: order.totalInPaise,
      receipt: `${order.orderNumber}-${attemptNo}`,
    });

    if (
      order.pendingExpiresAt &&
      order.deadlineExtensions < policy.reservation.maxExtensions
    ) {
      const extendedTo = new Date(
        Math.max(order.pendingExpiresAt.getTime(), now.getTime()) +
          minutesToMs(policy.reservation.extensionMinutes),
      );
      await tx.order.update({
        where: { id: orderId },
        data: {
          pendingExpiresAt: extendedTo,
          deadlineExtensions: { increment: 1 },
        },
      });
      await tx.inventoryReservation.updateMany({
        where: { orderId, status: "ACTIVE" },
        data: { expiresAt: extendedTo },
      });
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "order.deadline_extended",
        actor: "CUSTOMER",
        data: { pendingExpiresAt: extendedTo.toISOString() },
      });
    }
    await orders.recordOrderEvent(tx, {
      orderId,
      type: "payment.attempt_opened",
      actor: "CUSTOMER",
      data: { attemptNo },
    });
    return { id: created.id };
  });

  const outcome = await ensureProviderOrder(attempt.id, now);
  return { ...outcome, attemptId: attempt.id };
}

export type CallbackOutcome =
  /** Signature valid and the provider confirms a capture: the order is confirmed (or handled). */
  | { readonly kind: "confirmed"; readonly capture: CaptureOutcome }
  /** Signature valid but the provider does not yet show a capture: keep checking. */
  | { readonly kind: "confirming" }
  /** The provider shows the payment as failed. */
  | { readonly kind: "failed" }
  /** Tampered or foreign callback: nothing changes. */
  | { readonly kind: "invalid" };

/**
 * The browser's success callback (docs/checkout.md §6). The signature is
 * necessary but not sufficient: the capture is confirmed from the provider
 * before T5 runs, with the fetched facts as parameters.
 */
export async function confirmFromCallback(input: {
  readonly orderId: string;
  readonly providerOrderId: string;
  readonly providerPaymentId: string;
  readonly signature: string;
  readonly now?: Date;
}): Promise<CallbackOutcome> {
  const now = input.now ?? new Date();
  const attempt = await data.findAttemptByProviderOrderId(
    input.providerOrderId,
  );
  if (!attempt || attempt.orderId !== input.orderId) return { kind: "invalid" };

  const gateway = getPaymentGateway();
  if (
    !gateway.verifyCheckoutSignature(
      input.providerOrderId,
      input.providerPaymentId,
      input.signature,
    )
  ) {
    return { kind: "invalid" };
  }
  if (attempt.status === "CAPTURED" || attempt.status === "REFUNDED") {
    return { kind: "confirmed", capture: "already_captured" };
  }

  let payment;
  try {
    payment = await gateway.fetchPayment(input.providerPaymentId);
  } catch {
    return { kind: "confirming" };
  }
  if (!payment || payment.providerOrderId !== input.providerOrderId) {
    return { kind: "confirming" };
  }

  switch (payment.status) {
    case "captured":
    case "refunded": {
      const capture = await applyCapture({
        attemptId: attempt.id,
        providerPaymentId: payment.providerPaymentId,
        amountInPaise: payment.amountInPaise,
        currency: payment.currency,
        actor: "CUSTOMER",
        signatureVerified: true,
        now,
      });
      return { kind: "confirmed", capture };
    }
    case "failed": {
      await applyFailure({
        attemptId: attempt.id,
        providerPaymentId: payment.providerPaymentId,
        failureCode: payment.errorCode,
        failureDescription: payment.errorDescription,
        actor: "CUSTOMER",
        now,
      });
      return { kind: "failed" };
    }
    default:
      return { kind: "confirming" };
  }
}

/** The modal reported a failure; informational, the order stays pending until its deadline. */
export async function recordModalFailure(input: {
  readonly orderId: string;
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly code: string | null;
  readonly description: string | null;
  readonly now?: Date;
}): Promise<void> {
  if (!input.providerOrderId) return;
  const attempt = await data.findAttemptByProviderOrderId(
    input.providerOrderId,
  );
  if (!attempt || attempt.orderId !== input.orderId) return;
  await applyFailure({
    attemptId: attempt.id,
    providerPaymentId: input.providerPaymentId,
    failureCode: input.code,
    failureDescription: input.description,
    actor: "CUSTOMER",
    now: input.now ?? new Date(),
  });
}

export type ReconcileOutcome =
  | { readonly kind: "captured"; readonly capture: CaptureOutcome }
  | { readonly kind: "failed" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "not_applicable" };

/**
 * Asks the provider what happened to an open attempt (missed webhook,
 * closed tab) and applies it. Safe to repeat.
 */
export async function reconcileAttempt(
  attemptId: string,
  now = new Date(),
  options: { readonly lateCapture?: "revive" | "refund" } = {},
): Promise<ReconcileOutcome> {
  const attempt = await data.findAttempt(attemptId);
  if (!attempt || !attempt.providerOrderId) return { kind: "not_applicable" };
  if (!isOpenPaymentStatus(attempt.status) && attempt.status !== "FAILED") {
    return { kind: "not_applicable" };
  }
  const payments = await getPaymentGateway().fetchOrderPayments(
    attempt.providerOrderId,
  );
  const captured = payments.find(
    (payment) => payment.status === "captured" || payment.status === "refunded",
  );
  if (captured) {
    const capture = await applyCapture({
      attemptId: attempt.id,
      providerPaymentId: captured.providerPaymentId,
      amountInPaise: captured.amountInPaise,
      currency: captured.currency,
      actor: "CRON",
      signatureVerified: false,
      now,
      ...(options.lateCapture ? { lateCapture: options.lateCapture } : {}),
    });
    return { kind: "captured", capture };
  }
  if (attempt.status === "FAILED") return { kind: "unchanged" };
  const failed = payments.find((payment) => payment.status === "failed");
  const stillTrying = payments.some(
    (payment) =>
      payment.status === "created" ||
      payment.status === "authorized" ||
      payment.status === "pending",
  );
  if (failed && !stillTrying) {
    await applyFailure({
      attemptId: attempt.id,
      providerPaymentId: failed.providerPaymentId,
      failureCode: failed.errorCode,
      failureDescription: failed.errorDescription,
      actor: "CRON",
      now,
    });
    return { kind: "failed" };
  }
  return { kind: "unchanged" };
}
