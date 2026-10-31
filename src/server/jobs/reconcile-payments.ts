import "server-only";

import { getCheckoutPolicy, minutesToMs } from "@/config/checkout-policy";
import * as payments from "@/features/payments/data";
import {
  ensureProviderOrder,
  reconcileAttempt,
} from "@/features/payments/service";

/**
 * Asks the provider about open attempts that have been quiet for a while, so
 * a capture whose webhook and callback were both missed still confirms the
 * order (docs/checkout.md §5.8).
 */
export async function runReconcilePayments(
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const policy = getCheckoutPolicy();
  const olderThan = new Date(
    now.getTime() - minutesToMs(policy.payment.reconcileAfterMinutes),
  );
  const summary = {
    examined: 0,
    captured: 0,
    failed: 0,
    unchanged: 0,
    errors: 0,
  };
  for (const { id } of await payments.findAttemptsToReconcile(
    olderThan,
    options.limit ?? 50,
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
  return summary;
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
