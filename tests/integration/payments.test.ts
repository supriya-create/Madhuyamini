import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addToCart } from "@/features/cart/service";
import { getCheckoutView, placeOrder } from "@/features/checkout/service";
import type { AddressSnapshot } from "@/features/checkout/types";
import { cancelPendingOrder } from "@/features/orders/service";
import { applyCapture } from "@/features/payments/capture";
import {
  confirmFromCallback,
  recordModalFailure,
  reconcileAttempt,
} from "@/features/payments/service";
import {
  ingestWebhook,
  processWebhookEvent,
} from "@/features/payments/webhook";
import { db } from "@/server/db";
import { getFakeGateway } from "@/server/payments";

import {
  createCategory,
  createProduct,
  createUser,
  createVariant,
  resetDatabase,
  testDb,
} from "./db";

/**
 * Capture and failure handling (T5/T6), the browser callback, the webhook
 * ledger and reconciliation, against the fake gateway (docs/checkout.md
 * §5.6, §5.8, §6, §9).
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

const address: AddressSnapshot = {
  recipientName: "Asha Devi",
  line1: "12 Station Road",
  line2: null,
  landmark: null,
  city: "Madhubani",
  state: "Bihar",
  postalCode: "847211",
  country: "IN",
};

/** A signed-in customer with a pending online order and its provider order. */
async function pendingOrder(options: { stock?: number; price?: number } = {}) {
  const category = await createCategory();
  const product = await createProduct(category.id);
  const variant = await createVariant(
    product.id,
    "SKU-1",
    options.price ?? 189_900,
  );
  await testDb.inventory.update({
    where: { variantId: variant.id },
    data: { stockOnHand: options.stock ?? 5 },
  });
  const user = await createUser("asha@example.com");
  const context = { kind: "user" as const, userId: user.id };
  await addToCart(context, { variantId: variant.id, quantity: 1 });
  const view = await getCheckoutView(context);
  if (!view) throw new Error("no checkout view");
  const outcome = await placeOrder({
    cartId: view.cartId,
    identity: { kind: "user", userId: user.id },
    customer: {
      userId: user.id,
      email: "asha@example.com",
      phone: "+919876543210",
    },
    address,
    paymentMethod: "RAZORPAY",
    quoteHash: view.quotes.RAZORPAY.hash,
    customerNote: null,
  });
  if (outcome.kind !== "placed" || !outcome.providerOrderId)
    throw new Error("placement failed");
  const attempt = await testDb.payment.findFirstOrThrow({
    where: { orderId: outcome.orderId },
  });
  return {
    userId: user.id,
    variantId: variant.id,
    orderId: outcome.orderId,
    orderNumber: outcome.orderNumber,
    providerOrderId: outcome.providerOrderId,
    attemptId: attempt.id,
    cartId: view.cartId,
    totalInPaise: view.quotes.RAZORPAY.totalInPaise,
  };
}

async function orderState(orderId: string) {
  const order = await testDb.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      payments: { orderBy: { attemptNo: "asc" } },
      reservations: true,
      events: { orderBy: { createdAt: "asc" } },
      refunds: true,
      cart: { select: { status: true } },
    },
  });
  const outbox = await testDb.notificationOutbox.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
  });
  return { order, outbox, eventTypes: order.events.map((e) => e.type) };
}

async function levels(variantId: string) {
  const row = await testDb.inventory.findUniqueOrThrow({
    where: { variantId },
  });
  return { stockOnHand: row.stockOnHand, reserved: row.reserved };
}

function webhookBody(event: string, payment: Record<string, unknown>): string {
  return JSON.stringify({
    entity: "event",
    event,
    contains: ["payment"],
    payload: { payment: { entity: payment } },
    created_at: 1_761_984_000,
  });
}

describe("the browser callback", () => {
  it("confirms the order when the signature is valid and the provider shows a capture", async () => {
    const o = await pendingOrder();
    const { providerPaymentId, signature } = gateway.simulatePayment(
      o.providerOrderId,
      { status: "captured" },
    );
    const outcome = await confirmFromCallback({
      orderId: o.orderId,
      providerOrderId: o.providerOrderId,
      providerPaymentId,
      signature,
    });
    expect(outcome).toEqual({ kind: "confirmed", capture: "confirmed" });

    const { order, outbox, eventTypes } = await orderState(o.orderId);
    expect(order.status).toBe("CONFIRMED");
    expect(order.confirmedAt).not.toBeNull();
    expect(order.payments[0]).toMatchObject({
      status: "CAPTURED",
      providerPaymentId,
    });
    expect(order.payments[0]?.signatureVerifiedAt).not.toBeNull();
    expect(order.reservations[0]?.status).toBe("CONSUMED");
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
    expect(order.cart?.status).toBe("CONVERTED");
    expect(outbox.map((n) => n.kind)).toEqual([
      "order.confirmed",
      "owner.new_order",
    ]);
    expect(eventTypes).toEqual([
      "order.placed",
      "payment.provider_order_created",
      "payment.captured",
      "order.confirmed",
    ]);

    // Replaying the callback changes nothing.
    expect(
      await confirmFromCallback({
        orderId: o.orderId,
        providerOrderId: o.providerOrderId,
        providerPaymentId,
        signature,
      }),
    ).toEqual({ kind: "confirmed", capture: "already_captured" });
    expect((await orderState(o.orderId)).outbox).toHaveLength(2);
  });

  it("rejects a tampered signature, a foreign order and a swapped payment id without changing anything", async () => {
    const o = await pendingOrder();
    const { providerPaymentId, signature } = gateway.simulatePayment(
      o.providerOrderId,
      { status: "captured" },
    );
    const tampered = (signature[0] === "0" ? "1" : "0") + signature.slice(1);
    expect(
      await confirmFromCallback({
        orderId: o.orderId,
        providerOrderId: o.providerOrderId,
        providerPaymentId,
        signature: tampered,
      }),
    ).toEqual({ kind: "invalid" });
    expect(
      await confirmFromCallback({
        orderId: o.orderId,
        providerOrderId: o.providerOrderId,
        providerPaymentId: "pay_other",
        signature,
      }),
    ).toEqual({ kind: "invalid" });
    expect(
      await confirmFromCallback({
        orderId: "00000000-0000-7000-8000-000000000000",
        providerOrderId: o.providerOrderId,
        providerPaymentId,
        signature,
      }),
    ).toEqual({ kind: "invalid" });
    const { order } = await orderState(o.orderId);
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.payments[0]?.status).toBe("CREATED");
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 1 });
  });

  it("does not confirm on a valid signature alone: an uncaptured payment keeps the order pending", async () => {
    const o = await pendingOrder();
    const { providerPaymentId, signature } = gateway.simulatePayment(
      o.providerOrderId,
      { status: "authorized" },
    );
    expect(
      await confirmFromCallback({
        orderId: o.orderId,
        providerOrderId: o.providerOrderId,
        providerPaymentId,
        signature,
      }),
    ).toEqual({ kind: "confirming" });
    expect((await orderState(o.orderId)).order.status).toBe("PENDING_PAYMENT");

    // The provider being unreachable is also "not yet".
    gateway.capturePayment(providerPaymentId);
    gateway.failNext("fetchPayment");
    expect(
      await confirmFromCallback({
        orderId: o.orderId,
        providerOrderId: o.providerOrderId,
        providerPaymentId,
        signature,
      }),
    ).toEqual({ kind: "confirming" });
    expect((await orderState(o.orderId)).order.status).toBe("PENDING_PAYMENT");

    // Once captured, the same callback confirms.
    expect(
      await confirmFromCallback({
        orderId: o.orderId,
        providerOrderId: o.providerOrderId,
        providerPaymentId,
        signature,
      }),
    ).toEqual({ kind: "confirmed", capture: "confirmed" });
  });

  it("holds a capture of the wrong amount for review and never confirms it", async () => {
    const o = await pendingOrder();
    const { providerPaymentId, signature } = gateway.simulatePayment(
      o.providerOrderId,
      { status: "captured", amountInPaise: o.totalInPaise - 100 },
    );
    expect(
      await confirmFromCallback({
        orderId: o.orderId,
        providerOrderId: o.providerOrderId,
        providerPaymentId,
        signature,
      }),
    ).toEqual({ kind: "confirmed", capture: "mismatch" });
    const { order, outbox, eventTypes } = await orderState(o.orderId);
    expect(order.status).toBe("NEEDS_REVIEW");
    expect(order.payments[0]?.status).toBe("CAPTURED");
    // Stock stays held (nothing consumed, nothing released) for the review.
    expect(order.reservations[0]?.status).toBe("ACTIVE");
    expect(eventTypes).toContain("order.needs_review");
    expect(outbox.map((n) => n.kind)).not.toContain("order.confirmed");
  });

  it("records a failed payment and lets the order wait for another try", async () => {
    const o = await pendingOrder();
    const { providerPaymentId, signature } = gateway.simulatePayment(
      o.providerOrderId,
      {
        status: "failed",
        errorCode: "BAD_REQUEST_ERROR",
        errorDescription: "Declined",
      },
    );
    expect(
      await confirmFromCallback({
        orderId: o.orderId,
        providerOrderId: o.providerOrderId,
        providerPaymentId,
        signature,
      }),
    ).toEqual({ kind: "failed" });
    const { order } = await orderState(o.orderId);
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.payments[0]).toMatchObject({
      status: "FAILED",
      failureCode: "BAD_REQUEST_ERROR",
      failureDescription: "Declined",
    });
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 1 });

    await recordModalFailure({
      orderId: o.orderId,
      providerOrderId: o.providerOrderId,
      providerPaymentId: null,
      code: "USER_CANCELLED",
      description: "Closed the window",
    });
    // Already failed: no second failure event.
    expect(
      (await orderState(o.orderId)).eventTypes.filter(
        (t) => t === "payment.failed",
      ),
    ).toHaveLength(1);
  });
});

describe("webhooks", () => {
  it("stores a signed delivery once, applies it, and ignores the duplicate", async () => {
    const o = await pendingOrder();
    const { providerPaymentId } = gateway.simulatePayment(o.providerOrderId, {
      status: "captured",
    });
    const body = webhookBody("payment.captured", {
      id: providerPaymentId,
      entity: "payment",
      amount: o.totalInPaise,
      currency: "INR",
      status: "captured",
      order_id: o.providerOrderId,
      method: "upi",
    });
    const signature = gateway.signWebhook(body);
    const now = new Date();

    const first = await ingestWebhook({
      rawBody: body,
      signature,
      eventId: "evt_1",
      now,
    });
    expect(first).toEqual({ status: "stored", eventId: "evt_1" });
    expect(await processWebhookEvent("evt_1", { now })).toBe("processed");
    expect((await orderState(o.orderId)).order.status).toBe("CONFIRMED");

    const again = await ingestWebhook({
      rawBody: body,
      signature,
      eventId: "evt_1",
      now,
    });
    expect(again).toEqual({ status: "duplicate", eventId: "evt_1" });
    expect(await processWebhookEvent("evt_1", { now })).toBe("skipped");
    const ledger = await testDb.paymentWebhookEvent.findUniqueOrThrow({
      where: { id: "evt_1" },
    });
    expect(ledger).toMatchObject({
      status: "PROCESSED",
      orderId: o.orderId,
      attempts: 1,
      providerOrderId: o.providerOrderId,
    });
    expect((await orderState(o.orderId)).outbox).toHaveLength(2);
  });

  it("rejects a bad signature or a malformed body without storing anything", async () => {
    const o = await pendingOrder();
    const body = webhookBody("payment.captured", {
      id: "pay_x",
      amount: o.totalInPaise,
      currency: "INR",
      status: "captured",
      order_id: o.providerOrderId,
    });
    expect(
      await ingestWebhook({
        rawBody: body,
        signature: gateway.signWebhook(body + " "),
        eventId: "evt_bad",
        now: new Date(),
      }),
    ).toEqual({ status: "invalid_signature" });
    expect(
      await ingestWebhook({
        rawBody: body,
        signature: null,
        eventId: "evt_bad",
        now: new Date(),
      }),
    ).toEqual({ status: "invalid_signature" });
    const junk = "not json";
    expect(
      await ingestWebhook({
        rawBody: junk,
        signature: gateway.signWebhook(junk),
        eventId: "evt_junk",
        now: new Date(),
      }),
    ).toEqual({ status: "malformed" });
    expect(await testDb.paymentWebhookEvent.count()).toBe(0);
    expect((await orderState(o.orderId)).order.status).toBe("PENDING_PAYMENT");
  });

  it("applies out-of-order deliveries safely: a failure after a capture is ignored", async () => {
    const o = await pendingOrder();
    const { providerPaymentId } = gateway.simulatePayment(o.providerOrderId, {
      status: "captured",
    });
    const captured = webhookBody("payment.captured", {
      id: providerPaymentId,
      amount: o.totalInPaise,
      currency: "INR",
      status: "captured",
      order_id: o.providerOrderId,
    });
    const failed = webhookBody("payment.failed", {
      id: "pay_earlier_try",
      amount: o.totalInPaise,
      currency: "INR",
      status: "failed",
      order_id: o.providerOrderId,
      error_code: "BAD_REQUEST_ERROR",
      error_description: "Declined",
    });
    const now = new Date();
    await ingestWebhook({
      rawBody: captured,
      signature: gateway.signWebhook(captured),
      eventId: "evt_c",
      now,
    });
    await ingestWebhook({
      rawBody: failed,
      signature: gateway.signWebhook(failed),
      eventId: "evt_f",
      now,
    });
    expect(await processWebhookEvent("evt_c", { now })).toBe("processed");
    expect(await processWebhookEvent("evt_f", { now })).toBe("ignored");
    const { order } = await orderState(o.orderId);
    expect(order.status).toBe("CONFIRMED");
    expect(order.payments[0]).toMatchObject({
      status: "CAPTURED",
      providerPaymentId,
    });
  });

  it("honours a capture that arrives after a recorded failure on the same provider order", async () => {
    const o = await pendingOrder();
    const first = gateway.simulatePayment(o.providerOrderId, {
      status: "failed",
      errorCode: "BAD_REQUEST_ERROR",
    });
    await confirmFromCallback({
      orderId: o.orderId,
      providerOrderId: o.providerOrderId,
      providerPaymentId: first.providerPaymentId,
      signature: first.signature,
    });
    expect((await orderState(o.orderId)).order.payments[0]?.status).toBe(
      "FAILED",
    );

    const second = gateway.simulatePayment(o.providerOrderId, {
      status: "captured",
    });
    const body = webhookBody("payment.captured", {
      id: second.providerPaymentId,
      amount: o.totalInPaise,
      currency: "INR",
      status: "captured",
      order_id: o.providerOrderId,
    });
    const now = new Date();
    await ingestWebhook({
      rawBody: body,
      signature: gateway.signWebhook(body),
      eventId: "evt_late",
      now,
    });
    expect(await processWebhookEvent("evt_late", { now })).toBe("processed");
    const { order } = await orderState(o.orderId);
    expect(order.status).toBe("CONFIRMED");
    expect(order.payments[0]).toMatchObject({
      status: "CAPTURED",
      providerPaymentId: second.providerPaymentId,
    });
  });

  it("stores unknown and unhandled events as ignored, never as errors", async () => {
    const body = webhookBody("payment.captured", {
      id: "pay_unknown",
      amount: 100,
      currency: "INR",
      status: "captured",
      order_id: "order_nobody",
    });
    const now = new Date();
    await ingestWebhook({
      rawBody: body,
      signature: gateway.signWebhook(body),
      eventId: "evt_u",
      now,
    });
    expect(await processWebhookEvent("evt_u", { now })).toBe("ignored");
    const other = JSON.stringify({ event: "payout.processed", payload: {} });
    await ingestWebhook({
      rawBody: other,
      signature: gateway.signWebhook(other),
      eventId: "evt_o",
      now,
    });
    expect(await processWebhookEvent("evt_o", { now })).toBe("ignored");
    const rows = await testDb.paymentWebhookEvent.findMany({
      orderBy: { id: "asc" },
    });
    expect(rows.map((r) => r.status)).toEqual(["IGNORED", "IGNORED"]);
  });

  it("claims an event for one worker at a time", async () => {
    const o = await pendingOrder();
    const { providerPaymentId } = gateway.simulatePayment(o.providerOrderId, {
      status: "captured",
    });
    const body = webhookBody("payment.captured", {
      id: providerPaymentId,
      amount: o.totalInPaise,
      currency: "INR",
      status: "captured",
      order_id: o.providerOrderId,
    });
    const now = new Date();
    await ingestWebhook({
      rawBody: body,
      signature: gateway.signWebhook(body),
      eventId: "evt_race",
      now,
    });
    const outcomes = await Promise.all([
      processWebhookEvent("evt_race", { now, worker: "a" }),
      processWebhookEvent("evt_race", { now, worker: "b" }),
      processWebhookEvent("evt_race", { now, worker: "c" }),
    ]);
    expect(outcomes.filter((o) => o === "processed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "skipped")).toHaveLength(2);
    expect((await orderState(o.orderId)).outbox).toHaveLength(2);
  });
});

describe("late captures (P8)", () => {
  it("confirms a cancelled order when the stock is still there", async () => {
    const o = await pendingOrder({ stock: 5 });
    await cancelPendingOrder({ kind: "user", userId: o.userId }, o.orderId);
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 0 });

    const { providerPaymentId } = gateway.simulatePayment(o.providerOrderId, {
      status: "captured",
    });
    const outcome = await applyCapture({
      attemptId: o.attemptId,
      providerPaymentId,
      amountInPaise: o.totalInPaise,
      currency: "INR",
      actor: "WEBHOOK",
      signatureVerified: true,
      now: new Date(),
    });
    expect(outcome).toBe("late_confirmed");
    const { order, outbox, eventTypes } = await orderState(o.orderId);
    expect(order).toMatchObject({
      status: "CONFIRMED",
      cancellationReason: null,
    });
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
    expect(eventTypes).toContain("payment.late_capture");
    expect(outbox.map((n) => n.kind)).toEqual([
      "order.confirmed",
      "owner.new_order",
    ]);
    expect(order.refunds).toHaveLength(0);
  });

  it("queues a refund when the stock is gone, and never confirms", async () => {
    const o = await pendingOrder({ stock: 1 });
    await cancelPendingOrder({ kind: "user", userId: o.userId }, o.orderId);
    // Someone else bought the last unit meanwhile.
    await testDb.inventory.update({
      where: { variantId: o.variantId },
      data: { stockOnHand: 0 },
    });
    const { providerPaymentId } = gateway.simulatePayment(o.providerOrderId, {
      status: "captured",
    });
    const outcome = await applyCapture({
      attemptId: o.attemptId,
      providerPaymentId,
      amountInPaise: o.totalInPaise,
      currency: "INR",
      actor: "WEBHOOK",
      signatureVerified: true,
      now: new Date(),
    });
    expect(outcome).toBe("refund_queued");
    const { order, outbox } = await orderState(o.orderId);
    expect(order.status).toBe("NEEDS_REVIEW");
    expect(order.payments[0]?.status).toBe("CAPTURED");
    expect(order.refunds).toHaveLength(1);
    expect(order.refunds[0]).toMatchObject({
      status: "INITIATED",
      amountInPaise: o.totalInPaise,
      reason: "late_capture_no_stock",
      reference: `${o.orderNumber}-R1`,
    });
    expect(outbox.map((n) => n.kind)).toEqual([
      "order.refund_requested",
      "ops.alert",
    ]);
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 0, reserved: 0 });
  });

  it("queues a refund for a second payment on an already confirmed order", async () => {
    const o = await pendingOrder();
    const first = gateway.simulatePayment(o.providerOrderId, {
      status: "captured",
    });
    await applyCapture({
      attemptId: o.attemptId,
      providerPaymentId: first.providerPaymentId,
      amountInPaise: o.totalInPaise,
      currency: "INR",
      actor: "WEBHOOK",
      signatureVerified: true,
      now: new Date(),
    });
    // A stale modal pays a second attempt.
    await testDb.payment.update({
      where: { id: o.attemptId },
      data: { status: "CAPTURED" },
    });
    const second = await testDb.payment.create({
      data: {
        orderId: o.orderId,
        attemptNo: 2,
        method: "RAZORPAY",
        status: "CREATED",
        amountInPaise: o.totalInPaise,
        receipt: `${o.orderNumber}-2`,
        providerOrderId: "order_second",
      },
    });
    const outcome = await applyCapture({
      attemptId: second.id,
      providerPaymentId: "pay_second",
      amountInPaise: o.totalInPaise,
      currency: "INR",
      actor: "WEBHOOK",
      signatureVerified: true,
      now: new Date(),
    });
    expect(outcome).toBe("duplicate_refund_queued");
    const { order } = await orderState(o.orderId);
    expect(order.status).toBe("CONFIRMED");
    expect(order.refunds.map((r) => [r.reason, r.reference])).toEqual([
      ["duplicate_payment", `${o.orderNumber}-R2`],
    ]);
  });
});

describe("reconciliation", () => {
  it("confirms a capture the webhook and callback both missed", async () => {
    const o = await pendingOrder();
    gateway.simulatePayment(o.providerOrderId, { status: "captured" });
    expect(await reconcileAttempt(o.attemptId)).toEqual({
      kind: "captured",
      capture: "confirmed",
    });
    expect((await orderState(o.orderId)).order.status).toBe("CONFIRMED");
    expect(await reconcileAttempt(o.attemptId)).toEqual({
      kind: "not_applicable",
    });
  });

  it("records a failure only when no payment is still in flight", async () => {
    const o = await pendingOrder();
    expect(await reconcileAttempt(o.attemptId)).toEqual({ kind: "unchanged" });
    gateway.simulatePayment(o.providerOrderId, {
      status: "failed",
      errorCode: "X",
    });
    expect(await reconcileAttempt(o.attemptId)).toEqual({ kind: "failed" });
    expect((await orderState(o.orderId)).order.payments[0]?.status).toBe(
      "FAILED",
    );
    // A later capture on the same provider order still wins.
    gateway.simulatePayment(o.providerOrderId, { status: "captured" });
    expect(await reconcileAttempt(o.attemptId)).toEqual({
      kind: "captured",
      capture: "confirmed",
    });
  });
});
