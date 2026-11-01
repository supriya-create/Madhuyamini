import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { StaffGateError } from "@/server/auth/staff";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";

import { actorFromContext, writeAudit } from "./audit-log";
import { requirePermission } from "./authz";
import type { Capability } from "./capabilities";

export {
  actorFromContext,
  hashRequestIp,
  scriptActor,
  systemActor,
  writeAudit,
} from "./audit-log";
export type { AuditActor, AuditEntry } from "./audit-log";

/**
 * Audit atomicity (docs/admin.md §6). `runAudited` is the one entry point
 * for admin mutations: a SUCCESS row commits with the change; REFUSED and
 * FAILED rows are written in their own transaction after the business
 * transaction rolled back, so every attempt leaves a trace.
 */

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
  /** Replaces the reason given up front (for example with provider evidence). */
  readonly reason?: string;
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
          reason: outcome.reason ?? base.reason,
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

/**
 * For operations that must talk to the provider or run their own
 * transactions (re-check, attach a payment, external refunds, run a job):
 * authorise first (REFUSED on failure), run the work with no transaction
 * open, then record SUCCESS or FAILED in a transaction of its own. The work
 * itself is responsible for its atomicity (docs/admin.md §6 A6, A8, A12).
 */
export async function runAuditedExternal<T>(
  options: RunAuditedOptions,
  work: () => Promise<AuditedWork<T>>,
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
  try {
    const outcome = await work();
    await writeAudit({
      ...base,
      outcome: "SUCCESS",
      targetId: outcome.targetId ?? base.targetId,
      reason: outcome.reason ?? base.reason,
      before: outcome.before,
      after: outcome.after,
    });
    return outcome.result;
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
