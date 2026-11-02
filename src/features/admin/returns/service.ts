import "server-only";

import { daysToMs, getReturnsPolicy } from "@/config/returns-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor, ReturnStatus } from "@/generated/prisma/enums";
import { applyAdjustment } from "@/features/inventory/service";
import * as orders from "@/features/orders/data";
import {
  lockReturnRequest,
  recordReturnEvent,
  returnRequestSelect,
} from "@/features/returns/data";
import type { ReturnRequestRow } from "@/features/returns/data";
import { nextReturnStatus } from "@/features/returns/transitions";
import type { ReturnEventKind } from "@/features/returns/transitions";
import { returnStatusLabels } from "@/features/returns/types";
import type { StaffContext } from "@/server/auth/staff";
import { AppError, NotFoundError } from "@/server/errors";
import { enqueueNotification } from "@/server/notifications/outbox";
import type { NotificationKind } from "@/server/notifications/outbox";

import { runAudited } from "../audit";
import { findReturnDetail, listReturns } from "./data";
import type { ReturnListFilters } from "./data";
import type {
  ApproveReturnInput,
  InspectReturnInput,
  ReceiveReturnInput,
} from "./schemas";
import { toAdminReturnDetail, toAdminReturnListItem } from "./types";
import type { AdminReturnDetail, AdminReturnListItem } from "./types";

/**
 * Admin side of returns (docs/phase-8-returns-custom-artwork.md §3.3 R3–R9).
 * Every mutation: `runAudited` → lock the order, then the request → re-read
 * → pure transition → writes → event and outbox → SUCCESS audit, in one
 * transaction. Stock moves only at inspection, only for RESTOCK units,
 * through `applyAdjustment`. Money never moves here (step 8.2).
 */

type Tx = Prisma.TransactionClient;

export class ReturnActionError extends AppError {
  constructor(message: string, code = "RETURN_ACTION_NOT_ALLOWED") {
    super(message, { code, status: 409 });
  }
}

function actorOf(ctx: StaffContext): OrderActor {
  return ctx.role === "ADMIN" ? "ADMIN" : "STAFF";
}

async function loadLocked(tx: Tx, id: string): Promise<ReturnRequestRow> {
  const preview = await tx.returnRequest.findUnique({
    where: { id },
    select: { orderId: true },
  });
  if (!preview) throw new NotFoundError("Return request");
  await orders.lockOrder(tx, preview.orderId);
  await lockReturnRequest(tx, id);
  const row = await tx.returnRequest.findUnique({
    where: { id },
    select: returnRequestSelect,
  });
  if (!row) throw new NotFoundError("Return request");
  return row;
}

function transitionOrThrow(row: ReturnRequestRow, event: ReturnEventKind) {
  const next = nextReturnStatus(row.status, event);
  if (!next) {
    throw new ReturnActionError(
      `This return is ${returnStatusLabels[row.status].toLowerCase()}; that step no longer applies.`,
    );
  }
  return next;
}

async function moveTo(
  tx: Tx,
  row: ReturnRequestRow,
  next: ReturnStatus,
  data: Prisma.ReturnRequestUpdateManyMutationInput,
) {
  const updated = await tx.returnRequest.updateMany({
    where: { id: row.id, status: row.status },
    data: { ...data, status: next },
  });
  if (updated.count !== 1) {
    throw new ReturnActionError(
      "This return changed while you were looking at it. Reload and try again.",
    );
  }
}

async function notifyCustomer(
  tx: Tx,
  kind: NotificationKind,
  row: ReturnRequestRow,
  payload: Record<string, string | number>,
) {
  await enqueueNotification(tx, {
    kind,
    orderId: row.orderId,
    recipient: row.order.email,
    dedupeKey: `${kind}:${row.id}`,
    payload: {
      requestNumber: row.requestNumber,
      orderNumber: row.order.orderNumber,
      ...payload,
    },
  });
}

function snapshot(row: ReturnRequestRow) {
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    orderNumber: row.order.orderNumber,
    status: row.status,
    units: row.items.reduce((sum, item) => sum + item.requestedQty, 0),
  };
}

/** Every item of the request exactly once, or refuse. */
function matchItems<T extends { returnItemId: string }>(
  row: ReturnRequestRow,
  items: readonly T[],
): Map<string, T> {
  const byId = new Map(items.map((item) => [item.returnItemId, item]));
  if (byId.size !== items.length || byId.size !== row.items.length) {
    throw new ReturnActionError(
      "Every line of the return must be answered exactly once.",
    );
  }
  for (const item of row.items) {
    if (!byId.has(item.id)) {
      throw new ReturnActionError(
        "Every line of the return must be answered exactly once.",
      );
    }
  }
  return byId;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getReturnQueue(
  ctx: StaffContext,
  filters: ReturnListFilters,
): Promise<{
  items: AdminReturnListItem[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const page = await listReturns(ctx, filters);
  return {
    items: page.rows.map(toAdminReturnListItem),
    total: page.total,
    page: page.page,
    pageCount: page.pageCount,
  };
}

export async function getReturnDetail(
  ctx: StaffContext,
  id: string,
): Promise<AdminReturnDetail | null> {
  const bundle = await findReturnDetail(ctx, id);
  return bundle ? toAdminReturnDetail(bundle) : null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** R3: a question for the customer; the decision clock pauses until they reply. */
export async function requestInformation(
  ctx: StaffContext,
  id: string,
  message: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "return.info_requested",
      targetType: "return",
      targetId: id,
      capability: "returns.review",
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, id);
      const next = transitionOrThrow(row, "request_info");
      await moveTo(tx, row, next, { decisionDueAt: null });
      await tx.returnMessage.create({
        data: {
          returnRequestId: row.id,
          author: "STAFF",
          authorUserId: ctx.user.id,
          body: message,
          createdAt: now,
        },
      });
      await recordReturnEvent(tx, {
        returnRequestId: row.id,
        type: "return.info_requested",
        actor: actorOf(ctx),
        actorUserId: ctx.user.id,
        fromStatus: row.status,
        toStatus: next,
        at: now,
      });
      await notifyCustomer(tx, "return.info_requested", row, {});
      return {
        result: undefined,
        before: snapshot(row),
        after: { ...snapshot(row), status: next },
      };
    },
  );
}

/** R5: approve some or all requested units and send the instructions. */
export async function approveReturn(
  ctx: StaffContext,
  id: string,
  input: Omit<ApproveReturnInput, "returnId">,
  now = new Date(),
): Promise<void> {
  const policy = getReturnsPolicy();
  await runAudited(
    {
      ctx,
      action: "return.approved",
      targetType: "return",
      targetId: id,
      capability: "returns.review",
      reason: input.note || null,
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, id);
      const next = transitionOrThrow(row, "approve");
      const byId = matchItems(row, input.items);
      let approvedUnits = 0;
      let shopAtFault = false;
      const faultReasons = new Set(policy.faultReasons);
      for (const item of row.items) {
        const answer = byId.get(item.id);
        if (!answer) throw new Error("unreachable");
        if (answer.approvedQty > item.requestedQty) {
          throw new ReturnActionError(
            `At most ${item.requestedQty} unit(s) of ${item.orderItem.sku} were requested.`,
          );
        }
        approvedUnits += answer.approvedQty;
        if (answer.approvedQty > 0 && faultReasons.has(item.reason)) {
          shopAtFault = true;
        }
      }
      if (approvedUnits === 0) {
        throw new ReturnActionError(
          "Approve at least one unit, or reject the request instead.",
        );
      }
      const shipByAt = new Date(
        now.getTime() + daysToMs(policy.clocks.customerShipByDays),
      );
      const payer = shopAtFault ? "SHOP" : "CUSTOMER";
      for (const item of row.items) {
        const answer = byId.get(item.id);
        if (!answer) throw new Error("unreachable");
        await tx.returnItem.update({
          where: { id: item.id },
          data: { approvedQty: answer.approvedQty },
        });
      }
      await moveTo(tx, row, next, {
        shipByAt,
        instructionsSnapshot: {
          text: input.instructions,
          payer,
          shipByAt: shipByAt.toISOString(),
        },
      });
      await recordReturnEvent(tx, {
        returnRequestId: row.id,
        type: "return.approved",
        actor: actorOf(ctx),
        actorUserId: ctx.user.id,
        fromStatus: row.status,
        toStatus: next,
        note: input.note || null,
        data: {
          approvedUnits,
          payer,
          shipByAt: shipByAt.toISOString(),
          lines: input.items.map((item) => ({
            returnItemId: item.returnItemId,
            approvedQty: item.approvedQty,
          })),
        },
        at: now,
      });
      await notifyCustomer(tx, "return.approved", row, {
        instructions: input.instructions,
        payer,
        shipByAt: shipByAt.toISOString(),
        approvedUnits,
      });
      return {
        result: undefined,
        before: snapshot(row),
        after: {
          ...snapshot(row),
          status: next,
          approved: approvedUnits,
          payer,
          shipByAt,
        },
      };
    },
  );
}

/** R6: refuse the request; nothing else changes. */
export async function rejectReturn(
  ctx: StaffContext,
  id: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "return.rejected",
      targetType: "return",
      targetId: id,
      capability: "returns.review",
      reason,
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, id);
      const next = transitionOrThrow(row, "reject");
      await moveTo(tx, row, next, { rejectionReason: reason, closedAt: now });
      await recordReturnEvent(tx, {
        returnRequestId: row.id,
        type: "return.rejected",
        actor: actorOf(ctx),
        actorUserId: ctx.user.id,
        fromStatus: row.status,
        toStatus: next,
        note: reason,
        at: now,
      });
      await notifyCustomer(tx, "return.rejected", row, { reason });
      return {
        result: undefined,
        before: snapshot(row),
        after: { ...snapshot(row), status: next },
      };
    },
  );
}

/** R7 by staff: the customer told us the parcel is on its way. */
export async function recordShipmentByStaff(
  ctx: StaffContext,
  id: string,
  input: {
    readonly carrier: string;
    readonly trackingNumber: string | null;
    readonly trackingUrl: string | null;
  },
  now = new Date(),
): Promise<void> {
  const policy = getReturnsPolicy();
  await runAudited(
    {
      ctx,
      action: "return.shipment_recorded",
      targetType: "return",
      targetId: id,
      capability: "returns.review",
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, id);
      const next = transitionOrThrow(row, "shipped");
      const receiveByAt = new Date(
        now.getTime() + daysToMs(policy.clocks.receiveByDays),
      );
      await moveTo(tx, row, next, { receiveByAt });
      await tx.returnShipment.create({
        data: {
          returnRequestId: row.id,
          direction: "INBOUND",
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          trackingUrl: input.trackingUrl,
          shippedAt: now,
          recordedBy: "STAFF",
          recordedByUserId: ctx.user.id,
          createdAt: now,
        },
      });
      await recordReturnEvent(tx, {
        returnRequestId: row.id,
        type: "return.shipped",
        actor: actorOf(ctx),
        actorUserId: ctx.user.id,
        fromStatus: row.status,
        toStatus: next,
        note: input.trackingNumber
          ? `${input.carrier}, ${input.trackingNumber}`
          : input.carrier,
        at: now,
      });
      return {
        result: undefined,
        before: snapshot(row),
        after: { ...snapshot(row), status: next, receiveByAt },
      };
    },
  );
}

/** R8: the parcel is here; per line, how many units actually arrived. Inventory untouched. */
export async function receiveReturn(
  ctx: StaffContext,
  id: string,
  input: Omit<ReceiveReturnInput, "returnId">,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "return.received",
      targetType: "return",
      targetId: id,
      capability: "returns.review",
      reason: input.note,
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, id);
      const next = transitionOrThrow(row, "receive");
      const byId = matchItems(row, input.items);
      let received = 0;
      let missing = 0;
      for (const item of row.items) {
        const answer = byId.get(item.id);
        if (!answer) throw new Error("unreachable");
        const approved = item.approvedQty ?? 0;
        if (answer.receivedQty > approved) {
          throw new ReturnActionError(
            `At most ${approved} unit(s) of ${item.orderItem.sku} were approved for return.`,
          );
        }
        received += answer.receivedQty;
        missing += approved - answer.receivedQty;
        await tx.returnItem.update({
          where: { id: item.id },
          data: {
            receivedQty: answer.receivedQty,
            notReceivedQty: approved - answer.receivedQty,
          },
        });
      }
      await moveTo(tx, row, next, {
        receivedAt: now,
        receivedNote: input.note,
      });
      const latest = row.shipments
        .filter((shipment) => shipment.direction === "INBOUND")
        .at(-1);
      if (latest) {
        await tx.returnShipment.update({
          where: { id: latest.id },
          data: { receivedAt: now },
        });
      }
      await recordReturnEvent(tx, {
        returnRequestId: row.id,
        type: "return.received",
        actor: actorOf(ctx),
        actorUserId: ctx.user.id,
        fromStatus: row.status,
        toStatus: next,
        note:
          missing > 0 ? `${missing} unit(s) missing from the parcel.` : null,
        data: { received, missing },
        at: now,
      });
      await notifyCustomer(tx, "return.received", row, { received, missing });
      return {
        result: undefined,
        before: snapshot(row),
        after: { ...snapshot(row), status: next, received, missing },
      };
    },
  );
}

/**
 * R9: per unit decisions. Only RESTOCK units move stock, through
 * `applyAdjustment` in ascending variant id with the audit id; repair and
 * quarantine units are held on the item; write-offs and units going back to
 * the customer never touch inventory.
 */
export async function inspectReturn(
  ctx: StaffContext,
  id: string,
  input: Omit<InspectReturnInput, "returnId">,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "return.inspected",
      targetType: "return",
      targetId: id,
      capability: "returns.inspect",
      reason: input.note,
      now,
    },
    async (tx, audit) => {
      const row = await loadLocked(tx, id);
      const next = transitionOrThrow(row, "inspect");
      const byId = matchItems(row, input.items);
      const lines = row.items.map((item) => {
        const answer = byId.get(item.id);
        if (!answer) throw new Error("unreachable");
        const received = item.receivedQty ?? 0;
        const total =
          answer.restockQty +
          answer.repairQty +
          answer.quarantineQty +
          answer.writeOffQty +
          answer.returnToCustomerQty;
        if (total !== received) {
          throw new ReturnActionError(
            `The decisions for ${item.orderItem.sku} must add up to the ${received} unit(s) received.`,
          );
        }
        if (received === 0 && answer.condition !== "NOT_RECEIVED") {
          throw new ReturnActionError(
            `${item.orderItem.sku}: nothing was received, so its condition is "not received".`,
          );
        }
        return { item, answer };
      });
      // Ascending variant id: the inventory lock order.
      const totals = {
        restocked: 0,
        held: 0,
        writtenOff: 0,
        returnedToCustomer: 0,
      };
      for (const { item, answer } of [...lines].sort((a, b) =>
        a.item.variantId < b.item.variantId
          ? -1
          : a.item.variantId > b.item.variantId
            ? 1
            : 0,
      )) {
        if (answer.restockQty > 0) {
          await applyAdjustment(tx, {
            variantId: item.variantId,
            kind: "RESTOCK_ON_RETURN",
            delta: answer.restockQty,
            reason: `Return ${row.requestNumber} inspected: ${input.note}`,
            actorId: ctx.user.id,
            orderId: row.orderId,
            auditId: audit.id,
          });
        }
        await tx.returnItem.update({
          where: { id: item.id },
          data: {
            condition: answer.condition,
            restockQty: answer.restockQty,
            repairQty: answer.repairQty,
            quarantineQty: answer.quarantineQty,
            writeOffQty: answer.writeOffQty,
            returnToCustomerQty: answer.returnToCustomerQty,
            heldQty: answer.repairQty + answer.quarantineQty,
            inspectionNote: answer.note || null,
            inspected: true,
          },
        });
        totals.restocked += answer.restockQty;
        totals.held += answer.repairQty + answer.quarantineQty;
        totals.writtenOff += answer.writeOffQty;
        totals.returnedToCustomer += answer.returnToCustomerQty;
      }
      await moveTo(tx, row, next, {
        inspectedAt: now,
        inspectionNote: input.note,
      });
      await recordReturnEvent(tx, {
        returnRequestId: row.id,
        type: "return.inspected",
        actor: actorOf(ctx),
        actorUserId: ctx.user.id,
        fromStatus: row.status,
        toStatus: next,
        data: {
          ...totals,
          lines: lines.map(({ item, answer }) => ({
            sku: item.orderItem.sku,
            condition: answer.condition,
            restockQty: answer.restockQty,
            repairQty: answer.repairQty,
            quarantineQty: answer.quarantineQty,
            writeOffQty: answer.writeOffQty,
            returnToCustomerQty: answer.returnToCustomerQty,
          })),
        },
        at: now,
      });
      await notifyCustomer(tx, "return.inspected", row, totals);
      return {
        result: undefined,
        before: snapshot(row),
        after: { ...snapshot(row), status: next, ...totals },
      };
    },
  );
}
