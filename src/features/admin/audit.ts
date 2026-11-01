import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { AuditOutcome, UserRole } from "@/generated/prisma/enums";
import { StaffGateError } from "@/server/auth/staff";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";

import { requirePermission } from "./authz";
import type { Capability } from "./capabilities";
import { redactForAudit } from "./redact";

/**
 * Audit atomicity (docs/admin.md §6). `runAudited` is the one entry point
 * for admin mutations: a SUCCESS row commits with the change; REFUSED and
 * FAILED rows are written in their own transaction after the business
 * transaction rolled back, so every attempt leaves a trace. Nothing here
 * stores a secret, a stack or a free-text error.
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

export interface RunAuditedOptions {
  readonly ctx: StaffContext;
  readonly action: string;
  readonly targetType: string;
  readonly targetId?: string | null;
  /** Checked (with re-authentication where sensitive) before anything runs. */
  readonly capability: Capability;
  readonly reason?: string | null;
  readonly requestIp?: string | null;
  readonly grantId?: string | null;
  readonly now?: Date;
}

export interface AuditedWork<T> {
  readonly result: T;
  readonly before?: unknown;
  readonly after?: unknown;
  /** When the target id is only known after the work (creates). */
  readonly targetId?: string;
}

/**
 * Authorise → run the work in one transaction ending with the SUCCESS audit
 * row → on refusal or failure, record it separately and rethrow.
 *
 * The audit table is append-only (trigger and privileges), so the SUCCESS
 * row is written once, last, with the snapshots the work returned. Its id
 * is generated first and handed to the work so rows such as inventory
 * adjustments can reference it within the same transaction.
 */
export async function runAudited<T>(
  options: RunAuditedOptions,
  work: (
    tx: Prisma.TransactionClient,
    audit: { readonly id: string },
  ) => Promise<AuditedWork<T>>,
): Promise<T> {
  const actor = actorFromContext(options.ctx);
  const base = {
    actor,
    action: options.action,
    targetType: options.targetType,
    targetId: options.targetId ?? null,
    reason: options.reason ?? null,
    requestIp: options.requestIp ?? null,
    grantId: options.grantId ?? null,
  };

  try {
    await requirePermission(options.ctx, options.capability, {
      now: options.now,
    });
  } catch (error) {
    await writeAudit({
      ...base,
      outcome: "REFUSED",
      errorCode: isAppError(error) ? error.code : "UNKNOWN",
    }).catch(() => undefined);
    throw error;
  }

  const auditId = randomUUID();
  try {
    return await db.$transaction(async (tx) => {
      const outcome = await work(tx, { id: auditId });
      // Same transaction: no work, no row; no row, no work.
      await writeAudit(
        {
          ...base,
          id: auditId,
          outcome: "SUCCESS",
          targetId: outcome.targetId ?? base.targetId,
          before: outcome.before,
          after: outcome.after,
        },
        tx,
      );
      return outcome.result;
    });
  } catch (error) {
    if (!(error instanceof StaffGateError)) {
      await writeAudit({
        ...base,
        outcome: "FAILED",
        errorCode: isAppError(error) ? error.code : "UNEXPECTED",
      }).catch(() => undefined);
    }
    throw error;
  }
}
