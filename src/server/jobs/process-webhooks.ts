import "server-only";

import { getCheckoutPolicy, minutesToMs } from "@/config/checkout-policy";
import { processWebhookEvent } from "@/features/payments/webhook";
import { db } from "@/server/db";

import { workerId } from "./queue";

/** Re-applies stored webhook deliveries that failed inline or were never applied. */
export async function runProcessWebhooks(
  options: {
    readonly now?: Date;
    readonly limit?: number;
    readonly worker?: string;
  } = {},
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const worker = options.worker ?? workerId("process-webhooks");
  const policy = getCheckoutPolicy().jobs;
  const leaseCutoff = new Date(
    now.getTime() - minutesToMs(policy.leaseMinutes),
  );
  const summary = {
    examined: 0,
    processed: 0,
    ignored: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };

  const due = await db.paymentWebhookEvent.findMany({
    where: {
      status: "RECEIVED",
      nextAttemptAt: { lte: now },
      OR: [{ claimedAt: null }, { claimedAt: { lt: leaseCutoff } }],
    },
    select: { id: true },
    orderBy: { nextAttemptAt: "asc" },
    take: options.limit ?? 50,
  });
  for (const { id } of due) {
    summary.examined += 1;
    const outcome = await processWebhookEvent(id, { now, worker });
    if (outcome === "processed") summary.processed += 1;
    else if (outcome === "ignored") summary.ignored += 1;
    else if (outcome === "retry_scheduled") summary.retried += 1;
    else if (outcome === "failed") summary.failed += 1;
    else summary.skipped += 1;
  }
  return summary;
}
