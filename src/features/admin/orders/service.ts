import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/generated/prisma/enums";
import {
  applyAdjustment,
  releaseOrderHolds,
  restockForOrder,
} from "@/features/inventory/service";
import * as orders from "@/features/orders/data";
import { nextOrderStatus } from "@/features/orders/transitions";
import type { OrderEventKind } from "@/features/orders/transitions";
import { applyCodEvent } from "@/features/payments/cod";
import {
  queueRefundIntent,
  refundableAttempts,
} from "@/features/payments/refunds";
import type { RefundReason } from "@/features/payments/refunds";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";
import { AppError, NotFoundError } from "@/server/errors";
import {
  enqueueNotification,
  enqueueOpsAlert,
} from "@/server/notifications/outbox";

import { runAudited } from "../audit";
import type { Capability } from "../capabilities";
import {
  findOrderDetail,
  listOrders,
  orderActionSelect,
  recordAddressView,
} from "./data";
import type { OrderActionRow, OrderListFilters } from "./data";
import type { InspectionInput } from "./schemas";
import { toAdminOrderDetail, toAdminOrderListItem } from "./types";
import type {
  AdminOrderDetail,
  AdminOrderListItem,
  DeliveryFailureReason,
} from "./types";

/**
 * Admin order operations (docs/admin.md §5.4, §5.10, §5.11, §6 A4–A9).
 * Every mutation: `runAudited` → lock the order → re-read → pure transition
 * → writes → events and outbox → SUCCESS audit, all in one transaction.
 * Fulfilment never writes `payments`; COD money moves only through
 * `applyCodEvent`; stock after shipping moves only through audited
 * adjustments at inspection.
 */

type Tx = Prisma.TransactionClient;

export class OrderActionError extends AppError {
  constructor(message: string, code = "ORDER_ACTION_NOT_ALLOWED") {
    super(message, { code, status: 409 });
  }
}

function actorOf(ctx: StaffContext): OrderActor {
  return ctx.role === "ADMIN" ? "ADMIN" : "STAFF";
}

async function loadLocked(tx: Tx, orderId: string): Promise<OrderActionRow> {
  await orders.lockOrder(tx, orderId);
  const row = await tx.order.findUnique({
    where: { id: orderId },
    select: orderActionSelect,
  });
  if (!row) throw new NotFoundError("Order");
  return row;
}

function transitionOrThrow(row: OrderActionRow, event: OrderEventKind) {
  const next = nextOrderStatus(row.status, event);
  if (!next) {
    throw new OrderActionError(
      `This order is ${row.status.toLowerCase().replaceAll("_", " ")}; that step no longer applies.`,
    );
  }
  return next;
}

/** Refund intents for every captured online attempt, net of earlier refunds. */
async function queueRefundsForCaptured(
  tx: Tx,
  row: OrderActionRow,
  actor: OrderActor,
  reason: RefundReason,
): Promise<number> {
  let queued = 0;
  for (const attempt of await refundableAttempts(tx, row.id)) {
    const remaining = attempt.amountInPaise - attempt.refundedInPaise;
    if (remaining <= 0) continue;
    const { created } = await queueRefundIntent(tx, {
      order: { id: row.id, orderNumber: row.orderNumber, email: row.email },
      attempt: { id: attempt.id, attemptNo: attempt.attemptNo },
      amountInPaise: remaining,
      actor,
      reason,
      sequence: attempt.refundCount + 1,
    });
    if (created) queued += 1;
  }
  return queued;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getOrderList(
  ctx: StaffContext,
  filters: OrderListFilters,
): Promise<{
  items: AdminOrderListItem[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const page = await listOrders(ctx, filters);
  return {
    items: page.rows.map(toAdminOrderListItem),
    total: page.total,
    page: page.page,
    pageCount: page.pageCount,
  };
}

export async function getOrderDetail(
  ctx: StaffContext,
  orderId: string,
): Promise<AdminOrderDetail | null> {
  const bundle = await findOrderDetail(ctx, orderId);
  if (!bundle) return null;
  const view = toAdminOrderDetail(bundle, ctx.role);
  if (view.addressExposure === "full") await recordAddressView(ctx, orderId);
  return view;
}

// ---------------------------------------------------------------------------
// Fulfilment (A4)
// ---------------------------------------------------------------------------

export async function startProcessing(
  ctx: StaffContext,
  orderId: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "order.start_processing",
      targetType: "order",
      targetId: orderId,
      capability: "orders.fulfil",
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, orderId);
      const next = transitionOrThrow(row, "start_processing");
      await tx.order.update({ where: { id: orderId }, data: { status: next } });
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "order.processing",
        actor: actorOf(ctx),
        fromStatus: row.status,
        toStatus: next,
      });
      return {
        result: undefined,
        before: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: row.status,
        },
        after: { id: row.id, orderNumber: row.orderNumber, status: next },
      };
    },
  );
}

export interface ShipInput {
  readonly carrier: string;
  readonly trackingNumber: string | null;
  readonly trackingUrl: string | null;
}

export async function shipOrder(
  ctx: StaffContext,
  orderId: string,
  input: ShipInput,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "order.ship",
      targetType: "order",
      targetId: orderId,
      capability: "orders.fulfil",
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, orderId);
      const next = transitionOrThrow(row, "ship");
      if (row.shipment) {
        throw new OrderActionError(
          "This order already has a shipment recorded.",
        );
      }
      const shipment = await tx.shipment.create({
        data: {
          orderId,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          trackingUrl: input.trackingUrl,
          shippedAt: now,
          createdById: ctx.user.id,
        },
        select: { id: true },
      });
      await tx.order.update({ where: { id: orderId }, data: { status: next } });
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "order.shipped",
        actor: actorOf(ctx),
        fromStatus: row.status,
        toStatus: next,
        note: input.trackingNumber
          ? `${input.carrier}, tracking ${input.trackingNumber}`
          : input.carrier,
        data: { shipmentId: shipment.id, carrier: input.carrier },
      });
      await enqueueNotification(tx, {
        kind: "order.shipped",
        orderId,
        recipient: row.email,
        payload: {
          orderNumber: row.orderNumber,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          trackingUrl: input.trackingUrl,
        },
      });
      return {
        result: undefined,
        before: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: row.status,
        },
        after: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: next,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
        },
      };
    },
  );
}

export async function markDelivered(
  ctx: StaffContext,
  orderId: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "order.deliver",
      targetType: "order",
      targetId: orderId,
      capability: "orders.fulfil",
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, orderId);
      const next = transitionOrThrow(row, "deliver");
      if (!row.shipment)
        throw new OrderActionError("No shipment is recorded for this order.");
      await tx.shipment.update({
        where: { id: row.shipment.id },
        data: { deliveredAt: now },
      });
      await tx.order.update({ where: { id: orderId }, data: { status: next } });
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "order.delivered",
        actor: actorOf(ctx),
        fromStatus: row.status,
        toStatus: next,
      });
      await enqueueNotification(tx, {
        kind: "order.delivered",
        orderId,
        recipient: row.email,
        payload: { orderNumber: row.orderNumber },
      });
      return {
        result: undefined,
        before: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: row.status,
        },
        after: { id: row.id, orderNumber: row.orderNumber, status: next },
      };
    },
  );
}

export async function addStaffNote(
  ctx: StaffContext,
  orderId: string,
  note: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "order.note",
      targetType: "order",
      targetId: orderId,
      capability: "orders.note",
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, orderId);
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "note",
        actor: actorOf(ctx),
        note,
      });
      return {
        result: undefined,
        after: { id: row.id, orderNumber: row.orderNumber },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Cancellation before shipping (A5)
// ---------------------------------------------------------------------------

export interface CancelInput {
  readonly reason: string;
  readonly confirmOrderNumber: string;
}

export async function cancelOrder(
  ctx: StaffContext,
  orderId: string,
  input: CancelInput,
  now = new Date(),
): Promise<void> {
  // The capability depends on the state; it is re-read under the lock below
  // and the operation refuses if the state moved in between.
  const current = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  if (!current) throw new NotFoundError("Order");
  const capability: Capability =
    current.status === "PENDING_PAYMENT"
      ? "orders.cancel_pending"
      : "orders.cancel_confirmed";
  await runAudited(
    {
      ctx,
      action: "order.cancel",
      targetType: "order",
      targetId: orderId,
      capability,
      reason: input.reason,
      now,
    },
    async (tx, audit) => {
      const row = await loadLocked(tx, orderId);
      if (row.status !== current.status) {
        throw new OrderActionError(
          "The order changed while you were looking at it. Check it again.",
        );
      }
      if (row.orderNumber !== input.confirmOrderNumber.trim().toUpperCase()) {
        throw new OrderActionError(
          "The order number you typed does not match this order.",
          "CONFIRMATION_MISMATCH",
        );
      }
      const next = transitionOrThrow(row, "admin_cancelled");
      const actor = actorOf(ctx);
      let released = 0;
      let restocked = 0;
      if (row.status === "CONFIRMED" || row.status === "PROCESSING") {
        restocked = await restockForOrder(tx, {
          orderId,
          lines: row.items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          })),
          actorId: ctx.user.id,
          auditId: audit.id,
          reason: `Order ${row.orderNumber} cancelled before shipping: ${input.reason}`,
        });
      } else {
        released = await releaseOrderHolds(tx, orderId, now, "RELEASED");
      }
      const refundReason: RefundReason =
        row.status === "NEEDS_REVIEW"
          ? "review_cancelled"
          : "cancelled_by_shop";
      const refunds = await queueRefundsForCaptured(
        tx,
        row,
        actor,
        refundReason,
      );
      await tx.order.update({
        where: { id: orderId },
        data: { status: next, cancellationReason: "ADMIN", cancelledAt: now },
      });
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "order.cancelled",
        actor,
        fromStatus: row.status,
        toStatus: next,
        note: input.reason,
        data: { released, restocked, refundsQueued: refunds },
      });
      await enqueueNotification(tx, {
        kind: "order.cancelled",
        orderId,
        recipient: row.email,
        payload: {
          orderNumber: row.orderNumber,
          reason: "shop",
          refundQueued: refunds > 0 ? "yes" : "no",
        },
      });
      return {
        result: undefined,
        before: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: row.status,
        },
        after: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: next,
          cancellationReason: "ADMIN",
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Delivery failure and return to origin (A9b–A9e)
// ---------------------------------------------------------------------------

export interface DeliveryFailedInput {
  readonly reason: DeliveryFailureReason;
  readonly note: string | null;
}

export async function markDeliveryFailed(
  ctx: StaffContext,
  orderId: string,
  input: DeliveryFailedInput,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "order.delivery_failed",
      targetType: "order",
      targetId: orderId,
      capability: "orders.returns",
      reason: input.note,
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, orderId);
      const next = transitionOrThrow(row, "delivery_failed");
      if (!row.shipment)
        throw new OrderActionError("No shipment is recorded for this order.");
      const actor = actorOf(ctx);
      await tx.shipment.update({
        where: { id: row.shipment.id },
        data: { deliveryFailedAt: now, deliveryFailureReason: input.reason },
      });
      // Cash on delivery: the money was not collected. An explicit payment
      // transition records that; inventory is untouched (§5.11).
      const codAttempt = row.payments.find(
        (p) => p.method === "COD" && p.status === "CREATED",
      );
      if (row.paymentMethod === "COD" && codAttempt) {
        await applyCodEvent(tx, {
          attemptId: codAttempt.id,
          event: "cod_refused",
          actor,
          actorUserId: ctx.user.id,
          reason: input.note,
          now,
        });
      }
      await tx.order.update({ where: { id: orderId }, data: { status: next } });
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "order.delivery_failed",
        actor,
        fromStatus: row.status,
        toStatus: next,
        note: input.note,
        data: { reason: input.reason },
      });
      await enqueueNotification(tx, {
        kind: "order.delivery_failed",
        orderId,
        recipient: row.email,
        payload: { orderNumber: row.orderNumber, reason: input.reason },
      });
      await enqueueOpsAlert(tx, {
        key: `delivery-failed:${row.id}`,
        orderId,
        payload: {
          reason: `Delivery failed for order ${row.orderNumber}`,
          orderNumber: row.orderNumber,
          failure: input.reason,
        },
      });
      return {
        result: undefined,
        before: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: row.status,
        },
        after: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: next,
          deliveryFailureReason: input.reason,
        },
      };
    },
  );
}

export async function markParcelReturned(
  ctx: StaffContext,
  orderId: string,
  note: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "order.parcel_returned",
      targetType: "order",
      targetId: orderId,
      capability: "orders.returns",
      reason: note,
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, orderId);
      const next = transitionOrThrow(row, "parcel_returned");
      if (!row.shipment)
        throw new OrderActionError("No shipment is recorded for this order.");
      await tx.shipment.update({
        where: { id: row.shipment.id },
        data: { returnedAt: now },
      });
      await tx.order.update({ where: { id: orderId }, data: { status: next } });
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "order.returned",
        actor: actorOf(ctx),
        fromStatus: row.status,
        toStatus: next,
        note,
      });
      return {
        result: undefined,
        before: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: row.status,
        },
        after: { id: row.id, orderNumber: row.orderNumber, status: next },
      };
    },
  );
}

/**
 * Per-item inspection of a returned parcel (A9d). Units received back enter
 * stock through RESTOCK_ON_RETURN; damaged units then leave it through
 * WRITE_OFF, so the ledger shows both what came back and what was lost.
 */
export async function completeInspection(
  ctx: StaffContext,
  orderId: string,
  input: Omit<InspectionInput, "orderId">,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "order.inspection_completed",
      targetType: "order",
      targetId: orderId,
      capability: "orders.returns",
      reason: input.note,
      now,
    },
    async (tx, audit) => {
      const row = await loadLocked(tx, orderId);
      const next = transitionOrThrow(row, "inspection_completed");
      if (!row.shipment)
        throw new OrderActionError("No shipment is recorded for this order.");
      const byItem = new Map(
        input.items.map((item) => [item.orderItemId, item]),
      );
      if (
        byItem.size !== input.items.length ||
        byItem.size !== row.items.length
      ) {
        throw new OrderActionError(
          "Every line of the order must be inspected exactly once.",
        );
      }
      const lines = row.items.map((item) => {
        const inspected = byItem.get(item.id);
        if (!inspected) {
          throw new OrderActionError(
            "Every line of the order must be inspected exactly once.",
          );
        }
        if (inspected.restockQty + inspected.writeOffQty !== item.quantity) {
          throw new OrderActionError(
            `Restocked plus written-off units must equal ${item.quantity} for ${item.sku}.`,
          );
        }
        return {
          ...item,
          restockQty: inspected.restockQty,
          writeOffQty: inspected.writeOffQty,
        };
      });
      // Items arrive in ascending variant id (orderActionSelect): lock order.
      const actor = actorOf(ctx);
      for (const line of lines) {
        const received = line.restockQty + line.writeOffQty;
        if (received > 0) {
          await applyAdjustment(tx, {
            variantId: line.variantId,
            kind: "RESTOCK_ON_RETURN",
            delta: received,
            reason: `Returned parcel for ${row.orderNumber} inspected: ${input.note}`,
            actorId: ctx.user.id,
            orderId,
            auditId: audit.id,
          });
        }
        if (line.writeOffQty > 0) {
          await applyAdjustment(tx, {
            variantId: line.variantId,
            kind: "WRITE_OFF",
            delta: -line.writeOffQty,
            reason: `Written off after return of ${row.orderNumber}: ${input.note}`,
            actorId: ctx.user.id,
            orderId,
            auditId: audit.id,
          });
        }
      }
      const cancellationReason =
        row.shipment.deliveryFailureReason === "COD_REFUSED"
          ? "COD_REFUSED"
          : "DELIVERY_FAILED";
      const refunds = await queueRefundsForCaptured(
        tx,
        row,
        actor,
        "delivery_failed",
      );
      await tx.shipment.update({
        where: { id: row.shipment.id },
        data: { inspectedAt: now, inspectionNote: input.note },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: next, cancellationReason, cancelledAt: now },
      });
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "order.inspected",
        actor,
        note: input.note,
        data: {
          items: lines.map((line) => ({
            sku: line.sku,
            restockQty: line.restockQty,
            writeOffQty: line.writeOffQty,
          })),
        },
      });
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "order.cancelled",
        actor,
        fromStatus: row.status,
        toStatus: next,
        note: "Closed after return and inspection.",
        data: { refundsQueued: refunds },
      });
      await enqueueNotification(tx, {
        kind: "order.cancelled",
        orderId,
        recipient: row.email,
        payload: {
          orderNumber: row.orderNumber,
          reason: "returned",
          refundQueued: refunds > 0 ? "yes" : "no",
        },
      });
      return {
        result: undefined,
        before: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: row.status,
        },
        after: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: next,
          cancellationReason,
          restocked: lines.reduce((sum, line) => sum + line.restockQty, 0),
          writtenOff: lines.reduce((sum, line) => sum + line.writeOffQty, 0),
        },
      };
    },
  );
}

export interface CarrierLossInput {
  readonly claimReference: string;
  readonly reason: string;
}

/**
 * The carrier confirmed the parcel is gone (A9e, ADMIN with re-auth). The
 * units never came back, so no inventory row moves; the loss is recorded on
 * the shipment, the order and the audit row, and the customer is refunded.
 */
export async function confirmCarrierLoss(
  ctx: StaffContext,
  orderId: string,
  input: CarrierLossInput,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "order.carrier_lost",
      targetType: "order",
      targetId: orderId,
      capability: "orders.carrier_loss",
      reason: input.reason,
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, orderId);
      const next = transitionOrThrow(row, "carrier_lost_confirmed");
      if (!row.shipment)
        throw new OrderActionError("No shipment is recorded for this order.");
      const actor = actorOf(ctx);
      await tx.shipment.update({
        where: { id: row.shipment.id },
        data: { carrierClaimReference: input.claimReference },
      });
      const refunds = await queueRefundsForCaptured(
        tx,
        row,
        actor,
        "carrier_lost",
      );
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: next,
          cancellationReason: "DELIVERY_FAILED",
          cancelledAt: now,
        },
      });
      await orders.recordOrderEvent(tx, {
        orderId,
        type: "order.carrier_lost",
        actor,
        fromStatus: row.status,
        toStatus: next,
        note: input.reason,
        data: {
          claimReference: input.claimReference,
          lostUnits: row.items.map((item) => ({
            sku: item.sku,
            quantity: item.quantity,
          })),
          refundsQueued: refunds,
        },
      });
      await enqueueNotification(tx, {
        kind: "order.cancelled",
        orderId,
        recipient: row.email,
        payload: {
          orderNumber: row.orderNumber,
          reason: "lost",
          refundQueued: refunds > 0 ? "yes" : "no",
        },
      });
      await enqueueOpsAlert(tx, {
        key: `carrier-lost:${row.id}`,
        orderId,
        payload: {
          reason: `Carrier confirmed loss of order ${row.orderNumber}`,
          orderNumber: row.orderNumber,
          claimReference: input.claimReference,
        },
      });
      return {
        result: undefined,
        before: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: row.status,
        },
        after: {
          id: row.id,
          orderNumber: row.orderNumber,
          status: next,
          cancellationReason: "DELIVERY_FAILED",
          carrierClaimReference: input.claimReference,
          writtenOff: row.items.reduce((sum, item) => sum + item.quantity, 0),
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Cash on delivery (A9a)
// ---------------------------------------------------------------------------

export interface CodCollectInput {
  readonly amountInPaise: number;
  /** Required when recorded at handover (SHIPPED) rather than after delivery. */
  readonly reason: string | null;
}

export async function collectCod(
  ctx: StaffContext,
  orderId: string,
  input: CodCollectInput,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "payment.cod_collected",
      targetType: "order",
      targetId: orderId,
      capability: "payments.cod_collect",
      reason: input.reason,
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, orderId);
      if (row.paymentMethod !== "COD") {
        throw new OrderActionError(
          "This order was not placed as cash on delivery.",
        );
      }
      if (row.status === "SHIPPED") {
        if (!input.reason) {
          throw new OrderActionError(
            "Give a reason when recording cash before the order is marked delivered.",
          );
        }
      } else if (row.status !== "DELIVERED") {
        throw new OrderActionError(
          "Cash can be recorded once the order is delivered.",
        );
      }
      const attempt = row.payments.find(
        (p) => p.method === "COD" && p.status === "CREATED",
      );
      if (!attempt)
        throw new OrderActionError(
          "There is no open cash-on-delivery payment to collect.",
        );
      const outcome = await applyCodEvent(tx, {
        attemptId: attempt.id,
        event: "cod_collected",
        actor: actorOf(ctx),
        actorUserId: ctx.user.id,
        amountInPaise: input.amountInPaise,
        reason: input.reason,
        now,
      });
      return {
        result: undefined,
        before: {
          id: attempt.id,
          attemptNo: attempt.attemptNo,
          status: attempt.status,
        },
        after: {
          id: attempt.id,
          attemptNo: attempt.attemptNo,
          status: outcome.status,
          amountInPaise: input.amountInPaise,
        },
      };
    },
  );
}

export async function reverseCodCollection(
  ctx: StaffContext,
  orderId: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "payment.cod_collection_reversed",
      targetType: "order",
      targetId: orderId,
      capability: "payments.cod_reverse",
      reason,
      now,
    },
    async (tx) => {
      const row = await loadLocked(tx, orderId);
      const attempt = row.payments.find(
        (p) => p.method === "COD" && p.status === "CAPTURED",
      );
      if (!attempt)
        throw new OrderActionError(
          "No collected cash-on-delivery payment to reverse.",
        );
      const outcome = await applyCodEvent(tx, {
        attemptId: attempt.id,
        event: "cod_collection_reversed",
        actor: actorOf(ctx),
        actorUserId: ctx.user.id,
        reason,
        now,
      });
      return {
        result: undefined,
        before: {
          id: attempt.id,
          attemptNo: attempt.attemptNo,
          status: attempt.status,
        },
        after: {
          id: attempt.id,
          attemptNo: attempt.attemptNo,
          status: outcome.status,
        },
      };
    },
  );
}
