import "server-only";

import { getCheckoutPolicy, secondsToMs } from "@/config/checkout-policy";
import * as orders from "@/features/orders/data";
import {
  expireOverdueOrder,
  reportExpiryFailure,
} from "@/features/payments/expiry";

/**
 * The expiry sweep (docs/checkout.md T8, §5.6): every pending online order
 * past its deadline goes through `expireOverdueOrder`. One order's failure
 * never stops the run: the order is set aside for this invocation, counted
 * under `errors`, reported (an operations alert, or the server log when the
 * alert cannot be written), and tried again by the next invocation. Only
 * the provider not answering counts as `unverified`; an internal error
 * never does. Batches continue until no candidate is left or the run's time
 * budget is spent; whatever remains waits for the next scheduled run. Two
 * sweeps may run at once: the order row lock and the re-check inside it
 * make the second a no-op.
 */

export interface ExpireReservationsOptions {
  readonly now?: Date;
  /** Candidates fetched per batch. */
  readonly limit?: number;
  /** Wall-clock budget for this run; defaults to the policy. */
  readonly budgetMs?: number;
}

export async function runExpireReservations(
  options: ExpireReservationsOptions = {},
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const batchSize = options.limit ?? 50;
  const budgetMs =
    options.budgetMs ?? secondsToMs(getCheckoutPolicy().jobs.runBudgetSeconds);
  const startedAt = Date.now();
  const summary = {
    examined: 0,
    cancelled: 0,
    confirmed: 0,
    unverified: 0,
    skipped: 0,
    errors: 0,
    deferred: 0,
  };
  // Everything this run has looked at, whatever the outcome, so an order
  // that stays pending (unverified, failed) is never fetched again here.
  const handled: string[] = [];

  for (;;) {
    const candidates = await orders.findExpiredPendingOrderIds(
      now,
      batchSize,
      handled,
    );
    if (candidates.length === 0) break;
    for (const [index, { id }] of candidates.entries()) {
      if (Date.now() - startedAt >= budgetMs) {
        summary.deferred += candidates.length - index;
        return summary;
      }
      handled.push(id);
      summary.examined += 1;
      try {
        const outcome = await expireOverdueOrder(id, now);
        summary[outcome.kind] += 1;
      } catch (error) {
        // Ours, not the provider's. Counted before it is reported, and the
        // report never throws, so the run always reaches the next order.
        summary.errors += 1;
        await reportExpiryFailure(id, error, now);
      }
    }
    if (candidates.length < batchSize) break;
  }
  return summary;
}
