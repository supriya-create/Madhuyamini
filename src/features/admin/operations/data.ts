import "server-only";

import { getAdminPolicy } from "@/config/admin-policy";
import type { Prisma } from "@/generated/prisma/client";
import type {
  NotificationStatus,
  WebhookStatus,
} from "@/generated/prisma/enums";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { requirePermission } from "../authz";

/** Queue reads for the operations pages (docs/admin.md §5.6). */

type Tx = Prisma.TransactionClient;

export interface QueueCounts {
  readonly byStatus: Readonly<Record<string, number>>;
  readonly lastClaimedAt: Date | null;
  readonly dueNow: number;
}

async function queueCounts(
  tx: Tx,
  table: "notification_outbox" | "payment_webhook_events" | "refunds",
  pendingStatus: string,
  now: Date,
): Promise<QueueCounts> {
  const rows = await tx.$queryRawUnsafe<
    Array<{ status: string; count: number }>
  >(
    `SELECT status::text AS status, count(*)::int AS count FROM "${table}" GROUP BY status`,
  );
  const [claim] = await tx.$queryRawUnsafe<Array<{ last: Date | null }>>(
    `SELECT max(claimed_at) AS last FROM "${table}"`,
  );
  const [due] = await tx.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT count(*)::int AS count FROM "${table}" WHERE status::text = $1 AND next_attempt_at <= $2`,
    pendingStatus,
    now,
  );
  return {
    byStatus: Object.fromEntries(rows.map((row) => [row.status, row.count])),
    lastClaimedAt: claim?.last ?? null,
    dueNow: due?.count ?? 0,
  };
}

export interface OperationsCounts {
  readonly outbox: QueueCounts;
  readonly webhooks: QueueCounts;
  readonly refunds: QueueCounts;
  readonly pendingOrdersPastDeadline: number;
  readonly staleInitiatedAttempts: number;
  readonly orphanUploads: number;
}

export async function loadOperationsCounts(
  ctx: StaffContext,
  now = new Date(),
  tx: Tx = db,
): Promise<OperationsCounts> {
  await requirePermission(ctx, "operations.view", { tx });
  const [
    outbox,
    webhooks,
    refunds,
    pendingOrdersPastDeadline,
    staleInitiatedAttempts,
    orphanUploads,
  ] = await Promise.all([
    queueCounts(tx, "notification_outbox", "PENDING", now),
    queueCounts(tx, "payment_webhook_events", "RECEIVED", now),
    queueCounts(tx, "refunds", "INITIATED", now),
    tx.order.count({
      where: { status: "PENDING_PAYMENT", pendingExpiresAt: { lt: now } },
    }),
    tx.payment.count({ where: { status: "INITIATED" } }),
    tx.productImageUpload.count({ where: { status: "ISSUED" } }),
  ]);
  return {
    outbox,
    webhooks,
    refunds,
    pendingOrdersPastDeadline,
    staleInitiatedAttempts,
    orphanUploads,
  };
}

export const outboxRowSelect = {
  id: true,
  kind: true,
  dedupeKey: true,
  orderId: true,
  recipient: true,
  payload: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  claimedAt: true,
  lastError: true,
  sentAt: true,
  createdAt: true,
  order: { select: { orderNumber: true } },
} satisfies Prisma.NotificationOutboxSelect;

export type OutboxRow = Prisma.NotificationOutboxGetPayload<{
  select: typeof outboxRowSelect;
}>;

export async function listOutbox(
  ctx: StaffContext,
  filters: {
    readonly status: NotificationStatus | null;
    readonly kind: string | null;
  },
  tx: Tx = db,
): Promise<OutboxRow[]> {
  await requirePermission(ctx, "operations.view", { tx });
  return tx.notificationOutbox.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
    },
    select: outboxRowSelect,
    orderBy: { createdAt: "desc" },
    take: getAdminPolicy().lists.maxPageSize,
  });
}

export const webhookRowSelect = {
  id: true,
  eventType: true,
  status: true,
  providerOrderId: true,
  providerPaymentId: true,
  orderId: true,
  payload: true,
  attempts: true,
  nextAttemptAt: true,
  claimedAt: true,
  lastError: true,
  receivedAt: true,
  processedAt: true,
} satisfies Prisma.PaymentWebhookEventSelect;

export type WebhookRow = Prisma.PaymentWebhookEventGetPayload<{
  select: typeof webhookRowSelect;
}>;

export async function listWebhooks(
  ctx: StaffContext,
  filters: {
    readonly status: WebhookStatus | null;
    readonly eventType: string | null;
  },
  tx: Tx = db,
): Promise<WebhookRow[]> {
  await requirePermission(ctx, "operations.view", { tx });
  return tx.paymentWebhookEvent.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.eventType ? { eventType: filters.eventType } : {}),
    },
    select: webhookRowSelect,
    orderBy: { receivedAt: "desc" },
    take: getAdminPolicy().lists.maxPageSize,
  });
}

export async function listAlerts(
  ctx: StaffContext,
  tx: Tx = db,
): Promise<OutboxRow[]> {
  await requirePermission(ctx, "operations.view", { tx });
  return tx.notificationOutbox.findMany({
    where: { kind: "ops.alert" },
    select: outboxRowSelect,
    orderBy: { createdAt: "desc" },
    take: getAdminPolicy().lists.maxPageSize,
  });
}

/** Alerts a staff member has acknowledged, by outbox row id (audit-derived). */
export async function acknowledgedAlertIds(
  ctx: StaffContext,
  ids: readonly string[],
  tx: Tx = db,
): Promise<Set<string>> {
  await requirePermission(ctx, "operations.view", { tx });
  if (ids.length === 0) return new Set();
  const rows = await tx.adminAuditLog.findMany({
    where: {
      action: "alert.acknowledge",
      targetType: "outbox",
      outcome: "SUCCESS",
      targetId: { in: [...ids] },
    },
    select: { targetId: true },
  });
  return new Set(
    rows.map((row) => row.targetId).filter((id): id is string => id !== null),
  );
}
