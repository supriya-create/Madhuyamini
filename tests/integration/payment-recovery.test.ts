import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { backoffMinutesFor, checkoutPolicy } from "@/config/checkout-policy";
import { getCheckoutView, placeOrder } from "@/features/checkout/service";
import { cancelPendingOrder } from "@/features/orders/service";
import { applyCapture } from "@/features/payments/capture";
import * as paymentData from "@/features/payments/data";
import {
  reconcileAttempt,
  recordModalFailure,
  startPaymentAttempt,
} from "@/features/payments/service";
import {
  ingestWebhook,
  processWebhookEvent,
} from "@/features/payments/webhook";
import { db } from "@/server/db";
import { runExpireReservations } from "@/server/jobs/expire-reservations";
import { runProcessWebhooks } from "@/server/jobs/process-webhooks";
import { runReconcilePayments } from "@/server/jobs/reconcile-payments";
import { runRefundPayments } from "@/server/jobs/refund-payments";
import { getFakeGateway } from "@/server/payments";

import { resetDatabase, testDb } from "./db";
import { placePendingOrder, testAddress } from "./fixtures/orders";
import type { PlacedFixture } from "./fixtures/orders";

/**
 * Payment recovery after the audit of 14 Nov 2026
 * (docs/website-functional-audit.md B-01, B-02, B-04): a capture that lands
 * after the customer cancelled and re-ordered from the same cart, a capture
 * on an attempt the browser had marked failed, and webhook deliveries that
 * cannot be applied. Every path must leave the money accounted for exactly
 * once, the stock counters in step, and an operations alert behind any
 * outcome that needs a human.
 */

const gateway = getFakeGateway();
const minute = 60 * 1000;

beforeEach(async () => {
  await resetDatabase();
  gateway.reset();
});
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

function captureBody(input: {
  providerPaymentId: string;
  providerOrderId: string;
  amountInPaise: number;
}): string {
  return JSON.stringify({
    entity: "event",
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: input.providerPaymentId,
          order_id: input.providerOrderId,
          amount: input.amountInPaise,
          currency: "INR",
          status: "captured",
        },
      },
    },
  });
}

/** Stores a signed capture delivery without applying it (the route's T9). */
async function deliverCapture(
  eventId: string,
  input: Parameters<typeof captureBody>[0],
  now: Date,
) {
  const body = captureBody(input);
  return ingestWebhook({
    rawBody: body,
    signature: gateway.signWebhook(body),
    eventId,
    now,
  });
}

/** The provider captured the order's open attempt, but nobody told us yet. */
function captureAtProvider(o: PlacedFixture) {
  if (!o.providerOrderId) throw new Error("no provider order");
  const { providerPaymentId } = gateway.simulatePayment(o.providerOrderId, {
    status: "captured",
  });
  return {
    providerPaymentId,
    providerOrderId: o.providerOrderId,
    amountInPaise: o.totalInPaise,
  };
}

async function orderState(orderId: string) {
  const order = await testDb.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      payments: { orderBy: { attemptNo: "asc" } },
      reservations: true,
      refunds: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      cart: { select: { status: true } },
    },
  });
  const outbox = await testDb.notificationOutbox.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
  });
  return {
    order,
    outbox,
    eventTypes: order.events.map((e) => e.type),
    outboxKinds: outbox.map((n) => n.kind),
  };
}

async function levels(variantId: string) {
  const row = await testDb.inventory.findUniqueOrThrow({
    where: { variantId },
  });
  return { stockOnHand: row.stockOnHand, reserved: row.reserved };
}

/** Inventory.reserved = Σ ACTIVE holds, and nothing negative, for every variant. */
async function expectInventoryInStep() {
  const rows = await testDb.inventory.findMany();
  for (const row of rows) {
    const active = await testDb.inventoryReservation.aggregate({
      where: { variantId: row.variantId, status: "ACTIVE" },
      _sum: { quantity: true },
    });
    expect(row.reserved).toBe(active._sum.quantity ?? 0);
    expect(row.stockOnHand).toBeGreaterThanOrEqual(row.reserved);
  }
}

/** Order A cancelled by the customer, then order B placed from the same cart. */
async function cancelAndReorder(
  method: "COD" | "RAZORPAY",
  options: { stock?: number; quantity?: number } = {},
) {
  const a = await placePendingOrder(options);
  if (!a.userId) throw new Error("fixture is a guest");
  await cancelPendingOrder({ kind: "user", userId: a.userId }, a.orderId);
  const context = { kind: "user" as const, userId: a.userId };
  const view = await getCheckoutView(context);
  if (!view || view.cartId !== a.cartId) throw new Error("cart changed");
  const placed = await placeOrder({
    cartId: a.cartId,
    identity: { kind: "user", userId: a.userId },
    customer: { userId: a.userId, email: a.email, phone: "+919876543210" },
    address: testAddress,
    paymentMethod: method,
    quoteHash: view.quotes[method].hash,
    customerNote: null,
  });
  if (placed.kind !== "placed") throw new Error(`re-order: ${placed.kind}`);
  return {
    a,
    b: { orderId: placed.orderId, orderNumber: placed.orderNumber },
  };
}

describe("a capture after cancellation (B-01)", () => {
  it("still revives the cancelled order when its cart has not moved on", async () => {
    const a = await placePendingOrder({ stock: 5 });
    await cancelPendingOrder({ kind: "user", userId: a.userId! }, a.orderId);
    expect(await levels(a.variantId)).toEqual({ stockOnHand: 5, reserved: 0 });

    const now = new Date();
    await deliverCapture("evt_late", captureAtProvider(a), now);
    expect(await processWebhookEvent("evt_late", { now })).toBe("processed");

    const { order, eventTypes } = await orderState(a.orderId);
    expect(order).toMatchObject({
      status: "CONFIRMED",
      cancellationReason: null,
    });
    expect(order.payments[0]?.status).toBe("CAPTURED");
    expect(order.refunds).toHaveLength(0);
    expect(eventTypes).toContain("payment.late_capture");
    expect(order.cart?.status).toBe("CONVERTED");
    expect(await levels(a.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
    await expectInventoryInStep();
  });

  it("refunds the capture and leaves the order cancelled when the cart already carries a newer order", async () => {
    const { a, b } = await cancelAndReorder("COD", { stock: 5 });
    // B sold the unit outright; A's hold had been released at cancellation.
    expect(await levels(a.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });

    const now = new Date();
    const capture = captureAtProvider(a);
    await deliverCapture("evt_superseded", capture, now);
    expect(await processWebhookEvent("evt_superseded", { now })).toBe(
      "processed",
    );

    const { order, outbox, eventTypes } = await orderState(a.orderId);
    // The cancelled order is not reactivated, so the cart keeps one live order.
    expect(order).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "CUSTOMER",
      cartId: a.cartId,
    });
    expect(
      await testDb.order.count({
        where: { cartId: a.cartId, status: { not: "CANCELLED" } },
      }),
    ).toBe(1);
    const successor = await testDb.order.findUniqueOrThrow({
      where: { id: b.orderId },
    });
    expect(successor).toMatchObject({ status: "CONFIRMED", cartId: a.cartId });

    // The money is recognised on the attempt and sent back, exactly once.
    expect(order.payments[0]).toMatchObject({
      status: "CAPTURED",
      providerPaymentId: capture.providerPaymentId,
    });
    expect(order.refunds).toHaveLength(1);
    expect(order.refunds[0]).toMatchObject({
      status: "INITIATED",
      amountInPaise: a.totalInPaise,
      reason: "late_capture_superseded",
      reference: `${a.orderNumber}-R1`,
      paymentId: a.attemptId,
    });

    // Auditable: the capture, the decision naming the newer order, the refund.
    expect(eventTypes).toEqual([
      "order.placed",
      "payment.provider_order_created",
      "order.cancelled",
      "payment.captured",
      "payment.late_capture",
      "refund.requested",
    ]);
    const decision = order.events.find(
      (e) => e.type === "payment.late_capture",
    );
    expect(decision?.note).toContain(b.orderNumber);
    expect(decision?.data).toEqual({ supersededBy: b.orderNumber });
    expect(outbox.map((n) => [n.kind, n.recipient])).toEqual([
      ["order.refund_requested", a.email],
      ["ops.alert", "owner@example.com"],
    ]);
    const ledger = await testDb.paymentWebhookEvent.findUniqueOrThrow({
      where: { id: "evt_superseded" },
    });
    expect(ledger).toMatchObject({
      status: "PROCESSED",
      orderId: a.orderId,
      attempts: 1,
    });

    // Stock is untouched by the refund path.
    expect(await levels(a.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
    await expectInventoryInStep();

    // The refund worker executes the intent with the provider (the intent
    // row's due time comes from the database clock, so run a moment later).
    expect(
      await runRefundPayments({ now: new Date(now.getTime() + minute) }),
    ).toMatchObject({
      processed: 1,
      failed: 0,
    });
    const after = await orderState(a.orderId);
    expect(after.order.refunds[0]?.status).toBe("PROCESSED");
    expect(after.order.payments[0]?.status).toBe("REFUNDED");
    expect(after.order.status).toBe("CANCELLED");
  });

  it("refunds rather than revives when the newer order is still awaiting payment", async () => {
    const { a, b } = await cancelAndReorder("RAZORPAY", { stock: 5 });
    const outcome = await applyCapture({
      attemptId: a.attemptId,
      ...captureAtProvider(a),
      currency: "INR",
      actor: "WEBHOOK",
      signatureVerified: true,
      now: new Date(),
    });
    expect(outcome).toBe("superseded_refund_queued");
    expect((await orderState(a.orderId)).order.status).toBe("CANCELLED");
    expect((await orderState(b.orderId)).order.status).toBe("PENDING_PAYMENT");
    // B's hold is the only one; A's refund did not touch the counters.
    expect(await levels(a.variantId)).toEqual({ stockOnHand: 5, reserved: 1 });
    await expectInventoryInStep();
  });

  it("ignores a duplicate delivery and a replay under a new event id without a second refund", async () => {
    const { a } = await cancelAndReorder("COD");
    const now = new Date();
    const capture = captureAtProvider(a);
    await deliverCapture("evt_dup", capture, now);
    expect(await processWebhookEvent("evt_dup", { now })).toBe("processed");

    expect(await deliverCapture("evt_dup", capture, now)).toEqual({
      status: "duplicate",
      eventId: "evt_dup",
    });
    expect(await processWebhookEvent("evt_dup", { now })).toBe("skipped");

    await deliverCapture("evt_dup_replay", capture, now);
    expect(await processWebhookEvent("evt_dup_replay", { now })).toBe(
      "processed",
    );
    // Reconciliation finds the attempt already captured and changes nothing.
    expect(await reconcileAttempt(a.attemptId, now)).toEqual({
      kind: "not_applicable",
    });
    expect(await runReconcilePayments({ now })).toMatchObject({ examined: 0 });

    const { order, eventTypes } = await orderState(a.orderId);
    expect(order.refunds).toHaveLength(1);
    expect(eventTypes.filter((t) => t === "payment.captured")).toHaveLength(1);
    expect(eventTypes.filter((t) => t === "refund.requested")).toHaveLength(1);
    expect(await testDb.notificationOutbox.count()).toBeGreaterThan(0);
    expect(
      await testDb.notificationOutbox.count({
        where: { kind: "order.refund_requested" },
      }),
    ).toBe(1);
    await expectInventoryInStep();
  });

  it("applies a superseded capture exactly once when two deliveries race", async () => {
    const { a } = await cancelAndReorder("COD");
    const now = new Date();
    const capture = captureAtProvider(a);
    await deliverCapture("evt_race_1", capture, now);
    await deliverCapture("evt_race_2", capture, now);
    const outcomes = await Promise.all([
      processWebhookEvent("evt_race_1", { now, worker: "a" }),
      processWebhookEvent("evt_race_2", { now, worker: "b" }),
    ]);
    expect(outcomes).toEqual(["processed", "processed"]);
    const { order, eventTypes } = await orderState(a.orderId);
    expect(order.status).toBe("CANCELLED");
    expect(order.refunds).toHaveLength(1);
    expect(eventTypes.filter((t) => t === "payment.late_capture")).toHaveLength(
      1,
    );
    await expectInventoryInStep();
  });

  it("applies a capture exactly once when a webhook and reconciliation race", async () => {
    const a = await placePendingOrder({ stock: 3 });
    const now = new Date();
    await deliverCapture("evt_vs_reconcile", captureAtProvider(a), now);
    const [webhook, reconcile] = await Promise.all([
      processWebhookEvent("evt_vs_reconcile", { now }),
      reconcileAttempt(a.attemptId, now),
    ]);
    expect(webhook).toBe("processed");
    expect(["captured", "not_applicable"]).toContain(reconcile.kind);
    const { order, eventTypes } = await orderState(a.orderId);
    expect(order.status).toBe("CONFIRMED");
    expect(order.payments[0]?.status).toBe("CAPTURED");
    expect(eventTypes.filter((t) => t === "payment.captured")).toHaveLength(1);
    expect(eventTypes.filter((t) => t === "order.confirmed")).toHaveLength(1);
    expect(order.reservations.map((r) => r.status)).toEqual(["CONSUMED"]);
    expect(await levels(a.variantId)).toEqual({ stockOnHand: 2, reserved: 0 });
    expect(
      await testDb.notificationOutbox.count({
        where: { kind: "order.confirmed" },
      }),
    ).toBe(1);
    await expectInventoryInStep();
  });
});

describe("a capture on an attempt marked failed (B-02)", () => {
  async function failInBrowser(o: PlacedFixture) {
    await recordModalFailure({
      orderId: o.orderId,
      providerOrderId: o.providerOrderId,
      providerPaymentId: null,
      code: "BAD_REQUEST_ERROR",
      description: "Payment failed",
    });
    const attempt = await testDb.payment.findUniqueOrThrow({
      where: { id: o.attemptId },
    });
    expect(attempt.status).toBe("FAILED");
  }

  it("reconciles a capture that followed a browser-reported failure", async () => {
    const o = await placePendingOrder({ stock: 5 });
    await failInBrowser(o);
    captureAtProvider(o);

    const later = new Date(
      Date.now() + (checkoutPolicy.payment.reconcileAfterMinutes + 1) * minute,
    );
    expect(await runReconcilePayments({ now: later })).toMatchObject({
      examined: 1,
      captured: 1,
    });
    const { order, eventTypes } = await orderState(o.orderId);
    expect(order.status).toBe("CONFIRMED");
    expect(order.payments[0]?.status).toBe("CAPTURED");
    expect(order.reservations.map((r) => r.status)).toEqual(["CONSUMED"]);
    expect(eventTypes).toContain("payment.failed");
    expect(eventTypes).toContain("order.confirmed");
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
    await expectInventoryInStep();

    // Running again changes nothing: the order is no longer pending.
    expect(await runReconcilePayments({ now: later })).toMatchObject({
      examined: 0,
    });
    expect(order.refunds).toHaveLength(0);
  });

  it("leaves a failed attempt that never reached the provider alone", async () => {
    const o = await placePendingOrder();
    // A T4 failure: provider order creation gave up; nothing to ask about.
    await testDb.payment.update({
      where: { id: o.attemptId },
      data: { status: "FAILED", providerOrderId: null, failedAt: new Date() },
    });
    const later = new Date(Date.now() + 10 * minute);
    expect(await runReconcilePayments({ now: later })).toMatchObject({
      examined: 0,
    });
    expect(await paymentData.findReconcilableAttempts(o.orderId)).toEqual([]);
  });

  it("confirms instead of cancelling when the expiry sweep finds a capture on a failed attempt", async () => {
    const o = await placePendingOrder({ stock: 5 });
    await failInBrowser(o);
    captureAtProvider(o);
    const now = new Date();
    await testDb.order.update({
      where: { id: o.orderId },
      data: { pendingExpiresAt: new Date(now.getTime() - minute) },
    });

    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 1,
      confirmed: 1,
      cancelled: 0,
    });
    const { order, outboxKinds } = await orderState(o.orderId);
    expect(order.status).toBe("CONFIRMED");
    expect(order.reservations.map((r) => r.status)).toEqual(["CONSUMED"]);
    expect(outboxKinds).toEqual(["order.confirmed", "owner.new_order"]);
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
    await expectInventoryInStep();
    expect(await runExpireReservations({ now })).toMatchObject({ examined: 0 });
  });

  it("checks every attempt of an expiring order, not only the open one", async () => {
    const o = await placePendingOrder({ stock: 5 });
    await failInBrowser(o);
    // "Try again" opened attempt 2; the bank then settled the first try.
    const second = await startPaymentAttempt(o.orderId, new Date());
    expect(second.attemptId).not.toBe(o.attemptId);
    captureAtProvider(o);
    const now = new Date(Date.now() + 60 * minute);
    await testDb.order.update({
      where: { id: o.orderId },
      data: { pendingExpiresAt: new Date(now.getTime() - minute) },
    });

    expect(await runExpireReservations({ now })).toMatchObject({
      confirmed: 1,
      cancelled: 0,
    });
    const { order } = await orderState(o.orderId);
    expect(order.status).toBe("CONFIRMED");
    expect(order.payments.map((p) => [p.attemptNo, p.status])).toEqual([
      [1, "CAPTURED"],
      [2, "CREATED"],
    ]);
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
    await expectInventoryInStep();
  });

  it("still cancels and releases stock when nothing was captured", async () => {
    const o = await placePendingOrder({ stock: 5 });
    await failInBrowser(o);
    const now = new Date();
    await testDb.order.update({
      where: { id: o.orderId },
      data: { pendingExpiresAt: new Date(now.getTime() - minute) },
    });
    expect(await runExpireReservations({ now })).toMatchObject({
      cancelled: 1,
      confirmed: 0,
    });
    expect((await orderState(o.orderId)).order.status).toBe("CANCELLED");
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 0 });
    await expectInventoryInStep();
  });
});

describe("webhook deliveries that cannot be applied (B-04)", () => {
  /** The attempt looks like one whose provider order was never persisted (T3 pending). */
  async function rewindToInitiated(o: PlacedFixture) {
    await testDb.payment.update({
      where: { id: o.attemptId },
      data: { status: "INITIATED" },
    });
  }

  it("retries a delivery that failed transiently and applies it once the cause is gone", async () => {
    const o = await placePendingOrder({ stock: 5 });
    const capture = captureAtProvider(o);
    await rewindToInitiated(o);
    const now = new Date();
    await deliverCapture("evt_transient", capture, now);

    expect(await processWebhookEvent("evt_transient", { now })).toBe(
      "retry_scheduled",
    );
    let ledger = await testDb.paymentWebhookEvent.findUniqueOrThrow({
      where: { id: "evt_transient" },
    });
    expect(ledger).toMatchObject({ status: "RECEIVED", attempts: 1 });
    expect(ledger.lastError).toContain("cannot be applied");
    expect(ledger.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    // A duplicate delivery before the retry is due does not burn an attempt.
    expect(await processWebhookEvent("evt_transient", { now })).toBe("skipped");
    expect(await runProcessWebhooks({ now })).toMatchObject({ examined: 0 });
    expect((await orderState(o.orderId)).order.status).toBe("PENDING_PAYMENT");
    expect(await testDb.notificationOutbox.count()).toBe(0);

    // T3 catches up; the scheduled retry applies the capture.
    await testDb.payment.update({
      where: { id: o.attemptId },
      data: { status: "CREATED" },
    });
    const due = new Date(
      now.getTime() + (backoffMinutesFor(checkoutPolicy.jobs, 1) + 1) * minute,
    );
    expect(await runProcessWebhooks({ now: due })).toMatchObject({
      examined: 1,
      processed: 1,
    });
    ledger = await testDb.paymentWebhookEvent.findUniqueOrThrow({
      where: { id: "evt_transient" },
    });
    expect(ledger).toMatchObject({
      status: "PROCESSED",
      attempts: 2,
      lastError: null,
      orderId: o.orderId,
    });
    const { order } = await orderState(o.orderId);
    expect(order.status).toBe("CONFIRMED");
    expect(order.payments[0]).toMatchObject({
      status: "CAPTURED",
      providerPaymentId: capture.providerPaymentId,
    });
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
    await expectInventoryInStep();
  });

  it("alerts operations once when a delivery exhausts its retries", async () => {
    const o = await placePendingOrder();
    const capture = captureAtProvider(o);
    await rewindToInitiated(o);
    let now = new Date();
    await deliverCapture("evt_exhausted", capture, now);

    const outcomes: string[] = [];
    for (let i = 0; i < checkoutPolicy.jobs.maxAttempts; i += 1) {
      outcomes.push(await processWebhookEvent("evt_exhausted", { now }));
      // Far enough ahead to be due whatever the backoff step.
      now = new Date(now.getTime() + 2 * 24 * 60 * minute);
    }
    expect(outcomes.slice(0, -1).every((o) => o === "retry_scheduled")).toBe(
      true,
    );
    expect(outcomes.at(-1)).toBe("failed");

    const ledger = await testDb.paymentWebhookEvent.findUniqueOrThrow({
      where: { id: "evt_exhausted" },
    });
    expect(ledger).toMatchObject({
      status: "FAILED",
      attempts: checkoutPolicy.jobs.maxAttempts,
      orderId: o.orderId,
    });
    expect(ledger.lastError).toContain("cannot be applied");

    const alerts = await testDb.notificationOutbox.findMany({
      where: { kind: "ops.alert" },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      dedupeKey: "ops.alert:webhook-failed:evt_exhausted",
      orderId: o.orderId,
      recipient: "owner@example.com",
      status: "PENDING",
    });
    expect(alerts[0]?.payload).toMatchObject({
      eventId: "evt_exhausted",
      eventType: "payment.captured",
      providerOrderId: o.providerOrderId,
      providerPaymentId: capture.providerPaymentId,
      orderNumber: o.orderNumber,
      attempts: checkoutPolicy.jobs.maxAttempts,
    });
    expect(JSON.stringify(alerts[0]?.payload)).not.toContain(o.email);

    // Nothing was applied, and a further run neither retries nor re-alerts.
    expect((await orderState(o.orderId)).order.payments[0]?.status).toBe(
      "INITIATED",
    );
    expect(await processWebhookEvent("evt_exhausted", { now })).toBe("skipped");
    expect(await runProcessWebhooks({ now })).toMatchObject({ examined: 0 });
    expect(
      await testDb.notificationOutbox.count({ where: { kind: "ops.alert" } }),
    ).toBe(1);
  });

  it("alerts operations about a capture that matches no attempt", async () => {
    const now = new Date();
    await deliverCapture(
      "evt_unmatched",
      {
        providerPaymentId: "pay_stranger",
        providerOrderId: "order_stranger",
        amountInPaise: 5_000,
      },
      now,
    );
    expect(await processWebhookEvent("evt_unmatched", { now })).toBe("ignored");
    const alert = await testDb.notificationOutbox.findUniqueOrThrow({
      where: { dedupeKey: "ops.alert:webhook-unmatched:pay_stranger" },
    });
    expect(alert.payload).toMatchObject({
      providerOrderId: "order_stranger",
      providerPaymentId: "pay_stranger",
      amountInPaise: 5_000,
    });
    // A redelivery of the same capture does not alert twice.
    await deliverCapture(
      "evt_unmatched_again",
      {
        providerPaymentId: "pay_stranger",
        providerOrderId: "order_stranger",
        amountInPaise: 5_000,
      },
      now,
    );
    expect(await processWebhookEvent("evt_unmatched_again", { now })).toBe(
      "ignored",
    );
    expect(
      await testDb.notificationOutbox.count({ where: { kind: "ops.alert" } }),
    ).toBe(1);
  });
});

describe("refund references on a late capture (A)", () => {
  /** An earlier refund row on the attempt, as a staff refund that failed would leave. */
  async function existingRefund(
    a: PlacedFixture,
    amountInPaise: number,
    reference = `${a.orderNumber}-R1`,
    paymentId = a.attemptId,
  ) {
    await testDb.refund.create({
      data: {
        orderId: a.orderId,
        paymentId,
        amountInPaise,
        reason: "shop_refund",
        reference,
        status: "FAILED",
        lastError: "fixture",
      },
    });
  }

  it("sequences a further refund after an existing one and refunds the whole capture", async () => {
    const { a } = await cancelAndReorder("COD");
    await existingRefund(a, 5_000);
    const now = new Date();
    await deliverCapture("evt_seq", captureAtProvider(a), now);
    expect(await processWebhookEvent("evt_seq", { now })).toBe("processed");

    const { order, eventTypes } = await orderState(a.orderId);
    expect(order.payments[0]?.status).toBe("CAPTURED");
    expect(
      order.refunds.map((r) => [
        r.reference,
        r.amountInPaise,
        r.status,
        r.reason,
        r.operationKey,
      ]),
    ).toEqual([
      [`${a.orderNumber}-R1`, 5_000, "FAILED", "shop_refund", null],
      [
        `${a.orderNumber}-R1-2`,
        a.totalInPaise,
        "INITIATED",
        "late_capture_superseded",
        null,
      ],
    ]);
    expect(eventTypes.filter((t) => t === "refund.requested")).toHaveLength(1);
    expect(eventTypes).not.toContain("refund.not_queued");
    expect(
      await testDb.notificationOutbox.count({
        where: { kind: "order.refund_requested", orderId: a.orderId },
      }),
    ).toBe(1);
    await expectInventoryInStep();
  });

  it("queues exactly one further refund when a delivery, a duplicate and a reconciliation race", async () => {
    const { a } = await cancelAndReorder("COD");
    await existingRefund(a, 5_000);
    const now = new Date();
    const capture = captureAtProvider(a);
    await deliverCapture("evt_seq_race", capture, now);
    await deliverCapture("evt_seq_race_dup", capture, now);
    const outcomes = await Promise.all([
      processWebhookEvent("evt_seq_race", { now, worker: "a" }),
      processWebhookEvent("evt_seq_race_dup", { now, worker: "b" }),
      reconcileAttempt(a.attemptId, now),
    ]);
    expect(outcomes[0]).toBe("processed");
    expect(outcomes[1]).toBe("processed");
    const { order, eventTypes } = await orderState(a.orderId);
    expect(order.refunds.map((r) => r.reference)).toEqual([
      `${a.orderNumber}-R1`,
      `${a.orderNumber}-R1-2`,
    ]);
    expect(
      order.refunds
        .filter((r) => r.status === "INITIATED")
        .reduce((sum, r) => sum + r.amountInPaise, 0),
    ).toBe(a.totalInPaise);
    expect(eventTypes.filter((t) => t === "payment.captured")).toHaveLength(1);
    expect(eventTypes.filter((t) => t === "refund.requested")).toHaveLength(1);
    expect(order.status).toBe("CANCELLED");
    await expectInventoryInStep();
  });

  it("never reports success when the computed reference is already taken", async () => {
    const { a, b } = await cancelAndReorder("COD");
    // A row elsewhere already carries the reference this capture would use
    // (only reachable by hand, but the unique index makes the skip silent).
    const successorPayment = await testDb.payment.findFirstOrThrow({
      where: { orderId: b.orderId },
    });
    await existingRefund(a, 1_000, `${a.orderNumber}-R1`, successorPayment.id);
    await testDb.refund.updateMany({
      where: { paymentId: successorPayment.id },
      data: { orderId: b.orderId },
    });

    const capture = captureAtProvider(a);
    const outcome = await applyCapture({
      attemptId: a.attemptId,
      ...capture,
      currency: "INR",
      actor: "WEBHOOK",
      signatureVerified: true,
      now: new Date(),
    });
    expect(outcome).toBe("refund_not_queued");

    const { order, eventTypes, outbox } = await orderState(a.orderId);
    expect(order.status).toBe("CANCELLED");
    expect(order.payments[0]).toMatchObject({
      status: "CAPTURED",
      providerPaymentId: capture.providerPaymentId,
    });
    expect(order.refunds).toHaveLength(0);
    expect(eventTypes).toContain("refund.not_queued");
    const alert = outbox.find((n) => n.kind === "ops.alert");
    expect(alert).toMatchObject({
      dedupeKey: `ops.alert:refund-not-queued:${a.orderNumber}-R1`,
      recipient: "owner@example.com",
    });
    expect(alert?.payload).toMatchObject({
      orderNumber: a.orderNumber,
      reference: `${a.orderNumber}-R1`,
      amountInPaise: a.totalInPaise,
      refundReason: "late_capture_superseded",
    });
    expect(outbox.map((n) => n.kind)).not.toContain("order.refund_requested");

    // A repeat changes nothing and does not alert twice.
    expect(
      await applyCapture({
        attemptId: a.attemptId,
        ...capture,
        currency: "INR",
        actor: "WEBHOOK",
        signatureVerified: true,
        now: new Date(),
      }),
    ).toBe("already_captured");
    expect(
      await testDb.notificationOutbox.count({ where: { kind: "ops.alert" } }),
    ).toBe(1);
    await expectInventoryInStep();
  });
});

describe("reconciliation of cancelled orders (B)", () => {
  const afterReconcileDelay = () =>
    new Date(
      Date.now() + (checkoutPolicy.payment.reconcileAfterMinutes + 1) * minute,
    );

  it("refunds a capture found on a customer-cancelled order that nobody announced", async () => {
    const a = await placePendingOrder({ stock: 5 });
    await cancelPendingOrder({ kind: "user", userId: a.userId! }, a.orderId);
    const capture = captureAtProvider(a);

    const now = afterReconcileDelay();
    expect(await runReconcilePayments({ now })).toMatchObject({
      examined: 0,
      cancelledExamined: 1,
      cancelledRefunded: 1,
      cancelledErrors: 0,
    });

    const { order, eventTypes, outbox } = await orderState(a.orderId);
    expect(order).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "CUSTOMER",
    });
    expect(order.cart?.status).toBe("ACTIVE");
    expect(order.payments[0]).toMatchObject({
      status: "CAPTURED",
      providerPaymentId: capture.providerPaymentId,
    });
    expect(order.refunds).toHaveLength(1);
    expect(order.refunds[0]).toMatchObject({
      status: "INITIATED",
      amountInPaise: a.totalInPaise,
      reason: "late_capture_after_cancellation",
      reference: `${a.orderNumber}-R1`,
    });
    expect(eventTypes).toEqual([
      "order.placed",
      "payment.provider_order_created",
      "order.cancelled",
      "payment.captured",
      "payment.late_capture",
      "refund.requested",
    ]);
    expect(eventTypes).not.toContain("order.confirmed");
    expect(outbox.map((n) => n.kind)).toEqual([
      "order.refund_requested",
      "ops.alert",
    ]);
    expect(
      await testDb.order.count({
        where: { cartId: a.cartId, status: { not: "CANCELLED" } },
      }),
    ).toBe(0);
    expect(await levels(a.variantId)).toEqual({ stockOnHand: 5, reserved: 0 });
    await expectInventoryInStep();

    // Settled attempts are not asked about again.
    expect(await runReconcilePayments({ now })).toMatchObject({
      cancelledExamined: 0,
    });
  });

  it("refunds rather than revives an order the sweep cancelled", async () => {
    const a = await placePendingOrder({ stock: 5 });
    const now = new Date();
    await testDb.order.update({
      where: { id: a.orderId },
      data: { pendingExpiresAt: new Date(now.getTime() - minute) },
    });
    expect(await runExpireReservations({ now })).toMatchObject({
      cancelled: 1,
    });
    // The bank settled the customer's payment after the deadline; no webhook.
    captureAtProvider(a);

    expect(
      await runReconcilePayments({ now: afterReconcileDelay() }),
    ).toMatchObject({ cancelledExamined: 1, cancelledRefunded: 1 });
    const { order, eventTypes } = await orderState(a.orderId);
    expect(order).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "PAYMENT_TIMEOUT",
    });
    expect(order.refunds.map((r) => r.reason)).toEqual([
      "late_capture_after_cancellation",
    ]);
    expect(eventTypes).not.toContain("order.confirmed");
    expect(order.reservations.map((r) => r.status)).toEqual(["EXPIRED"]);
    expect(await levels(a.variantId)).toEqual({ stockOnHand: 5, reserved: 0 });
    await expectInventoryInStep();
  });

  it("refunds a capture on a cancelled order whose cart was reused as superseded", async () => {
    const { a, b } = await cancelAndReorder("COD", { stock: 5 });
    captureAtProvider(a);
    expect(
      await runReconcilePayments({ now: afterReconcileDelay() }),
    ).toMatchObject({ cancelledExamined: 1, cancelledRefunded: 1 });
    const { order } = await orderState(a.orderId);
    expect(order.status).toBe("CANCELLED");
    expect(order.refunds.map((r) => r.reason)).toEqual([
      "late_capture_superseded",
    ]);
    expect((await orderState(b.orderId)).order.status).toBe("CONFIRMED");
    expect(await levels(a.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
    await expectInventoryInStep();
  });

  it("checks an uncaptured attempt on the backoff schedule and stops after the window", async () => {
    const a = await placePendingOrder();
    await cancelPendingOrder({ kind: "user", userId: a.userId! }, a.orderId);
    const checks = () =>
      testDb.orderEvent.count({
        where: { orderId: a.orderId, type: "payment.reconcile_checked" },
      });

    // Not yet: the webhook still has its chance.
    expect(await runReconcilePayments({ now: new Date() })).toMatchObject({
      cancelledExamined: 0,
    });
    const first = afterReconcileDelay();
    expect(await runReconcilePayments({ now: first })).toMatchObject({
      cancelledExamined: 1,
      cancelledUnchanged: 1,
      cancelledRefunded: 0,
    });
    expect(await checks()).toBe(1);
    // The same moment again: not due.
    expect(await runReconcilePayments({ now: first })).toMatchObject({
      cancelledExamined: 0,
    });
    // After the first backoff step: checked again.
    const second = new Date(
      first.getTime() +
        (backoffMinutesFor(checkoutPolicy.jobs, 1) + 1) * minute,
    );
    expect(await runReconcilePayments({ now: second })).toMatchObject({
      cancelledExamined: 1,
      cancelledUnchanged: 1,
    });
    expect(await checks()).toBe(2);
    expect((await orderState(a.orderId)).order.payments[0]?.status).toBe(
      "CREATED",
    );

    // Outside the window the attempt is left alone.
    await testDb.order.update({
      where: { id: a.orderId },
      data: {
        cancelledAt: new Date(
          Date.now() -
            (checkoutPolicy.payment.reconcileCancelledWithinHours + 1) *
              60 *
              minute,
        ),
      },
    });
    const much = new Date(second.getTime() + 24 * 60 * minute);
    expect(await runReconcilePayments({ now: much })).toMatchObject({
      cancelledExamined: 0,
    });
    expect(await checks()).toBe(2);
    expect((await orderState(a.orderId)).order.refunds).toHaveLength(0);
  });

  it("applies a capture once when a webhook and the cancelled-order check race", async () => {
    const a = await placePendingOrder({ stock: 5 });
    await cancelPendingOrder({ kind: "user", userId: a.userId! }, a.orderId);
    const capture = captureAtProvider(a);
    const now = afterReconcileDelay();
    await deliverCapture("evt_vs_cancelled", capture, now);

    const [webhook, reconcile] = await Promise.all([
      processWebhookEvent("evt_vs_cancelled", { now }),
      runReconcilePayments({ now }),
    ]);
    expect(webhook).toBe("processed");
    expect(reconcile.cancelledErrors).toBe(0);

    const { order, eventTypes } = await orderState(a.orderId);
    expect(order.payments[0]?.status).toBe("CAPTURED");
    expect(eventTypes.filter((t) => t === "payment.captured")).toHaveLength(1);
    // Whoever took the lock first decided: revived by the webhook (P8) or
    // refunded by reconciliation. Never both, never neither.
    if (order.status === "CONFIRMED") {
      expect(order.refunds).toHaveLength(0);
      expect(await levels(a.variantId)).toEqual({
        stockOnHand: 4,
        reserved: 0,
      });
    } else {
      expect(order.status).toBe("CANCELLED");
      expect(order.refunds).toHaveLength(1);
      expect(await levels(a.variantId)).toEqual({
        stockOnHand: 5,
        reserved: 0,
      });
    }
    expect(
      await testDb.order.count({
        where: { cartId: a.cartId, status: { not: "CANCELLED" } },
      }),
    ).toBeLessThanOrEqual(1);
    await expectInventoryInStep();
  });
});

describe("the cancelled-order reconciliation window", () => {
  const hour = 60 * minute;
  const window = checkoutPolicy.payment.reconcileCancelledWithinHours;

  /** Minutes after cancellation at which each check falls due, from the policy. */
  function expectedCheckOffsets(): number[] {
    const offsets: number[] = [];
    let at = checkoutPolicy.payment.reconcileAfterMinutes;
    while (at < window * 60) {
      offsets.push(at);
      at += backoffMinutesFor(checkoutPolicy.jobs, offsets.length);
    }
    return offsets;
  }

  it("follows the backoff schedule across the whole window and then stops", async () => {
    const a = await placePendingOrder();
    await cancelPendingOrder({ kind: "user", userId: a.userId! }, a.orderId);
    const { cancelledAt } = await testDb.order.findUniqueOrThrow({
      where: { id: a.orderId },
      select: { cancelledAt: true },
    });
    if (!cancelledAt) throw new Error("not cancelled");
    const at = (minutes: number) =>
      new Date(cancelledAt.getTime() + minutes * minute);

    const offsets = expectedCheckOffsets();
    // Razorpay keeps polling a bank for three days: the schedule must reach it.
    expect(offsets.at(-1)! / 60).toBeGreaterThan(48);
    let previous = 0;
    for (const offset of offsets) {
      // Just before it is due: nothing.
      const before = at(previous + (offset - previous) / 2);
      expect(await runReconcilePayments({ now: before })).toMatchObject({
        cancelledExamined: 0,
      });
      expect(await runReconcilePayments({ now: at(offset) })).toMatchObject({
        cancelledExamined: 1,
        cancelledUnchanged: 1,
      });
      previous = offset;
    }
    expect(
      await testDb.orderEvent.count({
        where: { orderId: a.orderId, type: "payment.reconcile_checked" },
      }),
    ).toBe(offsets.length);

    // The window closes: no further query, however long we wait.
    expect(
      await runReconcilePayments({ now: at(window * 60 + 1) }),
    ).toMatchObject({ cancelledExamined: 0 });
    expect(
      await runReconcilePayments({ now: at(window * 60 * 2) }),
    ).toMatchObject({ cancelledExamined: 0 });
    expect(
      await testDb.orderEvent.count({
        where: { orderId: a.orderId, type: "payment.reconcile_checked" },
      }),
    ).toBe(offsets.length);
    expect((await orderState(a.orderId)).order.payments[0]?.status).toBe(
      "CREATED",
    );
  });

  it("still refunds a capture found a moment before the window closes, and ignores one just after", async () => {
    const inside = await placePendingOrder({ stock: 5 });
    await cancelPendingOrder(
      { kind: "user", userId: inside.userId! },
      inside.orderId,
    );
    const outside = await placePendingOrder({ stock: 5 });
    await cancelPendingOrder(
      { kind: "user", userId: outside.userId! },
      outside.orderId,
    );
    captureAtProvider(inside);
    captureAtProvider(outside);
    const now = new Date();
    await testDb.order.update({
      where: { id: inside.orderId },
      data: { cancelledAt: new Date(now.getTime() - window * hour + minute) },
    });
    await testDb.order.update({
      where: { id: outside.orderId },
      data: { cancelledAt: new Date(now.getTime() - window * hour - minute) },
    });

    expect(await runReconcilePayments({ now })).toMatchObject({
      cancelledExamined: 1,
      cancelledRefunded: 1,
    });
    expect((await orderState(inside.orderId)).order.refunds).toHaveLength(1);
    const left = (await orderState(outside.orderId)).order;
    expect(left.payments[0]?.status).toBe("CREATED");
    expect(left.refunds).toHaveLength(0);
    expect(
      await testDb.orderEvent.count({
        where: { orderId: outside.orderId, type: "payment.reconcile_checked" },
      }),
    ).toBe(0);
    await expectInventoryInStep();
  });
});
