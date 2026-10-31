import "server-only";

import { getCheckoutPolicy } from "@/config/checkout-policy";
import { db } from "@/server/db";
import { sendEmail } from "@/server/email";
import type { EmailMessage } from "@/server/email/types";
import { enqueueOpsAlert } from "@/server/notifications/outbox";
import { renderNotification } from "@/server/notifications/service";

import { claimQueueRows, decideRetry, describeError, workerId } from "./queue";

/**
 * Drains the notification outbox (docs/checkout.md §11.1): claim, render,
 * send with the dedupe key as the provider idempotency key, complete.
 * At-least-once; a crash between send and completion is covered by the key.
 */

export interface SendNotificationsOptions {
  readonly now?: Date;
  readonly worker?: string;
  readonly limit?: number;
  /** Injected by tests; defaults to the configured email transport. */
  readonly send?: (message: EmailMessage) => Promise<void>;
  /** Restrict to one row (the fast path right after a transaction). */
  readonly onlyId?: string;
}

export async function runSendNotifications(
  options: SendNotificationsOptions = {},
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const worker = options.worker ?? workerId("send-notifications");
  const policy = getCheckoutPolicy().jobs;
  const send = options.send ?? sendEmail;
  const summary = { claimed: 0, sent: 0, retried: 0, failed: 0 };

  const ids = await claimQueueRows({
    table: "notification_outbox",
    pendingStatus: "PENDING",
    limit: options.limit ?? 20,
    worker,
    now,
    policy,
    onlyId: options.onlyId,
  });
  summary.claimed = ids.length;

  for (const id of ids) {
    const row = await db.notificationOutbox.findUnique({ where: { id } });
    if (!row || row.status !== "PENDING") continue;
    try {
      const message = await renderNotification(row);
      await send({ ...message, idempotencyKey: row.dedupeKey });
      await db.notificationOutbox.update({
        where: { id },
        data: { status: "SENT", sentAt: now, claimedAt: null, lastError: null },
      });
      summary.sent += 1;
    } catch (error) {
      const retry = decideRetry(policy, row.attempts, now);
      const lastError = describeError(error);
      if (retry.giveUp) {
        await db.$transaction(async (tx) => {
          await tx.notificationOutbox.update({
            where: { id },
            data: { status: "FAILED", lastError, claimedAt: null },
          });
          if (row.kind !== "ops.alert") {
            await enqueueOpsAlert(tx, {
              key: `notification-failed:${id}`,
              orderId: row.orderId,
              payload: {
                reason: `Email ${row.kind} could not be sent`,
                recipient: row.recipient,
                notificationId: id,
                lastError,
              },
            });
          }
        });
        summary.failed += 1;
      } else {
        await db.notificationOutbox.update({
          where: { id },
          data: {
            nextAttemptAt: retry.nextAttemptAt,
            lastError,
            claimedAt: null,
          },
        });
        summary.retried += 1;
      }
    }
  }
  return summary;
}
