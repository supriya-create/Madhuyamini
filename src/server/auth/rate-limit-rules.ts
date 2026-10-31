import { createHash } from "node:crypto";

/**
 * Pure rate-limit rules (D5): window arithmetic, key hashing and the agreed
 * limits. No I/O, so unit tests and the database module share them. Keys
 * never contain raw emails or IPs. Blocks lapse with the window: there are
 * no account lockouts.
 */

export interface RateLimitRule {
  /** Window length in seconds. */
  readonly windowSeconds: number;
  /** Maximum attempts within the window. */
  readonly max: number;
}

export interface RateLimitOutcome {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the window resets (0 when allowed and fresh). */
  readonly retryAfterSeconds: number;
}

/** Limits agreed in docs/auth.md. Attempts are counted whether or not they succeed. */
export const authRateLimits = {
  signInByIp: { windowSeconds: 15 * 60, max: 10 },
  signInByEmail: { windowSeconds: 15 * 60, max: 5 },
  registerByIp: { windowSeconds: 60 * 60, max: 5 },
  resetRequestByEmail: { windowSeconds: 60 * 60, max: 3 },
  resetRequestByIp: { windowSeconds: 60 * 60, max: 10 },
  verificationResendByEmail: { windowSeconds: 60 * 60, max: 3 },
} as const satisfies Record<string, RateLimitRule>;

export function hashIdentifier(value: string): string {
  return createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("base64url")
    .slice(0, 24);
}

export function rateLimitKey(scope: string, identifier: string): string {
  return `${scope}:${hashIdentifier(identifier)}`;
}

/**
 * Pure window arithmetic, shared by the SQL below and the unit tests.
 * `lastRequest` is the start of the current window in epoch milliseconds.
 */
export function evaluateWindow(
  rule: RateLimitRule,
  state: { readonly count: number; readonly lastRequest: number },
  now: number,
): RateLimitOutcome {
  const windowMs = rule.windowSeconds * 1000;
  const expired = now - state.lastRequest >= windowMs;
  const count = expired ? 1 : state.count;
  const allowed = count <= rule.max;
  const resetAt = (expired ? now : state.lastRequest) + windowMs;
  return {
    allowed,
    remaining: Math.max(0, rule.max - count),
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((resetAt - now) / 1000)),
  };
}
