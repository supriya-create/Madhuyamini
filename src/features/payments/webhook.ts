import "server-only";

import { z } from "zod";

import { getCheckoutPolicy, minutesToMs } from "@/config/checkout-policy";
import { Prisma } from "@/generated/prisma/client";
import * as orders from "@/features/orders/data";
import { db } from "@/server/db";
import { decideRetry, describeError, workerId } from "@/server/jobs/queue";
import { enqueueOpsAlert } from "@/server/notifications/outbox";
import { getPaymentGateway } from "@/server/payments";

import { applyCapture, applyFailure } from "./capture";
import * as data from "./data";

/**
 * Webhook ingestion (T9) and application (T10), docs/checkout.md §5.8.
 * The signature is verified over the raw body before anything is parsed;
 * every delivery is stored once by its event id; applying is a guarded,
 * idempotent transition that the process-webhooks job can repeat.
 */

const entity = z.object({ id: z.string().min(1) }).passthrough();

const paymentEntitySchema = entity.extend({
  order_id: z.string().nullable().optional(),
  amount: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  error_code: z.string().nullable().optional(),
  error_description: z.string().nullable().optional(),
});

const refundEntitySchema = entity.extend({
  payment_id: z.string().min(1),
  amount: z.number().int().nonnegative().optional(),
  status: z.string().optional(),
  receipt: z.string().nullable().optional(),
});

export const webhookEventSchema = z
  .object({
    event: z.string().min(1),
    payload: z
      .object({
        payment: z.object({ entity: paymentEntitySchema }).optional(),
        refund: z.object({ entity: refundEntitySchema }).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export type IngestOutcome =
  | { readonly status: "stored"; readonly eventId: string }
  | { readonly status: "duplicate"; readonly eventId: string }
  | { readonly status: "invalid_signature" }
  | { readonly status: "malformed" };

/** T9: verify, parse, store. Returns quickly; applying happens next (inline or by the job). */
export async function ingestWebhook(input: {
  readonly rawBody: string;
  readonly signature: string | null;
  readonly eventId: string | null;
  readonly now: Date;
}): Promise<IngestOutcome> {
  const gateway = getPaymentGateway();
  if (!gateway.verifyWebhookSignature(input.rawBody, input.signature)) {
    return { status: "invalid_signature" };
  }
  let parsed: WebhookEvent;
  try {
    parsed = webhookEventSchema.parse(JSON.parse(input.rawBody));
  } catch {
    return { status: "malformed" };
  }
  // Razorpay sends x-razorpay-event-id; a missing header falls back to a
  // body-derived id so the ledger still dedupes retries of the same delivery.
  const eventId =
    input.eventId ??
    `derived:${parsed.event}:${parsed.payload.payment?.entity.id ?? parsed.payload.refund?.entity.id ?? "none"}`;
  const payment = parsed.payload.payment?.entity;

  const inserted = await db.paymentWebhookEvent.createMany({
    data: [
      {
        id: eventId,
        eventType: parsed.event,
        providerOrderId: payment?.order_id ?? null,
        providerPaymentId:
          payment?.id ?? parsed.payload.refund?.entity.payment_id ?? null,
        payload: parsed as Prisma.InputJsonValue,
        receivedAt: input.now,
        nextAttemptAt: input.now,
      },
    ],
    skipDuplicates: true,
  });
  return inserted.count === 1
    ? { status: "stored", eventId }
    : { status: "duplicate", eventId };
}

export type ApplyOutcome =
  "processed" | "ignored" | "retry_scheduled" | "failed" | "skipped";

/**
 * T10 for one event: claim it (skip if another worker holds it or it is
 * done), apply the guarded transition, and record the result.
 */
export async function processWebhookEvent(
  eventId: string,
  options: { readonly now?: Date; readonly worker?: string } = {},
): Promise<ApplyOutcome> {
  const now = options.now ?? new Date();
  const worker = options.worker ?? workerId("process-webhooks");
  const policy = getCheckoutPolicy().jobs;
  const leaseCutoff = new Date(
    now.getTime() - minutesToMs(policy.leaseMinutes),
  );

  const claimed = await db.$queryRaw<Array<{ id: string; attempts: number }>>(
    Prisma.sql`
      UPDATE payment_webhook_events
         SET claimed_at = ${now}, claimed_by = ${worker}, attempts = attempts + 1
       WHERE id = ${eventId}
         AND status = 'RECEIVED'::webhook_status
         AND next_attempt_at <= ${now}
         AND (claimed_at IS NULL OR claimed_at < ${leaseCutoff})
       RETURNING id, attempts
    `,
  );
  const claim = claimed[0];
  if (!claim) return "skipped";

  const row = await db.paymentWebhookEvent.findUnique({
    where: { id: eventId },
  });
  if (!row) return "skipped";

  try {
    const result = await applyWebhook(row.eventType, row.payload, now);
    await db.paymentWebhookEvent.update({
      where: { id: eventId },
      data: {
        status: result.kind === "ignored" ? "IGNORED" : "PROCESSED",
        orderId: result.orderId,
        lastError: result.kind === "ignored" ? result.note : null,
        processedAt: now,
        claimedAt: null,
      },
    });
    return result.kind === "ignored" ? "ignored" : "processed";
  } catch (error) {
    const retry = decideRetry(policy, claim.attempts, now);
    const lastError = describeError(error);
    if (!retry.giveUp) {
      await db.paymentWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: "RECEIVED",
          lastError,
          nextAttemptAt: retry.nextAttemptAt,
          claimedAt: null,
        },
      });
      return "retry_scheduled";
    }
    // Out of retries: the delivery is kept, marked FAILED, and the owner is
    // told what to look at. A capture is never abandoned silently.
    const order = row.providerOrderId
      ? await data.findAttemptByProviderOrderId(row.providerOrderId)
      : null;
    await db.$transaction(async (tx) => {
      await tx.paymentWebhookEvent.update({
        where: { id: eventId },
        data: {
          status: "FAILED",
          lastError,
          nextAttemptAt: retry.nextAttemptAt,
          claimedAt: null,
          orderId: order?.orderId ?? row.orderId,
        },
      });
      await enqueueOpsAlert(tx, {
        key: `webhook-failed:${eventId}`,
        orderId: order?.orderId ?? row.orderId,
        payload: {
          reason: `Webhook ${row.eventType} could not be applied after ${claim.attempts} attempts; needs manual reconciliation`,
          eventId,
          eventType: row.eventType,
          providerOrderId: row.providerOrderId ?? "",
          providerPaymentId: row.providerPaymentId ?? "",
          orderNumber: order?.order.orderNumber ?? "",
          attempts: claim.attempts,
          lastError,
        },
      });
    });
    return "failed";
  }
}

type ApplyResult =
  | { readonly kind: "processed"; readonly orderId: string | null }
  | {
      readonly kind: "ignored";
      readonly orderId: string | null;
      readonly note: string;
    };

async function applyWebhook(
  eventType: string,
  payload: unknown,
  now: Date,
): Promise<ApplyResult> {
  const parsed = webhookEventSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      kind: "ignored",
      orderId: null,
      note: "Payload failed validation.",
    };
  }
  const payment = parsed.data.payload.payment?.entity;

  switch (eventType) {
    case "payment.captured":
    case "order.paid":
    case "payment.authorized":
    case "payment.failed": {
      if (!payment?.order_id) {
        return {
          kind: "ignored",
          orderId: null,
          note: "No provider order id.",
        };
      }
      const attempt = await data.findAttemptByProviderOrderId(payment.order_id);
      if (!attempt) {
        if (isCaptureEvent(eventType)) {
          // Money moved for an order we cannot find: not ours to apply, but
          // never ours to forget either.
          await db.$transaction((tx) =>
            enqueueOpsAlert(tx, {
              key: `webhook-unmatched:${payment.id}`,
              orderId: null,
              payload: {
                reason:
                  "A payment was captured for a provider order that matches no attempt; needs manual reconciliation",
                eventType,
                providerOrderId: payment.order_id ?? "",
                providerPaymentId: payment.id,
                amountInPaise: payment.amount ?? 0,
                currency: payment.currency ?? "",
              },
            }),
          );
        }
        return {
          kind: "ignored",
          orderId: null,
          note: "Unknown provider order; reconciliation will pick it up if ours.",
        };
      }
      if (eventType === "payment.failed") {
        const outcome = await applyFailure({
          attemptId: attempt.id,
          providerPaymentId: payment.id,
          failureCode: payment.error_code ?? null,
          failureDescription: payment.error_description ?? null,
          actor: "WEBHOOK",
          now,
        });
        return outcome === "failed"
          ? { kind: "processed", orderId: attempt.orderId }
          : {
              kind: "ignored",
              orderId: attempt.orderId,
              note: "Failure arrived after a capture or for a closed attempt.",
            };
      }
      if (eventType === "payment.authorized") {
        await recordAuthorized(attempt.id, attempt.orderId, payment.id, now);
        return { kind: "processed", orderId: attempt.orderId };
      }
      if (payment.status !== undefined && payment.status !== "captured") {
        return {
          kind: "ignored",
          orderId: attempt.orderId,
          note: `Payment status ${payment.status} is not a capture.`,
        };
      }
      const outcome = await applyCapture({
        attemptId: attempt.id,
        providerPaymentId: payment.id,
        amountInPaise: payment.amount ?? 0,
        currency: payment.currency ?? "",
        actor: "WEBHOOK",
        signatureVerified: true,
        now,
      });
      if (outcome === "not_applicable") {
        // The attempt is in a state no capture can move (it never reached the
        // provider). Treat it as a failure so the retries and, at the end,
        // the alert keep the capture visible rather than marking it done.
        throw new Error(
          `capture ${payment.id} cannot be applied to attempt ${attempt.attemptNo} of order ${attempt.order.orderNumber} (status ${attempt.status})`,
        );
      }
      return { kind: "processed", orderId: attempt.orderId };
    }
    case "refund.processed":
    case "refund.failed":
    case "refund.created": {
      const refund = parsed.data.payload.refund?.entity;
      if (!refund)
        return { kind: "ignored", orderId: null, note: "No refund entity." };
      const row = await db.refund.findFirst({
        where: refund.receipt
          ? {
              OR: [
                { providerRefundId: refund.id },
                { reference: refund.receipt },
              ],
            }
          : { providerRefundId: refund.id },
        select: { id: true, orderId: true, status: true },
      });
      if (!row)
        return { kind: "ignored", orderId: null, note: "Unknown refund." };
      if (eventType === "refund.processed" && row.status !== "PROCESSED") {
        await db.$transaction(async (tx) => {
          await orders.lockOrder(tx, row.orderId);
          await tx.refund.update({
            where: { id: row.id },
            data: {
              status: "PROCESSED",
              providerRefundId: refund.id,
              processedAt: now,
              requestedAt: undefined,
            },
          });
          const payment = await tx.refund.findUnique({
            where: { id: row.id },
            select: { paymentId: true },
          });
          if (payment) await data.markAttemptRefunded(tx, payment.paymentId);
          await orders.recordOrderEvent(tx, {
            orderId: row.orderId,
            type: "refund.processed",
            actor: "WEBHOOK",
            data: { providerRefundId: refund.id },
          });
        });
      }
      return { kind: "processed", orderId: row.orderId };
    }
    default:
      return {
        kind: "ignored",
        orderId: null,
        note: `Unhandled event ${eventType}.`,
      };
  }
}

function isCaptureEvent(eventType: string): boolean {
  return eventType === "payment.captured" || eventType === "order.paid";
}

async function recordAuthorized(
  attemptId: string,
  orderId: string,
  providerPaymentId: string,
  now: Date,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await orders.lockOrder(tx, orderId);
    const moved = await data.markAttemptAuthorized(tx, attemptId, {
      providerPaymentId,
      now,
    });
    if (moved) {
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "payment.authorized",
        actor: "WEBHOOK",
        data: { providerPaymentId },
      });
    }
  });
}
