import { db } from "@/server/db";

import { evaluateWindow } from "./rate-limit-rules";
import type { RateLimitOutcome, RateLimitRule } from "./rate-limit-rules";

export * from "./rate-limit-rules";

/**
 * Fixed-window counters on PostgreSQL. One atomic upsert per check, so
 * concurrent requests cannot slip past the limit.
 */

/** Counts an attempt against `key` and reports whether it is allowed. */
export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  now = Date.now(),
): Promise<RateLimitOutcome> {
  const windowMs = rule.windowSeconds * 1000;
  const rows = await db.$queryRaw<
    Array<{ count: number; last_request: bigint }>
  >`
    INSERT INTO rate_limits (id, key, count, last_request)
    VALUES (gen_random_uuid(), ${key}, 1, ${BigInt(now)})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN ${BigInt(now)} - rate_limits.last_request >= ${BigInt(windowMs)} THEN 1
        ELSE rate_limits.count + 1
      END,
      last_request = CASE
        WHEN ${BigInt(now)} - rate_limits.last_request >= ${BigInt(windowMs)} THEN ${BigInt(now)}
        ELSE rate_limits.last_request
      END
    RETURNING count, last_request
  `;
  const row = rows[0];
  if (!row) throw new Error("rate limit upsert returned no row");
  return evaluateWindow(
    rule,
    { count: row.count, lastRequest: Number(row.last_request) },
    now,
  );
}

/** Removes counters whose window ended more than `olderThanSeconds` ago. */
export async function cleanupRateLimits(
  olderThanSeconds = 24 * 60 * 60,
  now = Date.now(),
) {
  const threshold = BigInt(now - olderThanSeconds * 1000);
  const result = await db.rateLimit.deleteMany({
    where: { lastRequest: { lt: threshold } },
  });
  return result.count;
}

/** Thrown by auth actions when a limit is hit; mapped to a generic "try again later". */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many attempts");
    this.name = "RateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
