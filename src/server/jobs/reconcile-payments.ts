import "server-only";

import {
  backoffMinutesFor,
  getCheckoutPolicy,
  hoursToMs,
  minutesToMs,
} from "@/config/checkout-policy";
import * as orders from "@/features/orders/data";
import * as payments from "@/features/payments/data";
import {
  ensureProviderOrder,
  reconcileAttempt,
} from "@/features/payments/service";
import { db } from "@/server/db";

/** Append-only record that a cancelled order's attempt was checked and found uncaptured. */
const RECONCILE_CHECK_EVENT = "payment.reconcile_checked";

/**
 * Asks the provider about attempts nobody has told us about, so a capture
 * whose webhook and callback were both missed is never lost
 * (docs/checkout.md §5.8):
 *
 * 1. open or failed attempts of pending orders → confirm or record failure;
 * 2. uncaptured attempts of recently cancelled orders → refund, never revive
 *    (§9 #28). Each attempt is checked on the jobs' backoff schedule, counted
 *    from append-only check events, until the window closes.
 */
export async function runReconcilePayments(
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const policy = getCheckoutPolicy();
  const olderThan = new Date(
    now.getTime() - minutesToMs(policy.payment.reconcileAfterMinutes),
  );
  const limit = options.limit ?? 50;
  const summary = {
    examined: 0,
    captured: 0,
    failed: 0,
    unchanged: 0,
    errors: 0,
    cancelledExamined: 0,
    cancelledRefunded: 0,
    cancelledUnchanged: 0,
    cancelledErrors: 0,
  };
  for (const { id } of await payments.findAttemptsToReconcile(
    olderThan,
    limit,
  )) {
    summary.examined += 1;
    try {
      const outcome = await reconcileAttempt(id, now);
      if (outcome.kind === "captured") summary.captured += 1;
      else if (outcome.kind === "failed") summary.failed += 1;
      else summary.unchanged += 1;
    } catch {
      summary.errors += 1;
    }
  }

  const cancelledSince = new Date(
    now.getTime() - hoursToMs(policy.payment.reconcileCancelledWithinHours),
  );
  for (const attempt of await payments.findCancelledAttemptsToReconcile(
    cancelledSince,
    limit,
  )) {
    const checks = await db.orderEvent.findMany({
      where: {
        orderId: attempt.orderId,
        type: RECONCILE_CHECK_EVENT,
        data: { path: ["attemptId"], equals: attempt.id },
      },
      select: { createdAt: true, data: true },
      orderBy: { createdAt: "desc" },
    });
    // Checks are timed on the job's clock (stored in the event), like every
    // other deadline here; the row's own timestamp is the database's.
    const last =
      (checks[0] ? checkedAtOf(checks[0]) : null) ??
      attempt.order.cancelledAt ??
      now;
    const dueAt = new Date(
      last.getTime() +
        (checks.length === 0
          ? minutesToMs(policy.payment.reconcileAfterMinutes)
          : minutesToMs(backoffMinutesFor(policy.jobs, checks.length))),
    );
    if (dueAt > now) continue;

    summary.cancelledExamined += 1;
    try {
      const outcome = await reconcileAttempt(attempt.id, now, {
        lateCapture: "refund",
      });
      if (outcome.kind === "captured") {
        summary.cancelledRefunded += 1;
        continue;
      }
      summary.cancelledUnchanged += 1;
      await db.$transaction((tx) =>
        orders.recordOrderEvent(tx, {
          orderId: attempt.orderId,
          type: RECONCILE_CHECK_EVENT,
          actor: "CRON",
          data: {
            attemptId: attempt.id,
            attemptNo: attempt.attemptNo,
            check: checks.length + 1,
            checkedAt: now.toISOString(),
            result: outcome.kind,
          },
        }),
      );
    } catch {
      summary.cancelledErrors += 1;
    }
  }
  return summary;
}

function checkedAtOf(event: { createdAt: Date; data: unknown }): Date | null {
  const data = event.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const value = (data as Record<string, unknown>).checkedAt;
    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
  }
  return event.createdAt;
}

/**
 * Attempts whose provider order was never persisted (the process died
 * between S1 and S3, or the provider was down): find or create it by receipt.
 */
export async function runRecoverPayments(
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const policy = getCheckoutPolicy();
  const olderThan = new Date(
    now.getTime() - minutesToMs(policy.payment.reconcileAfterMinutes),
  );
  const summary = { examined: 0, created: 0, failed: 0, pending: 0 };
  for (const { id } of await payments.findStaleInitiatedAttempts(
    olderThan,
    options.limit ?? 50,
  )) {
    summary.examined += 1;
    const outcome = await ensureProviderOrder(id, now);
    if (outcome.status === "CREATED") summary.created += 1;
    else if (outcome.status === "FAILED") summary.failed += 1;
    else summary.pending += 1;
  }
  return summary;
}
