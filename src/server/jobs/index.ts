import "server-only";

import { runCleanup } from "./cleanup";
import { runExpireReservations } from "./expire-reservations";
import { runProcessWebhooks } from "./process-webhooks";
import { runReconcilePayments, runRecoverPayments } from "./reconcile-payments";
import { runRefundPayments } from "./refund-payments";
import { runSendNotifications } from "./send-notifications";

/**
 * The scheduled jobs (docs/checkout.md §5.8), each a plain function that
 * returns counts. The cron routes, `npm run job -- <name>` and the tests all
 * call the same functions.
 */

export const jobs = {
  "expire-reservations": runExpireReservations,
  "recover-payments": runRecoverPayments,
  "reconcile-payments": runReconcilePayments,
  "process-webhooks": runProcessWebhooks,
  "refund-payments": runRefundPayments,
  "send-notifications": runSendNotifications,
  cleanup: runCleanup,
} as const;

export type JobName = keyof typeof jobs;

export function isJobName(value: string): value is JobName {
  return Object.hasOwn(jobs, value);
}

export async function runJob(
  name: JobName,
  options: { readonly now?: Date } = {},
): Promise<Record<string, number>> {
  const started = Date.now();
  const summary = await jobs[name](options);
  return { ...summary, durationMs: Date.now() - started };
}
