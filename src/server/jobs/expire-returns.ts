import "server-only";

import * as orders from "@/features/orders/data";
import { lockReturnRequest, recordReturnEvent } from "@/features/returns/data";
import { nextReturnStatus } from "@/features/returns/transitions";
import { db } from "@/server/db";
import {
  enqueueNotification,
  enqueueOpsAlert,
} from "@/server/notifications/outbox";

/**
 * Return clocks (docs/phase-8-returns-custom-artwork.md §10.1): an approved
 * return the customer never shipped expires; a parcel not received by its
 * date becomes overdue with an owner alert; a request past its decision
 * date raises a daily alert. Every move is a status-guarded transition under
 * the order and request locks, so overlapping runs change nothing twice.
 */

export async function runExpireReturns(
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;
  const summary = { expired: 0, overdue: 0, decisionAlerts: 0, errors: 0 };

  const expiring = await db.returnRequest.findMany({
    where: { status: "APPROVED", shipByAt: { lt: now } },
    select: { id: true },
    orderBy: { shipByAt: "asc" },
    take: limit,
  });
  for (const { id } of expiring) {
    try {
      await db.$transaction(async (tx) => {
        const preview = await tx.returnRequest.findUnique({
          where: { id },
          select: { orderId: true },
        });
        if (!preview) return;
        await orders.lockOrder(tx, preview.orderId);
        await lockReturnRequest(tx, id);
        const row = await tx.returnRequest.findUnique({
          where: { id },
          select: {
            id: true,
            status: true,
            shipByAt: true,
            orderId: true,
            requestNumber: true,
            order: { select: { email: true, orderNumber: true } },
          },
        });
        if (
          !row ||
          row.status !== "APPROVED" ||
          !row.shipByAt ||
          row.shipByAt >= now
        )
          return;
        const next = nextReturnStatus(row.status, "expire");
        if (!next) return;
        await tx.returnRequest.updateMany({
          where: { id, status: "APPROVED" },
          data: { status: next, closedAt: now },
        });
        await recordReturnEvent(tx, {
          returnRequestId: id,
          type: "return.expired",
          actor: "CRON",
          fromStatus: row.status,
          toStatus: next,
          note: "The parcel was not sent by the ship-by date.",
          at: now,
        });
        await enqueueNotification(tx, {
          kind: "return.expired",
          orderId: row.orderId,
          recipient: row.order.email,
          dedupeKey: `return.expired:${id}`,
          payload: {
            requestNumber: row.requestNumber,
            orderNumber: row.order.orderNumber,
          },
        });
        summary.expired += 1;
      });
    } catch {
      summary.errors += 1;
    }
  }

  const overdue = await db.returnRequest.findMany({
    where: { status: "IN_TRANSIT", receiveByAt: { lt: now } },
    select: { id: true },
    orderBy: { receiveByAt: "asc" },
    take: limit,
  });
  for (const { id } of overdue) {
    try {
      await db.$transaction(async (tx) => {
        const preview = await tx.returnRequest.findUnique({
          where: { id },
          select: { orderId: true },
        });
        if (!preview) return;
        await orders.lockOrder(tx, preview.orderId);
        await lockReturnRequest(tx, id);
        const row = await tx.returnRequest.findUnique({
          where: { id },
          select: {
            status: true,
            receiveByAt: true,
            orderId: true,
            requestNumber: true,
            order: { select: { orderNumber: true } },
          },
        });
        if (
          !row ||
          row.status !== "IN_TRANSIT" ||
          !row.receiveByAt ||
          row.receiveByAt >= now
        )
          return;
        const next = nextReturnStatus(row.status, "overdue");
        if (!next) return;
        await tx.returnRequest.updateMany({
          where: { id, status: "IN_TRANSIT" },
          data: { status: next },
        });
        await recordReturnEvent(tx, {
          returnRequestId: id,
          type: "return.overdue",
          actor: "CRON",
          fromStatus: row.status,
          toStatus: next,
          visibleToCustomer: false,
          at: now,
        });
        await enqueueOpsAlert(tx, {
          key: `return-overdue:${id}`,
          orderId: row.orderId,
          payload: {
            reason: "A return parcel has not arrived by its expected date",
            requestNumber: row.requestNumber,
            orderNumber: row.order.orderNumber,
          },
        });
        summary.overdue += 1;
      });
    } catch {
      summary.errors += 1;
    }
  }

  const day = now.toISOString().slice(0, 10); // policy-literal-ok: ISO date prefix
  const awaiting = await db.returnRequest.findMany({
    where: { status: "REQUESTED", decisionDueAt: { lt: now } },
    select: {
      id: true,
      orderId: true,
      requestNumber: true,
      order: { select: { orderNumber: true } },
    },
    orderBy: { decisionDueAt: "asc" },
    take: limit,
  });
  for (const row of awaiting) {
    try {
      await db.$transaction(async (tx) => {
        await enqueueOpsAlert(tx, {
          key: `return-decision-due:${row.id}:${day}`,
          orderId: row.orderId,
          payload: {
            reason: "A return request is waiting for a decision",
            requestNumber: row.requestNumber,
            orderNumber: row.order.orderNumber,
          },
        });
      });
      summary.decisionAlerts += 1;
    } catch {
      summary.errors += 1;
    }
  }

  return summary;
}
