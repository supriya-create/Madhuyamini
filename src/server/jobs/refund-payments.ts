import "server-only";

import {
  backoffMinutesFor,
  getCheckoutPolicy,
  minutesToMs,
} from "@/config/checkout-policy";
import * as orders from "@/features/orders/data";
import * as payments from "@/features/payments/data";
import { db } from "@/server/db";
import { enqueueOpsAlert } from "@/server/notifications/outbox";
import { getPaymentGateway } from "@/server/payments";
import { PaymentGatewayError } from "@/server/payments/gateway";
import type { GatewayRefund } from "@/server/payments/gateway";

import { claimQueueRows, decideRetry, describeError, workerId } from "./queue";

/**
 * Executes refund intents and follows them to completion (docs/checkout.md
 * §5.6, §5.8). The provider is asked for an existing refund carrying our
 * reference before a new one is created, so a lost response never refunds
 * twice; a refund that keeps failing is marked FAILED and the owner alerted.
 */

export async function runRefundPayments(
  options: {
    readonly now?: Date;
    readonly limit?: number;
    readonly worker?: string;
  } = {},
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const worker = options.worker ?? workerId("refund-payments");
  const policy = getCheckoutPolicy().jobs;
  const summary = {
    requested: 0,
    processed: 0,
    retried: 0,
    failed: 0,
    polled: 0,
  };
  const limit = options.limit ?? 20;

  // 1. New intents: request them.
  for (const id of await claimQueueRows({
    table: "refunds",
    pendingStatus: "INITIATED",
    limit,
    worker,
    now,
    policy,
  })) {
    const refund = await loadRefund(id);
    if (!refund || refund.status !== "INITIATED") continue;
    try {
      const gateway = getPaymentGateway();
      const providerPaymentId = refund.payment.providerPaymentId;
      if (!providerPaymentId)
        throw new Error("refund has no provider payment id");
      const existing = (await gateway.listRefunds(providerPaymentId)).find(
        (candidate) => candidate.reference === refund.reference,
      );
      const result =
        existing ??
        (await gateway.createRefund(providerPaymentId, {
          amountInPaise: refund.amountInPaise,
          reference: refund.reference,
          notes: {
            refundId: refund.id,
            orderId: refund.orderId,
            reason: refund.reason,
          },
        }));
      await recordProviderRefund(
        refund,
        result,
        now,
        existing ? "found" : "created",
      );
      if (result.status === "processed") summary.processed += 1;
      else summary.requested += 1;
    } catch (error) {
      // A rejection the provider will repeat (bad request) is not worth retrying.
      const retry =
        error instanceof PaymentGatewayError && !error.retryable
          ? { giveUp: true, nextAttemptAt: now }
          : decideRetry(policy, refund.attempts, now);
      const lastError = describeError(error);
      await db.$transaction(async (tx) => {
        await orders.lockOrder(tx, refund.orderId);
        await tx.refund.update({
          where: { id },
          data: retry.giveUp
            ? { status: "FAILED", lastError, claimedAt: null }
            : {
                nextAttemptAt: retry.nextAttemptAt,
                lastError,
                claimedAt: null,
              },
        });
        await orders.recordOrderEvent(tx, {
          orderId: refund.orderId,
          type: retry.giveUp ? "refund.failed" : "refund.retry",
          actor: "CRON",
          note: lastError,
          data: { reference: refund.reference, attempts: refund.attempts },
        });
        if (retry.giveUp) {
          await enqueueOpsAlert(tx, {
            key: `refund-failed:${refund.reference}`,
            orderId: refund.orderId,
            payload: {
              reason: "Refund could not be requested; needs a manual refund",
              orderNumber: refund.order.orderNumber,
              reference: refund.reference,
              amountInPaise: refund.amountInPaise,
              lastError,
            },
          });
        }
      });
      if (retry.giveUp) summary.failed += 1;
      else summary.retried += 1;
    }
  }

  // 2. Requested refunds: poll until the provider reports them processed.
  for (const id of await claimQueueRows({
    table: "refunds",
    pendingStatus: "REQUESTED",
    limit,
    worker,
    now,
    policy,
  })) {
    const refund = await loadRefund(id);
    if (!refund || refund.status !== "REQUESTED" || !refund.providerRefundId)
      continue;
    summary.polled += 1;
    try {
      const providerPaymentId = refund.payment.providerPaymentId ?? "";
      const latest = (
        await getPaymentGateway().listRefunds(providerPaymentId)
      ).find(
        (candidate) => candidate.providerRefundId === refund.providerRefundId,
      );
      if (latest?.status === "processed") {
        await recordProviderRefund(refund, latest, now, "polled");
        summary.processed += 1;
        continue;
      }
      if (latest?.status === "failed") {
        await db.$transaction(async (tx) => {
          await orders.lockOrder(tx, refund.orderId);
          await tx.refund.update({
            where: { id },
            data: {
              status: "FAILED",
              lastError: "Provider reports the refund failed",
              claimedAt: null,
            },
          });
          await enqueueOpsAlert(tx, {
            key: `refund-failed:${refund.reference}`,
            orderId: refund.orderId,
            payload: {
              reason:
                "Provider reports the refund failed; needs a manual refund",
              orderNumber: refund.order.orderNumber,
              reference: refund.reference,
            },
          });
        });
        summary.failed += 1;
        continue;
      }
    } catch (error) {
      await db.refund.update({
        where: { id },
        data: { lastError: describeError(error) },
      });
    }
    // Still pending at the provider: poll again later without using up attempts.
    await db.refund.update({
      where: { id },
      data: {
        attempts: { decrement: 1 },
        nextAttemptAt: new Date(
          now.getTime() +
            minutesToMs(backoffMinutesFor(policy, refund.attempts)),
        ),
        claimedAt: null,
      },
    });
  }
  return summary;
}

function loadRefund(id: string) {
  return db.refund.findUnique({
    where: { id },
    select: {
      id: true,
      orderId: true,
      paymentId: true,
      status: true,
      amountInPaise: true,
      reason: true,
      reference: true,
      providerRefundId: true,
      attempts: true,
      payment: { select: { providerPaymentId: true } },
      order: { select: { orderNumber: true } },
    },
  });
}

type LoadedRefund = NonNullable<Awaited<ReturnType<typeof loadRefund>>>;

async function recordProviderRefund(
  refund: LoadedRefund,
  result: GatewayRefund,
  now: Date,
  how: "created" | "found" | "polled",
): Promise<void> {
  const processed = result.status === "processed";
  await db.$transaction(async (tx) => {
    await orders.lockOrder(tx, refund.orderId);
    await tx.refund.update({
      where: { id: refund.id },
      data: {
        status: processed
          ? "PROCESSED"
          : result.status === "failed"
            ? "FAILED"
            : "REQUESTED",
        providerRefundId: result.providerRefundId,
        requestedAt: now,
        processedAt: processed ? now : null,
        claimedAt: null,
        lastError: null,
      },
    });
    if (processed) await payments.markAttemptRefunded(tx, refund.paymentId);
    await orders.recordOrderEvent(tx, {
      orderId: refund.orderId,
      type: processed ? "refund.processed" : "refund.requested_at_provider",
      actor: "CRON",
      data: {
        reference: refund.reference,
        providerRefundId: result.providerRefundId,
        how,
      },
    });
  });
}
