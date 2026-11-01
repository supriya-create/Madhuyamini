import "server-only";

import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { AuditOutcome, UserRole } from "@/generated/prisma/enums";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { redactForAudit } from "./redact";

/**
 * Writing audit rows (docs/admin.md §6). Kept apart from the authorisation
 * layer so jobs and scripts can record what they did without pulling in
 * request-scoped modules. Nothing here stores a secret, a stack or a
 * free-text error.
 */

export interface AuditActor {
  readonly actorId: string | null;
  readonly actorLabel: string;
  readonly actorRole: UserRole | null;
  readonly sessionId: string | null;
}

export function actorFromContext(ctx: StaffContext): AuditActor {
  return {
    actorId: ctx.user.id,
    actorLabel: `user:${ctx.user.id}`,
    actorRole: ctx.role,
    sessionId: ctx.sessionId,
  };
}

export function scriptActor(script: string, host: string): AuditActor {
  return {
    actorId: null,
    actorLabel: `script:${script}@${host}`,
    actorRole: null,
    sessionId: null,
  };
}

export function systemActor(job: string): AuditActor {
  return {
    actorId: null,
    actorLabel: `system:${job}`,
    actorRole: null,
    sessionId: null,
  };
}

export function hashRequestIp(
  address: string | null | undefined,
): string | null {
  if (!address) return null;
  return createHash("sha256").update(address).digest("base64url").slice(0, 24);
}

export interface AuditEntry {
  /** Pre-generated when rows written in the same transaction reference it. */
  readonly id?: string;
  readonly actor: AuditActor;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  readonly outcome: AuditOutcome;
  readonly reason?: string | null;
  readonly errorCode?: string | null;
  readonly grantId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly requestIp?: string | null;
}

/** Inserts one row; `tx` makes it part of the caller's transaction. */
export async function writeAudit(
  entry: AuditEntry,
  tx: Prisma.TransactionClient = db,
): Promise<{ id: string }> {
  return tx.adminAuditLog.create({
    data: {
      id: entry.id,
      actorId: entry.actor.actorId,
      actorLabel: entry.actor.actorLabel,
      actorRole: entry.actor.actorRole,
      sessionId: entry.actor.sessionId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      outcome: entry.outcome,
      reason: entry.reason ?? null,
      errorCode: entry.errorCode ?? null,
      grantId: entry.grantId ?? null,
      before: redactForAudit(entry.targetType, entry.before),
      after: redactForAudit(entry.targetType, entry.after),
      requestIp: hashRequestIp(entry.requestIp),
    },
    select: { id: true },
  });
}
