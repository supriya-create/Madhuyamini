import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ForbiddenCapabilityError,
  ReauthRequiredError,
} from "@/features/admin/authz";
import {
  OrderActionError,
  addStaffNote,
  cancelOrder,
  collectCod,
  completeInspection,
  confirmCarrierLoss,
  getOrderDetail,
  getOrderList,
  markDelivered,
  markDeliveryFailed,
  markParcelReturned,
  reverseCodCollection,
  shipOrder,
  startProcessing,
} from "@/features/admin/orders/service";
import { db } from "@/server/db";
import { getFakeGateway } from "@/server/payments";

import { resetDatabase, testDb } from "./db";
import {
  confirmedOnlineOrder,
  orderSnapshot,
  placeTestOrder,
  stockOf,
} from "./order-fixtures";
import { minutesLater, verifiedStaff } from "./staff";

/**
 * Fulfilment, cancellation, return to origin and cash on delivery through
 * the admin services (docs/admin.md §5.4, §5.10, §5.11, §6 A4–A9). Every
 * operation is checked for its state change, its side effects (events,
 * emails, stock, refunds) and its audit rows.
 */

const gateway = getFakeGateway();

beforeEach(async () => {
  await resetDatabase();
  gateway.reset();
});
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

const SHIP = {
  carrier: "India Post",
  trackingNumber: "RB123456789IN",
  trackingUrl: null,
};

describe("fulfilment of a paid online order (A4)", () => {
  it("moves CONFIRMED → PROCESSING → SHIPPED → DELIVERED with events, emails and audit, leaving stock alone", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await confirmedOnlineOrder({ stock: 5, quantity: 2 });
    const stockBefore = await stockOf(placed.variantId);
    expect(stockBefore).toEqual({ stockOnHand: 3, reserved: 0 });

    await startProcessing(staff.ctx, placed.orderId);
    await shipOrder(staff.ctx, placed.orderId, SHIP);
    await markDelivered(staff.ctx, placed.orderId);
    await addStaffNote(staff.ctx, placed.orderId, "Gift-wrapped as requested.");

    const snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("DELIVERED");
    expect(snap.order.shipment).toMatchObject({
      carrier: "India Post",
      trackingNumber: "RB123456789IN",
      createdById: staff.user.id,
    });
    expect(snap.order.shipment?.deliveredAt).toBeInstanceOf(Date);
    expect(snap.eventTypes.slice(-4)).toEqual([
      "order.processing",
      "order.shipped",
      "order.delivered",
      "note",
    ]);
    expect(snap.outboxKinds).toEqual(
      expect.arrayContaining(["order.shipped", "order.delivered"]),
    );
    expect(snap.auditOutcomes).toEqual([
      ["order.start_processing", "SUCCESS"],
      ["order.ship", "SUCCESS"],
      ["order.deliver", "SUCCESS"],
      ["order.note", "SUCCESS"],
    ]);
    expect(await stockOf(placed.variantId)).toEqual(stockBefore);
    expect(snap.adjustments).toHaveLength(0);
    // Fulfilment never touches payments.
    expect(snap.order.payments.map((p) => p.status)).toEqual(["CAPTURED"]);
  });

  it("refuses steps out of order and records them as FAILED", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await confirmedOnlineOrder();
    await expect(
      shipOrder(staff.ctx, placed.orderId, SHIP),
    ).rejects.toBeInstanceOf(OrderActionError);
    await expect(
      markDelivered(staff.ctx, placed.orderId),
    ).rejects.toBeInstanceOf(OrderActionError);
    const snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("CONFIRMED");
    expect(snap.order.shipment).toBeNull();
    expect(snap.auditOutcomes).toEqual([
      ["order.ship", "FAILED"],
      ["order.deliver", "FAILED"],
    ]);
  });
});

describe("cash on delivery (A9a, §5.10)", () => {
  it("records collection only for the exact amount, after delivery, and lets an ADMIN reverse it", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await placeTestOrder("COD", { sku: "COD-1" });
    expect((await orderSnapshot(placed.orderId)).order.status).toBe(
      "CONFIRMED",
    );

    // Not yet delivered, no reason: refused.
    await expect(
      collectCod(staff.ctx, placed.orderId, {
        amountInPaise: placed.totalInPaise,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(OrderActionError);

    await startProcessing(staff.ctx, placed.orderId);
    await shipOrder(staff.ctx, placed.orderId, SHIP);
    await markDelivered(staff.ctx, placed.orderId);

    await expect(
      collectCod(staff.ctx, placed.orderId, {
        amountInPaise: placed.totalInPaise - 100,
        reason: null,
      }),
    ).rejects.toMatchObject({ code: "COD_AMOUNT_MISMATCH" });
    let snap = await orderSnapshot(placed.orderId);
    expect(snap.order.payments[0]?.status).toBe("CREATED");

    await collectCod(staff.ctx, placed.orderId, {
      amountInPaise: placed.totalInPaise,
      reason: null,
    });
    snap = await orderSnapshot(placed.orderId);
    expect(snap.order.payments[0]).toMatchObject({
      method: "COD",
      status: "CAPTURED",
    });
    expect(snap.order.payments[0]?.capturedAt).toBeInstanceOf(Date);
    expect(snap.eventTypes).toContain("payment.cod_collected");
    // Fulfilment status untouched by the money transition.
    expect(snap.order.status).toBe("DELIVERED");

    await expect(
      reverseCodCollection(staff.ctx, placed.orderId, "typo"),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);

    const admin = await verifiedStaff("ADMIN");
    await reverseCodCollection(
      admin.ctx,
      placed.orderId,
      "Recorded on the wrong order.",
    );
    snap = await orderSnapshot(placed.orderId);
    expect(snap.order.payments[0]?.status).toBe("CREATED");
    expect(snap.order.payments[0]?.capturedAt).toBeNull();
    expect(snap.auditOutcomes).toEqual([
      ["payment.cod_collected", "FAILED"],
      ["order.start_processing", "SUCCESS"],
      ["order.ship", "SUCCESS"],
      ["order.deliver", "SUCCESS"],
      ["payment.cod_collected", "FAILED"],
      ["payment.cod_collected", "SUCCESS"],
      ["payment.cod_collection_reversed", "REFUSED"],
      ["payment.cod_collection_reversed", "SUCCESS"],
    ]);
  });

  it("allows collection at handover only with a reason", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await placeTestOrder("COD", { sku: "COD-2" });
    await startProcessing(staff.ctx, placed.orderId);
    await shipOrder(staff.ctx, placed.orderId, SHIP);
    await expect(
      collectCod(staff.ctx, placed.orderId, {
        amountInPaise: placed.totalInPaise,
        reason: null,
      }),
    ).rejects.toBeInstanceOf(OrderActionError);
    await collectCod(staff.ctx, placed.orderId, {
      amountInPaise: placed.totalInPaise,
      reason: "Collected by our own courier at handover.",
    });
    const snap = await orderSnapshot(placed.orderId);
    expect(snap.order.payments[0]?.status).toBe("CAPTURED");
    expect(snap.order.status).toBe("SHIPPED");
  });
});

describe("return to origin (A9b–A9d, §5.11)", () => {
  it("COD refusal fails the payment, keeps stock out, and only inspection restocks", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await placeTestOrder("COD", {
      sku: "RTO-1",
      stock: 5,
      quantity: 2,
    });
    await startProcessing(staff.ctx, placed.orderId);
    await shipOrder(staff.ctx, placed.orderId, SHIP);
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 3,
      reserved: 0,
    });

    await markDeliveryFailed(staff.ctx, placed.orderId, {
      reason: "COD_REFUSED",
      note: "Customer declined at the door.",
    });
    let snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("DELIVERY_FAILED");
    expect(snap.order.payments[0]).toMatchObject({
      method: "COD",
      status: "FAILED",
      failureCode: "COD_REFUSED",
    });
    expect(snap.order.shipment).toMatchObject({
      deliveryFailureReason: "COD_REFUSED",
    });
    expect(snap.order.shipment?.deliveryFailedAt).toBeInstanceOf(Date);
    // No stock change on refusal.
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 3,
      reserved: 0,
    });
    expect(snap.adjustments).toHaveLength(0);
    expect(snap.outboxKinds).toContain("order.delivery_failed");
    expect(
      await testDb.notificationOutbox.count({
        where: {
          kind: "ops.alert",
          dedupeKey: `ops.alert:delivery-failed:${placed.orderId}`,
        },
      }),
    ).toBe(1);

    // Still no stock change when the parcel is received.
    await markParcelReturned(
      staff.ctx,
      placed.orderId,
      "Box intact, tape broken.",
    );
    snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("RETURNED");
    expect(snap.order.shipment?.returnedAt).toBeInstanceOf(Date);
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 3,
      reserved: 0,
    });

    // Inspection must cover every unit.
    const [item] = snap.order.events.length
      ? await testDb.orderItem.findMany({ where: { orderId: placed.orderId } })
      : [];
    if (!item) throw new Error("no order item");
    await expect(
      completeInspection(staff.ctx, placed.orderId, {
        note: "One sari water-stained.",
        items: [{ orderItemId: item.id, restockQty: 1, writeOffQty: 0 }],
      }),
    ).rejects.toBeInstanceOf(OrderActionError);
    expect((await orderSnapshot(placed.orderId)).order.status).toBe("RETURNED");

    await completeInspection(staff.ctx, placed.orderId, {
      note: "One sari water-stained.",
      items: [{ orderItemId: item.id, restockQty: 1, writeOffQty: 1 }],
    });
    snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("CANCELLED");
    expect(snap.order.cancellationReason).toBe("COD_REFUSED");
    expect(snap.order.shipment?.inspectedAt).toBeInstanceOf(Date);
    expect(snap.order.shipment?.inspectionNote).toBe("One sari water-stained.");
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 4,
      reserved: 0,
    });
    expect(
      snap.adjustments.map((a) => [
        a.kind,
        a.delta,
        a.stockBefore,
        a.stockAfter,
        a.actorId,
      ]),
    ).toEqual([
      ["RESTOCK_ON_RETURN", 2, 3, 5, staff.user.id],
      ["WRITE_OFF", -1, 5, 4, staff.user.id],
    ]);
    const successAudit = snap.audit.find(
      (row) =>
        row.action === "order.inspection_completed" &&
        row.outcome === "SUCCESS",
    );
    expect(successAudit).toBeTruthy();
    expect(snap.adjustments.every((a) => a.auditId === successAudit?.id)).toBe(
      true,
    );
    // Nothing was captured, so nothing is refunded.
    expect(snap.order.refunds).toHaveLength(0);
    expect(
      snap.outboxKinds.filter((k) => k === "order.cancelled"),
    ).toHaveLength(1);
    expect(snap.eventTypes.slice(-2)).toEqual([
      "order.inspected",
      "order.cancelled",
    ]);
  });

  it("refunds a captured online payment in full when the returned parcel is inspected", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await confirmedOnlineOrder({
      sku: "RTO-2",
      stock: 3,
      quantity: 1,
    });
    await startProcessing(staff.ctx, placed.orderId);
    await shipOrder(staff.ctx, placed.orderId, SHIP);
    await markDeliveryFailed(staff.ctx, placed.orderId, {
      reason: "UNCLAIMED",
      note: null,
    });
    await markParcelReturned(staff.ctx, placed.orderId, "Unopened.");
    const item = await testDb.orderItem.findFirstOrThrow({
      where: { orderId: placed.orderId },
    });
    await completeInspection(staff.ctx, placed.orderId, {
      note: "Unopened, resaleable.",
      items: [{ orderItemId: item.id, restockQty: 1, writeOffQty: 0 }],
    });
    const snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("CANCELLED");
    expect(snap.order.cancellationReason).toBe("DELIVERY_FAILED");
    expect(snap.order.refunds).toHaveLength(1);
    expect(snap.order.refunds[0]).toMatchObject({
      status: "INITIATED",
      amountInPaise: placed.totalInPaise,
      reason: "delivery_failed",
      reference: `${placed.orderNumber}-R1`,
    });
    expect(snap.outboxKinds).toEqual(
      expect.arrayContaining(["order.refund_requested", "order.cancelled"]),
    );
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 3,
      reserved: 0,
    });
    expect(snap.adjustments.map((a) => a.kind)).toEqual(["RESTOCK_ON_RETURN"]);
  });

  it("carrier loss is ADMIN-only with fresh re-auth, refunds, and moves no stock", async () => {
    const now = new Date();
    const staff = await verifiedStaff("STAFF", now);
    const admin = await verifiedStaff("ADMIN", now);
    const placed = await confirmedOnlineOrder({
      sku: "RTO-3",
      stock: 2,
      quantity: 1,
    });
    await startProcessing(staff.ctx, placed.orderId, now);
    await shipOrder(staff.ctx, placed.orderId, SHIP, now);
    await markDeliveryFailed(
      staff.ctx,
      placed.orderId,
      { reason: "CARRIER_LOST", note: null },
      now,
    );

    const loss = {
      claimReference: "IP-CLAIM-77",
      reason: "Carrier confirmed the bag was lost.",
    };
    await expect(
      confirmCarrierLoss(staff.ctx, placed.orderId, loss, now),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    await expect(
      confirmCarrierLoss(
        admin.ctx,
        placed.orderId,
        loss,
        minutesLater(now, 15),
      ),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
    expect((await orderSnapshot(placed.orderId)).order.status).toBe(
      "DELIVERY_FAILED",
    );

    await confirmCarrierLoss(
      admin.ctx,
      placed.orderId,
      loss,
      minutesLater(now, 5),
    );
    const snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("CANCELLED");
    expect(snap.order.cancellationReason).toBe("DELIVERY_FAILED");
    expect(snap.order.shipment?.carrierClaimReference).toBe("IP-CLAIM-77");
    expect(snap.order.refunds).toHaveLength(1);
    expect(snap.order.refunds[0]).toMatchObject({
      reason: "carrier_lost",
      amountInPaise: placed.totalInPaise,
    });
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 1,
      reserved: 0,
    });
    expect(snap.adjustments).toHaveLength(0);
    expect(snap.eventTypes).toContain("order.carrier_lost");
    expect(snap.auditOutcomes).toEqual(
      expect.arrayContaining([
        ["order.carrier_lost", "REFUSED"],
        ["order.carrier_lost", "REFUSED"],
        ["order.carrier_lost", "SUCCESS"],
      ]),
    );
  });
});

describe("cancellation before shipping (A5)", () => {
  it("restocks a confirmed online order through audited adjustments and queues a refund (ADMIN only)", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    const placed = await confirmedOnlineOrder({
      sku: "CAN-1",
      stock: 4,
      quantity: 2,
    });
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 2,
      reserved: 0,
    });

    await expect(
      cancelOrder(staff.ctx, placed.orderId, {
        reason: "Customer asked by phone.",
        confirmOrderNumber: placed.orderNumber,
      }),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);

    await expect(
      cancelOrder(admin.ctx, placed.orderId, {
        reason: "Customer asked by phone.",
        confirmOrderNumber: "MY-WRONG",
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 2,
      reserved: 0,
    });

    await cancelOrder(admin.ctx, placed.orderId, {
      reason: "Customer asked by phone.",
      confirmOrderNumber: placed.orderNumber.toLowerCase(),
    });
    const snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("CANCELLED");
    expect(snap.order.cancellationReason).toBe("ADMIN");
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 4,
      reserved: 0,
    });
    expect(snap.adjustments.map((a) => [a.kind, a.delta, a.actorId])).toEqual([
      ["RESTOCK_ON_CANCEL", 2, admin.user.id],
    ]);
    expect(snap.order.refunds[0]).toMatchObject({
      status: "INITIATED",
      reason: "cancelled_by_shop",
      amountInPaise: placed.totalInPaise,
    });
    const cancelledMail = snap.outbox.find(
      (row) => row.kind === "order.cancelled",
    );
    expect(cancelledMail?.payload).toMatchObject({
      reason: "shop",
      refundQueued: "yes",
    });
    expect(snap.auditOutcomes).toEqual([
      ["order.cancel", "REFUSED"],
      ["order.cancel", "FAILED"],
      ["order.cancel", "SUCCESS"],
    ]);
  });

  it("lets STAFF cancel an unpaid order by releasing its holds, with no refund", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await placeTestOrder("RAZORPAY", {
      sku: "CAN-2",
      stock: 3,
      quantity: 1,
    });
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 3,
      reserved: 1,
    });
    await cancelOrder(staff.ctx, placed.orderId, {
      reason: "Duplicate of another order.",
      confirmOrderNumber: placed.orderNumber,
    });
    const snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("CANCELLED");
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 3,
      reserved: 0,
    });
    expect(snap.order.reservations.map((r) => r.status)).toEqual(["RELEASED"]);
    expect(snap.order.refunds).toHaveLength(0);
    expect(snap.adjustments).toHaveLength(0);
  });

  it("never cancels after shipping", async () => {
    const admin = await verifiedStaff("ADMIN");
    const placed = await confirmedOnlineOrder({ sku: "CAN-3" });
    await startProcessing(admin.ctx, placed.orderId);
    await shipOrder(admin.ctx, placed.orderId, SHIP);
    await expect(
      cancelOrder(admin.ctx, placed.orderId, {
        reason: "Changed my mind.",
        confirmOrderNumber: placed.orderNumber,
      }),
    ).rejects.toBeInstanceOf(OrderActionError);
    expect((await orderSnapshot(placed.orderId)).order.status).toBe("SHIPPED");
  });
});

describe("reads: list, detail and masking (§5.4, §5.7)", () => {
  it("filters the list and masks contact details outside fulfilment", async () => {
    const staff = await verifiedStaff("STAFF");
    const a = await confirmedOnlineOrder({
      sku: "LST-1",
      email: "asha@example.com",
    });
    const b = await placeTestOrder("COD", {
      sku: "LST-2",
      email: "bina@example.com",
    });

    const all = await getOrderList(staff.ctx, {
      status: null,
      paymentMethod: null,
      from: null,
      to: null,
      q: null,
      page: 1,
    });
    expect(all.total).toBe(2);
    expect(all.items[0]?.emailMasked).toMatch(/^b\*+@example\.com$/);

    const cod = await getOrderList(staff.ctx, {
      status: null,
      paymentMethod: "COD",
      from: null,
      to: null,
      q: null,
      page: 1,
    });
    expect(cod.items.map((o) => o.id)).toEqual([b.orderId]);

    const byNumber = await getOrderList(staff.ctx, {
      status: null,
      paymentMethod: null,
      from: null,
      to: null,
      q: a.orderNumber.toLowerCase(),
      page: 1,
    });
    expect(byNumber.items.map((o) => o.id)).toEqual([a.orderId]);

    const byEmail = await getOrderList(staff.ctx, {
      status: null,
      paymentMethod: null,
      from: null,
      to: null,
      q: "Asha@Example.com",
      page: 1,
    });
    expect(byEmail.items.map((o) => o.id)).toEqual([a.orderId]);

    // CONFIRMED: the address is operationally needed and the view is logged once.
    const detail = await getOrderDetail(staff.ctx, a.orderId);
    expect(detail?.addressExposure).toBe("full");
    expect(detail?.contact.email).toBe("asha@example.com");
    expect(detail?.address.line1).toBe("12 Station Road");
    await getOrderDetail(staff.ctx, a.orderId);
    expect(
      await testDb.adminAuditLog.count({
        where: { action: "order.address.view", targetId: a.orderId },
      }),
    ).toBe(1);
    expect(detail?.actions).toMatchObject({
      startProcessing: true,
      ship: false,
      cancel: null,
    });

    // Delivered: masked again, and nothing more is logged.
    await startProcessing(staff.ctx, a.orderId);
    await shipOrder(staff.ctx, a.orderId, SHIP);
    await markDelivered(staff.ctx, a.orderId);
    const delivered = await getOrderDetail(staff.ctx, a.orderId);
    expect(delivered?.addressExposure).toBe("masked");
    expect(delivered?.contact.email).toMatch(/^a\*+@example\.com$/);
    expect(delivered?.contact.phone).toMatch(/^\*+3210$/);
    expect(delivered?.address.line1).toBeNull();
    expect(
      await testDb.adminAuditLog.count({
        where: { action: "order.address.view", targetId: a.orderId },
      }),
    ).toBe(1);

    const admin = await verifiedStaff("ADMIN");
    const adminView = await getOrderDetail(admin.ctx, b.orderId);
    expect(adminView?.actions.cancel).toBe("confirmed");
    expect(adminView?.actions.codCollect).toBeNull();
    expect(
      await getOrderDetail(admin.ctx, "00000000-0000-7000-8000-000000000000"),
    ).toBeNull();
  });
});
