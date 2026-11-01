import "server-only";

import type { RateLimitRule } from "@/server/auth/rate-limit";
import { consumeRateLimit, rateLimitKey } from "@/server/auth/rate-limit";
import type { StaffContext } from "@/server/auth/staff";
import { AppError } from "@/server/errors";

import { actorFromContext, writeAudit } from "./audit-log";

/**
 * Per-actor ceilings on the operations that move money or data in bulk
 * (docs/admin.md §5.9, `adminPolicy.limits`). Attempts count whether or not
 * they go on to succeed; a trip is recorded as a REFUSED audit row.
 */

export class AdminRateLimitedError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(
      "Too many of these in a short time. Please wait before trying again.",
      {
        code: "ADMIN_RATE_LIMITED",
        status: 429,
      },
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function enforceActorLimit(
  ctx: StaffContext,
  scope: string,
  rule: RateLimitRule,
  audit: {
    readonly action: string;
    readonly targetType: string;
    readonly targetId?: string | null;
  },
): Promise<void> {
  const outcome = await consumeRateLimit(
    rateLimitKey(`admin:${scope}`, ctx.user.id),
    rule,
  );
  if (outcome.allowed) return;
  await writeAudit({
    actor: actorFromContext(ctx),
    action: audit.action,
    targetType: audit.targetType,
    targetId: audit.targetId ?? null,
    outcome: "REFUSED",
    errorCode: "ADMIN_RATE_LIMITED",
  }).catch(() => undefined);
  throw new AdminRateLimitedError(outcome.retryAfterSeconds);
}
