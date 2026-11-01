import "server-only";

import { getAdminPolicy } from "@/config/admin-policy";
import type { OrderActor, RefundStatus } from "@/generated/prisma/enums";
import * as inventoryData from "@/features/inventory/data";
import {
  consumeOrderHolds,
  tryCommitForOrder,
} from "@/features/inventory/service";
import * as orders from "@/features/orders/data";
import { isOpenPaymentStatus } from "@/features/orders/transitions";
import { applyCapture, confirmOrder } from "@/features/payments/capture";
import type { CaptureOutcome } from "@/features/payments/capture";
import {
  capturedAmountInPaise,
  queueRefundIntent,
  refundableAttempts,
  settleAttemptIfFullyRefunded,
} from "@/features/payments/refunds";
import { reconcileAttempt } from "@/features/payments/service";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";
import { AppError, NotFoundError } from "@/server/errors";
import { getPaymentGateway } from "@/server/payments";

import { runAudited, runAuditedExternal } from "../audit";
import { toAdminOrderListItem } from "../orders/types";
import type { AdminOrderListItem } from "../orders/types";
import { findRefund, listRefunds, listReviewOrders } from "./data";
import type { RefundRow } from "./data";

/**
 * Payment review and refunds (docs/admin.md §5.5, §6 A6–A8). The admin
 * never asserts a payment: every path ends in a Phase 6 function with
 * provider facts as parameters, and the evidence is kept in the audit row.
 */

export class PaymentReviewError extends AppError {
  constructor(message: string, code = "PAYMENT_REVIEW_NOT_ALLOWED") {
    super(message, { code, status: 409 });
  }
}

function actorOf(ctx: StaffContext): OrderActor {
  return ctx.role === "ADMIN" ? "ADMIN" : "STAFF";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getReviewQueue(
  ctx: StaffContext,
): Promise<AdminOrderListItem[]> {
  return (await listReviewOrders(ctx)).map(toAdminOrderListItem);
}

export interface RefundView {
  readonly id: string;
  readonly status: RefundStatus;
  readonly amountInPaise: number;
  readonly reason: string;
  readonly reference: string;
  readonly providerRefundId: string | null;
  readonly providerPaymentId: string | null;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly nextAttemptAt: Date;
  readonly processedAt: Date | null;
  readonly createdAt: Date;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly canRetry: boolean;
  readonly canMarkExternal: boolean;
}

function toRefundView(row: RefundRow, role: "STAFF" | "ADMIN"): RefundView {
  const admin = role === "ADMIN";
  return {
    id: row.id,
    status: row.status,
    amountInPaise: row.amountInPaise,
    reason: row.reason,
    reference: row.reference,
    providerRefundId: row.providerRefundId,
    providerPaymentId: row.payment.providerPaymentId,
    attempts: row.attempts,
    lastError: row.lastError,
    nextAttemptAt: row.nextAttemptAt,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
    orderId: row.order.id,
    orderNumber: row.order.orderNumber,
    canRetry: admin && row.status === "FAILED",
    canMarkExternal: admin && row.status !== "PROCESSED",
  };
}

export async function getRefunds(
  ctx: StaffContext,
  filters: { readonly status: RefundStatus | null },
): Promise<RefundView[]> {
  return (await listRefunds(ctx, filters)).map((row) =>
    toRefundView(row, ctx.role),
  );
}

// ---------------------------------------------------------------------------
// Re-check with the provider (STAFF)
// ---------------------------------------------------------------------------

export interface RecheckOutcome {
  readonly attemptNo: number;
  readonly kind: "captured" | "failed" | "unchanged" | "not_applicable";
  readonly capture: CaptureOutcome | null;
}

export async function recheckWithProvider(
  ctx: StaffContext,
  orderId: string,
  now = new Date(),
): Promise<RecheckOutcome[]> {
  return runAuditedExternal(
    {
      ctx,
      action: "payment.recheck",
      targetType: "order",
      targetId: orderId,
      capability: "payments.recheck",
      now,
    },
    async () => {
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNumber: true,
          paymentMethod: true,
          payments: {
            select: {
              id: true,
              attemptNo: true,
              status: true,
              providerOrderId: true,
            },
            orderBy: { attemptNo: "asc" },
          },
        },
      });
      if (!order) throw new NotFoundError("Order");
      if (order.paymentMethod !== "RAZORPAY") {
        throw new PaymentReviewError(
          "Only online payments can be re-checked with the provider.",
        );
      }
      const outcomes: RecheckOutcome[] = [];
      for (const attempt of order.payments) {
        if (!attempt.providerOrderId) continue;
        if (!isOpenPaymentStatus(attempt.status) && attempt.status !== "FAILED")
          continue;
        const outcome = await reconcileAttempt(attempt.id, now);
        outcomes.push({
          attemptNo: attempt.attemptNo,
          kind: outcome.kind,
          capture: outcome.kind === "captured" ? outcome.capture : null,
        });
      }
      const after = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderNumber: true, status: true },
      });
      return {
        result: outcomes,
        after,
        reason:
          outcomes.length === 0
            ? "No attempt to re-check."
            : outcomes
                .map(
                  (o) =>
                    `attempt ${o.attemptNo}: ${o.kind}${o.capture ? ` (${o.capture})` : ""}`,
                )
                .join("; "),
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Attach a provider payment (ADMIN, re-auth)
// ---------------------------------------------------------------------------

export async function attachProviderPayment(
  ctx: StaffContext,
  orderId: string,
  input: { readonly providerPaymentId: string; readonly reason: string },
  now = new Date(),
): Promise<CaptureOutcome> {
  return runAuditedExternal(
    {
      ctx,
      action: "payment.attach",
      targetType: "order",
      targetId: orderId,
      capability: "payments.attach",
      reason: input.reason,
      now,
    },
    async () => {
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNumber: true,
          paymentMethod: true,
          payments: {
            select: {
              id: true,
              attemptNo: true,
              status: true,
              providerOrderId: true,
            },
            orderBy: { attemptNo: "asc" },
          },
        },
      });
      if (!order) throw new NotFoundError("Order");
      if (order.paymentMethod !== "RAZORPAY") {
        throw new PaymentReviewError(
          "Only online orders can have a provider payment attached.",
        );
      }
      const payment = await getPaymentGateway().fetchPayment(
        input.providerPaymentId.trim(),
      );
      if (!payment) {
        throw new PaymentReviewError(
          "The provider has no payment with that id.",
          "PAYMENT_NOT_FOUND_AT_PROVIDER",
        );
      }
      if (payment.status !== "captured" && payment.status !== "refunded") {
        throw new PaymentReviewError(
          `That payment is "${payment.status}" at the provider, not captured.`,
          "PAYMENT_NOT_CAPTURED_AT_PROVIDER",
        );
      }
      const attempt = order.payments.find(
        (candidate) =>
          candidate.providerOrderId !== null &&
          candidate.providerOrderId === payment.providerOrderId,
      );
      if (!attempt) {
        throw new PaymentReviewError(
          "That payment does not belong to any of this order's provider orders.",
          "PAYMENT_WRONG_ORDER",
        );
      }
      const outcome = await applyCapture({
        attemptId: attempt.id,
        providerPaymentId: payment.providerPaymentId,
        amountInPaise: payment.amountInPaise,
        currency: payment.currency,
        actor: actorOf(ctx),
        signatureVerified: false,
        now,
      });
      const after = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderNumber: true, status: true },
      });
      return {
        result: outcome,
        after: {
          ...after,
          attemptNo: attempt.attemptNo,
          providerPaymentId: payment.providerPaymentId,
          providerStatus: payment.status,
          providerAmountInPaise: payment.amountInPaise,
          providerCurrency: payment.currency,
          captureOutcome: outcome,
        },
        reason: `${input.reason} · provider says ${payment.status} ${payment.amountInPaise} ${payment.currency} → ${outcome}`,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Accept a mismatch (ADMIN, re-auth)
// ---------------------------------------------------------------------------

export async function acceptMismatch(
  ctx: StaffContext,
  orderId: string,
  input: { readonly reason: string; readonly confirmOrderNumber: string },
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "payment.accept_mismatch",
      targetType: "order",
      targetId: orderId,
      capability: "payments.accept_mismatch",
      reason: input.reason,
      now,
    },
    async (tx) => {
      await orders.lockOrder(tx, orderId);
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          email: true,
          cartId: true,
          totalInPaise: true,
          currency: true,
          paymentMethod: true,
          items: { select: { variantId: true, quantity: true } },
          payments: {
            select: {
              id: true,
              attemptNo: true,
              status: true,
              amountInPaise: true,
            },
          },
        },
      });
      if (!order) throw new NotFoundError("Order");
      if (order.status !== "NEEDS_REVIEW") {
        throw new PaymentReviewError(
          "Only orders being checked can be accepted.",
        );
      }
      if (order.orderNumber !== input.confirmOrderNumber.trim().toUpperCase()) {
        throw new PaymentReviewError(
          "The order number you typed does not match this order.",
          "CONFIRMATION_MISMATCH",
        );
      }
      const captured = order.payments.filter((p) => p.status === "CAPTURED");
      if (captured.length === 0) {
        throw new PaymentReviewError(
          "Nothing has been captured for this order; attach the provider payment first.",
          "NO_CAPTURED_ATTEMPT",
        );
      }
      let capturedInPaise = 0;
      for (const attempt of captured) {
        capturedInPaise += await capturedAmountInPaise(tx, orderId, attempt);
      }
      if (
        capturedInPaise < order.totalInPaise &&
        !getAdminPolicy().review.allowUnderpaymentAccept
      ) {
        throw new PaymentReviewError(
          "The captured amount is less than the order total; cancel and refund instead.",
          "UNDERPAYMENT",
        );
      }
      // Stock: holds from the original placement, or re-secure after a late capture.
      const holds = await inventoryData.findActiveReservations(tx, orderId);
      if (holds.length > 0) {
        await consumeOrderHolds(tx, orderId, now);
      } else {
        const secured = await tryCommitForOrder(tx, order.items);
        if (!secured.ok) {
          throw new PaymentReviewError(
            "The pieces are no longer in stock; cancel and refund instead.",
            "STOCK_UNAVAILABLE",
          );
        }
      }
      const actor = actorOf(ctx);
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "payment.mismatch_accepted",
        actor,
        note: input.reason,
        data: { capturedInPaise, totalInPaise: order.totalInPaise },
      });
      await confirmOrder(tx, order, now, actor, "admin_confirmed");
      return {
        result: undefined,
        before: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
        },
        after: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: "CONFIRMED",
          amountInPaise: capturedInPaise,
          totalInPaise: order.totalInPaise,
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Refunds (ADMIN, re-auth)
// ---------------------------------------------------------------------------

const REFUNDABLE_STATUSES = [
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
] as const;

export async function createRefund(
  ctx: StaffContext,
  orderId: string,
  input: { readonly amountInPaise: number; readonly reason: string },
  now = new Date(),
): Promise<{ reference: string }> {
  return runAudited(
    {
      ctx,
      action: "refund.create",
      targetType: "order",
      targetId: orderId,
      capability: "payments.refund",
      reason: input.reason,
      now,
    },
    async (tx) => {
      await orders.lockOrder(tx, orderId);
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          email: true,
          paymentMethod: true,
        },
      });
      if (!order) throw new NotFoundError("Order");
      if (order.paymentMethod !== "RAZORPAY") {
        throw new PaymentReviewError(
          "Cash-on-delivery orders are refunded by hand, not here.",
        );
      }
      if (!REFUNDABLE_STATUSES.some((status) => status === order.status)) {
        throw new PaymentReviewError(
          "Refunds here are for confirmed or fulfilled orders; cancelling refunds the rest.",
        );
      }
      if (!Number.isInteger(input.amountInPaise) || input.amountInPaise <= 0) {
        throw new PaymentReviewError(
          "Enter an amount greater than zero.",
          "INVALID_AMOUNT",
        );
      }
      const candidates = (await refundableAttempts(tx, orderId))
        .map((attempt) => ({
          ...attempt,
          remaining: attempt.amountInPaise - attempt.refundedInPaise,
        }))
        .filter((attempt) => attempt.remaining > 0)
        .sort((a, b) => b.remaining - a.remaining);
      const attempt = candidates[0];
      if (!attempt) {
        throw new PaymentReviewError(
          "Nothing is left to refund on this order.",
          "NOTHING_TO_REFUND",
        );
      }
      if (input.amountInPaise > attempt.remaining) {
        throw new PaymentReviewError(
          `At most ${attempt.remaining} paise can still be refunded on this payment.`,
          "AMOUNT_EXCEEDS_REFUNDABLE",
        );
      }
      const { reference, created } = await queueRefundIntent(tx, {
        order,
        attempt: { id: attempt.id, attemptNo: attempt.attemptNo },
        amountInPaise: input.amountInPaise,
        actor: actorOf(ctx),
        reason: "shop_refund",
        sequence: attempt.refundCount + 1,
      });
      if (!created) {
        throw new PaymentReviewError(
          "A refund with that reference already exists.",
          "DUPLICATE_REFUND",
        );
      }
      return {
        result: { reference },
        after: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          amountInPaise: input.amountInPaise,
          refundReference: reference,
        },
      };
    },
  );
}

export async function retryRefund(
  ctx: StaffContext,
  refundId: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "refund.retry",
      targetType: "refund",
      targetId: refundId,
      capability: "operations.retry_refund",
      reason,
      now,
    },
    async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: refundId },
        select: {
          id: true,
          orderId: true,
          status: true,
          amountInPaise: true,
          reason: true,
          reference: true,
          providerRefundId: true,
          attempts: true,
          lastError: true,
        },
      });
      if (!refund) throw new NotFoundError("Refund");
      await orders.lockOrder(tx, refund.orderId);
      const reset = await tx.refund.updateMany({
        where: { id: refundId, status: "FAILED" },
        data: {
          status: "INITIATED",
          attempts: 0,
          nextAttemptAt: now,
          claimedAt: null,
          claimedBy: null,
          lastError: null,
        },
      });
      if (reset.count !== 1) {
        throw new PaymentReviewError("Only failed refunds can be retried.");
      }
      await orders.recordOrderEvent(tx, {
        orderId: refund.orderId,
        type: "refund.retry_requested",
        actor: actorOf(ctx),
        note: reason,
        data: { reference: refund.reference, previousError: refund.lastError },
      });
      return {
        result: undefined,
        before: refund,
        after: { ...refund, status: "INITIATED", attempts: 0, lastError: null },
      };
    },
  );
}

/** The money was refunded by hand in the provider dashboard: verified via `listRefunds`. */
export async function markRefundedExternally(
  ctx: StaffContext,
  refundId: string,
  input: { readonly providerRefundId: string; readonly reason: string },
  now = new Date(),
): Promise<void> {
  await runAuditedExternal(
    {
      ctx,
      action: "refund.mark_external",
      targetType: "refund",
      targetId: refundId,
      capability: "payments.refund",
      reason: input.reason,
      now,
    },
    async () => {
      const refund = await findRefund(ctx, refundId);
      if (!refund) throw new NotFoundError("Refund");
      if (refund.status === "PROCESSED") {
        throw new PaymentReviewError("This refund is already processed.");
      }
      if (!refund.payment.providerPaymentId) {
        throw new PaymentReviewError(
          "This payment has no provider id to check against.",
        );
      }
      const providerRefundId = input.providerRefundId.trim();
      const found = (
        await getPaymentGateway().listRefunds(refund.payment.providerPaymentId)
      ).find((candidate) => candidate.providerRefundId === providerRefundId);
      if (!found) {
        throw new PaymentReviewError(
          "The provider has no refund with that id on this payment.",
          "REFUND_NOT_FOUND_AT_PROVIDER",
        );
      }
      if (found.status !== "processed") {
        throw new PaymentReviewError(
          `The provider reports that refund as "${found.status}", not processed.`,
          "REFUND_NOT_PROCESSED_AT_PROVIDER",
        );
      }
      if (found.amountInPaise !== refund.amountInPaise) {
        throw new PaymentReviewError(
          "The provider refund amount does not match this refund.",
          "REFUND_AMOUNT_MISMATCH",
        );
      }
      await db.$transaction(async (tx) => {
        await orders.lockOrder(tx, refund.order.id);
        const updated = await tx.refund.updateMany({
          where: { id: refundId, status: { not: "PROCESSED" } },
          data: {
            status: "PROCESSED",
            providerRefundId,
            requestedAt: refund.requestedAt ?? now,
            processedAt: now,
            claimedAt: null,
            claimedBy: null,
            lastError: null,
          },
        });
        if (updated.count !== 1) {
          throw new PaymentReviewError(
            "This refund changed while you were looking at it.",
          );
        }
        await settleAttemptIfFullyRefunded(tx, refund.payment.id);
        await orders.recordOrderEvent(tx, {
          orderId: refund.order.id,
          type: "refund.processed",
          actor: actorOf(ctx),
          note: input.reason,
          data: {
            reference: refund.reference,
            providerRefundId,
            how: "external",
          },
        });
      });
      return {
        result: undefined,
        before: {
          id: refund.id,
          status: refund.status,
          amountInPaise: refund.amountInPaise,
          reference: refund.reference,
          attempts: refund.attempts,
          lastError: refund.lastError,
        },
        after: {
          id: refund.id,
          status: "PROCESSED",
          amountInPaise: refund.amountInPaise,
          reference: refund.reference,
          providerRefundId,
        },
      };
    },
  );
}
