import "server-only";

import { backoffMinutesFor, minutesToMs } from "@/config/checkout-policy";
import type { CheckoutPolicy } from "@/config/checkout-policy";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

/**
 * The one worker contract for every queue table (docs/checkout.md §5.8):
 * claim a small batch atomically with `FOR UPDATE SKIP LOCKED`, do the
 * external work outside any transaction, then complete the row. A crashed
 * worker's claims lapse with the lease and are picked up again.
 *
 * Only the claim is generic SQL; completion is typed per queue in its job.
 */

/** Queue tables and the enum type of their `status` column (for the cast). */
const QUEUES = {
  refunds: { statusType: "refund_status" },
  payment_webhook_events: { statusType: "webhook_status" },
  notification_outbox: { statusType: "notification_status" },
} as const;

export type QueueTable = keyof typeof QUEUES;

export interface ClaimOptions {
  readonly table: QueueTable;
  /** Rows in this status are eligible (e.g. PENDING, RECEIVED, INITIATED). */
  readonly pendingStatus: string;
  readonly limit: number;
  readonly worker: string;
  readonly now: Date;
  readonly policy: CheckoutPolicy["jobs"];
  /** Claim this one row only (the fast path right after a transaction). */
  readonly onlyId?: string;
}

/**
 * Claims up to `limit` due rows that no live worker holds, bumping their
 * attempt count. Returns the claimed ids; the job loads them with Prisma.
 */
export async function claimQueueRows(options: ClaimOptions): Promise<string[]> {
  const { table, pendingStatus, limit, worker, now, policy, onlyId } = options;
  const leaseCutoff = new Date(
    now.getTime() - minutesToMs(policy.leaseMinutes),
  );
  const tableName = Prisma.raw(`"${table}"`);
  const statusType = Prisma.raw(QUEUES[table].statusType);

  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE ${tableName}
       SET claimed_at = ${now}, claimed_by = ${worker}, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM ${tableName}
        WHERE status = ${pendingStatus}::${statusType}
          AND (${onlyId ?? null}::uuid IS NULL OR id = ${onlyId ?? null}::uuid)
          AND next_attempt_at <= ${now}
          AND (claimed_at IS NULL OR claimed_at < ${leaseCutoff})
        ORDER BY next_attempt_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id
  `);
  return rows.map((row) => row.id);
}

export interface RetryDecision {
  /** True when the row has used up its attempts and must be marked FAILED. */
  readonly giveUp: boolean;
  readonly nextAttemptAt: Date;
}

/** Where a failed attempt goes next: backoff from the schedule, or give up. */
export function decideRetry(
  policy: CheckoutPolicy["jobs"],
  attemptsSoFar: number,
  now: Date,
): RetryDecision {
  const giveUp = attemptsSoFar >= policy.maxAttempts;
  return {
    giveUp,
    nextAttemptAt: new Date(
      now.getTime() + minutesToMs(backoffMinutesFor(policy, attemptsSoFar)),
    ),
  };
}

/** A stable, log-friendly worker id for this process and invocation. */
export function workerId(job: string): string {
  return `${job}@${process.pid}:${Date.now().toString(36)}`;
}

/** Messages stored in `last_error`; never a stack or a secret. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "Unknown error";
}
