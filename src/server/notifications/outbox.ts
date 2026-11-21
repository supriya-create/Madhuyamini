import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { env } from "@/server/env";

/**
 * Durable notification queue (docs/checkout.md §11). Rows are written in the
 * transaction that creates the fact they announce; `dedupeKey` makes a
 * repeated transition a no-op. A row with no recipient is stored as SKIPPED:
 * the fact is recorded, nothing is sent, and the sender never claims it.
 * Rendering and sending live in `src/server/notifications/service.ts` and
 * the send-notifications job.
 */

export type NotificationKind =
  | "order.confirmed"
  | "order.cancelled"
  | "order.refund_requested"
  | "owner.new_order"
  | "ops.alert"
  | "security.recovery_code_used"
  | "order.shipped"
  | "order.delivered"
  | "order.delivery_failed"
  | "return.requested"
  | "return.info_requested"
  | "return.approved"
  | "return.rejected"
  | "return.received"
  | "return.inspected"
  | "return.expired"
  | "return.withdrawn"
  | "owner.return_requested";

export interface EnqueueNotification {
  readonly kind: NotificationKind;
  readonly orderId: string | null;
  /** Null records the fact without sending anything (status SKIPPED). */
  readonly recipient: string | null;
  /** Everything the template needs, captured now so a retry renders the same email. */
  readonly payload: Prisma.InputJsonValue;
  /** Defaults to `${kind}:${orderId}`; alerts pass their own. */
  readonly dedupeKey?: string;
}

/** Queues one email per fact; a duplicate key is silently ignored. */
export async function enqueueNotification(
  tx: Prisma.TransactionClient,
  input: EnqueueNotification,
): Promise<void> {
  const dedupeKey =
    input.dedupeKey ?? `${input.kind}:${input.orderId ?? "none"}`;
  await tx.notificationOutbox.createMany({
    data: [
      {
        kind: input.kind,
        dedupeKey,
        orderId: input.orderId,
        recipient: input.recipient,
        status: input.recipient === null ? "SKIPPED" : "PENDING",
        payload: input.payload,
      },
    ],
    skipDuplicates: true,
  });
}

/** Confirmation for the customer and, when an owner inbox is configured, a new-order notice. */
export async function enqueueOrderConfirmed(
  tx: Prisma.TransactionClient,
  input: { orderId: string; orderNumber: string; customerEmail: string },
): Promise<void> {
  const payload = { orderId: input.orderId, orderNumber: input.orderNumber };
  await enqueueNotification(tx, {
    kind: "order.confirmed",
    orderId: input.orderId,
    recipient: input.customerEmail,
    payload,
  });
  if (env.notifications.ownerEmail) {
    await enqueueNotification(tx, {
      kind: "owner.new_order",
      orderId: input.orderId,
      recipient: env.notifications.ownerEmail,
      payload,
    });
  }
}

/**
 * An operations alert, deduped by `key`. Always a row: with an inbox
 * configured it is queued for email; without one it is stored SKIPPED so the
 * admin alerts inbox still lists it. `options.inbox` exists for tests.
 */
export async function enqueueOpsAlert(
  tx: Prisma.TransactionClient,
  input: {
    key: string;
    orderId: string | null;
    payload: Prisma.InputJsonValue;
  },
  options: { readonly inbox?: string | null } = {},
): Promise<void> {
  const inbox =
    options.inbox === undefined ? env.notifications.ownerEmail : options.inbox;
  await enqueueNotification(tx, {
    kind: "ops.alert",
    orderId: input.orderId,
    recipient: inbox,
    payload: input.payload,
    dedupeKey: `ops.alert:${input.key}`,
  });
}
