import "server-only";

import type {
  NotificationStatus,
  WebhookStatus,
} from "@/generated/prisma/enums";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";
import { AppError, NotFoundError, isAppError } from "@/server/errors";
import { jobs, runJob } from "@/server/jobs";
import type { JobName } from "@/server/jobs";

import { actorFromContext, runAudited, writeAudit } from "../audit";
import { requirePermission } from "../authz";
import { maskEmail } from "../redact";
import {
  acknowledgedAlertIds,
  listAlerts,
  listOutbox,
  listWebhooks,
  loadOperationsCounts,
} from "./data";
import type { OperationsCounts, OutboxRow, WebhookRow } from "./data";
import { maskForRole } from "./mask";

/**
 * Operations monitoring (docs/admin.md §5.6, §6 A10, A12). Retries and
 * discards are row resets only: the workers do the work, with the same
 * leases and dedupe keys as always. "Run now" calls the same job function
 * the cron does and records two audit rows (before and after).
 */

export class OperationsError extends AppError {
  constructor(message: string, code = "OPERATIONS_NOT_ALLOWED") {
    super(message, { code, status: 409 });
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const JOB_NAMES = Object.keys(jobs) as JobName[];

export async function getOperationsCounts(
  ctx: StaffContext,
  now = new Date(),
): Promise<OperationsCounts> {
  return loadOperationsCounts(ctx, now);
}

export interface OutboxView {
  readonly id: string;
  readonly kind: string;
  readonly dedupeKey: string;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly recipient: string;
  readonly payload: unknown;
  readonly status: NotificationStatus;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  readonly lastError: string | null;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
  readonly canRetry: boolean;
  readonly canDiscard: boolean;
  readonly acknowledged: boolean;
}

function toOutboxView(
  row: OutboxRow,
  role: "STAFF" | "ADMIN",
  acknowledged: boolean,
): OutboxView {
  return {
    id: row.id,
    kind: row.kind,
    dedupeKey: row.dedupeKey,
    orderId: row.orderId,
    orderNumber: row.order?.orderNumber ?? null,
    recipient: role === "ADMIN" ? row.recipient : maskEmail(row.recipient),
    payload: maskForRole(row.payload, role),
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.lastError,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    canRetry: row.status === "FAILED",
    canDiscard: role === "ADMIN" && row.status !== "SENT",
    acknowledged,
  };
}

export async function getOutbox(
  ctx: StaffContext,
  filters: {
    readonly status: NotificationStatus | null;
    readonly kind: string | null;
  },
): Promise<OutboxView[]> {
  const rows = await listOutbox(ctx, filters);
  return rows.map((row) => toOutboxView(row, ctx.role, false));
}

export async function getAlerts(ctx: StaffContext): Promise<OutboxView[]> {
  const rows = await listAlerts(ctx);
  const acknowledged = await acknowledgedAlertIds(
    ctx,
    rows.map((row) => row.id),
  );
  return rows.map((row) =>
    toOutboxView(row, ctx.role, acknowledged.has(row.id)),
  );
}

export interface WebhookView {
  readonly id: string;
  readonly eventType: string;
  readonly status: WebhookStatus;
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly orderId: string | null;
  readonly payload: unknown;
  readonly attempts: number;
  readonly nextAttemptAt: Date;
  readonly lastError: string | null;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
  readonly canReapply: boolean;
}

function toWebhookView(row: WebhookRow, role: "STAFF" | "ADMIN"): WebhookView {
  return {
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    providerOrderId: row.providerOrderId,
    providerPaymentId: row.providerPaymentId,
    orderId: row.orderId,
    payload: maskForRole(row.payload, role),
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    lastError: row.lastError,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    canReapply: role === "ADMIN" && row.status !== "RECEIVED",
  };
}

export async function getWebhooks(
  ctx: StaffContext,
  filters: {
    readonly status: WebhookStatus | null;
    readonly eventType: string | null;
  },
): Promise<WebhookView[]> {
  const rows = await listWebhooks(ctx, filters);
  return rows.map((row) => toWebhookView(row, ctx.role));
}

// ---------------------------------------------------------------------------
// Queue row resets (A10)
// ---------------------------------------------------------------------------

export async function retryNotification(
  ctx: StaffContext,
  id: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "outbox.retry",
      targetType: "outbox",
      targetId: id,
      capability: "operations.retry_outbox",
      now,
    },
    async (tx) => {
      const row = await tx.notificationOutbox.findUnique({
        where: { id },
        select: {
          id: true,
          kind: true,
          status: true,
          attempts: true,
          recipient: true,
          lastError: true,
        },
      });
      if (!row) throw new NotFoundError("Notification");
      const reset = await tx.notificationOutbox.updateMany({
        where: { id, status: "FAILED" },
        data: {
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: now,
          claimedAt: null,
          claimedBy: null,
          lastError: null,
        },
      });
      if (reset.count !== 1) {
        throw new OperationsError("Only failed emails can be retried.");
      }
      return {
        result: undefined,
        before: row,
        after: { ...row, status: "PENDING", attempts: 0 },
      };
    },
  );
}

export async function discardNotification(
  ctx: StaffContext,
  id: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "outbox.discard",
      targetType: "outbox",
      targetId: id,
      capability: "operations.discard",
      reason,
      now,
    },
    async (tx) => {
      const row = await tx.notificationOutbox.findUnique({
        where: { id },
        select: {
          id: true,
          kind: true,
          status: true,
          attempts: true,
          recipient: true,
        },
      });
      if (!row) throw new NotFoundError("Notification");
      const updated = await tx.notificationOutbox.updateMany({
        where: { id, status: { not: "SENT" } },
        data: {
          status: "FAILED",
          lastError: `Discarded by staff: ${reason}`,
          claimedAt: null,
          claimedBy: null,
          // Far in the future, so no worker ever picks it up again.
          nextAttemptAt: new Date("2999-01-01T00:00:00Z"),
        },
      });
      if (updated.count !== 1) {
        throw new OperationsError("A sent email cannot be discarded.");
      }
      return {
        result: undefined,
        before: row,
        after: { ...row, status: "FAILED" },
      };
    },
  );
}

export async function reapplyWebhook(
  ctx: StaffContext,
  id: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "webhook.reapply",
      targetType: "webhook_event",
      targetId: id,
      capability: "operations.reapply_webhook",
      reason,
      now,
    },
    async (tx) => {
      const row = await tx.paymentWebhookEvent.findUnique({
        where: { id },
        select: { id: true, eventType: true, status: true, attempts: true },
      });
      if (!row) throw new NotFoundError("Webhook event");
      const reset = await tx.paymentWebhookEvent.updateMany({
        where: { id, status: { not: "RECEIVED" } },
        data: {
          status: "RECEIVED",
          attempts: 0,
          nextAttemptAt: now,
          claimedAt: null,
          claimedBy: null,
          lastError: null,
          processedAt: null,
        },
      });
      if (reset.count !== 1) {
        throw new OperationsError(
          "This event is already waiting to be applied.",
        );
      }
      return {
        result: undefined,
        before: row,
        after: { ...row, status: "RECEIVED", attempts: 0 },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Run a job now (A12: two audit rows)
// ---------------------------------------------------------------------------

export async function runJobNow(
  ctx: StaffContext,
  name: JobName,
  now = new Date(),
): Promise<Record<string, number>> {
  const actor = actorFromContext(ctx);
  try {
    await requirePermission(ctx, "operations.run_job", { now });
  } catch (error) {
    await writeAudit({
      actor,
      action: "job.run",
      targetType: "job",
      targetId: name,
      outcome: "REFUSED",
      errorCode: isAppError(error) ? error.code : "UNKNOWN",
    }).catch(() => undefined);
    throw error;
  }
  await writeAudit({
    actor,
    action: "job.run.started",
    targetType: "job",
    targetId: name,
    outcome: "SUCCESS",
    after: { name },
  });
  try {
    const summary = await runJob(name, { now });
    await writeAudit({
      actor,
      action: "job.run",
      targetType: "job",
      targetId: name,
      outcome: "SUCCESS",
      after: { name, summary: JSON.stringify(summary) },
    });
    return summary;
  } catch (error) {
    await writeAudit({
      actor,
      action: "job.run",
      targetType: "job",
      targetId: name,
      outcome: "FAILED",
      errorCode: isAppError(error) ? error.code : "UNEXPECTED",
    }).catch(() => undefined);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Alerts inbox: acknowledgement is an audit fact, nothing else changes
// ---------------------------------------------------------------------------

export async function acknowledgeAlert(
  ctx: StaffContext,
  id: string,
  now = new Date(),
): Promise<void> {
  await requirePermission(ctx, "operations.view", { now });
  const row = await db.notificationOutbox.findUnique({
    where: { id, kind: "ops.alert" },
    select: { id: true, kind: true, status: true },
  });
  if (!row) throw new NotFoundError("Alert");
  await writeAudit({
    actor: actorFromContext(ctx),
    action: "alert.acknowledge",
    targetType: "outbox",
    targetId: id,
    outcome: "SUCCESS",
    after: row,
  });
}
