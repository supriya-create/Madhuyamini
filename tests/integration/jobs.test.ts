import { inspect } from "node:util";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { checkoutPolicy } from "@/config/checkout-policy";
import { GET as cronGet } from "@/app/api/cron/[job]/route";
import { cancelPendingOrder } from "@/features/orders/service";
import { applyCapture } from "@/features/payments/capture";
import {
  expireOverdueOrder,
  expireOverdueOrderFor,
  reportExpiryFailure,
} from "@/features/payments/expiry";
import { ingestWebhook } from "@/features/payments/webhook";
import { db } from "@/server/db";
import type { EmailMessage } from "@/server/email/types";
import { runCleanup } from "@/server/jobs/cleanup";
import { runExpireReservations } from "@/server/jobs/expire-reservations";
import { runProcessWebhooks } from "@/server/jobs/process-webhooks";
import {
  runReconcilePayments,
  runRecoverPayments,
} from "@/server/jobs/reconcile-payments";
import { runRefundPayments } from "@/server/jobs/refund-payments";
import { runSendNotifications } from "@/server/jobs/send-notifications";
import * as outbox from "@/server/notifications/outbox";
import type { OrderAccess } from "@/server/orders/context";
import { getFakeGateway } from "@/server/payments";

import { createUser, resetDatabase, testDb } from "./db";
import { placeCodGuestOrder, placePendingOrder } from "./fixtures/orders";

/**
 * The scheduled jobs (docs/checkout.md §5.8): each is idempotent, claims
 * with leases, backs off, gives up loudly, and tolerates a second worker.
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

async function levels(variantId: string) {
  const row = await testDb.inventory.findUniqueOrThrow({
    where: { variantId },
  });
  return { stockOnHand: row.stockOnHand, reserved: row.reserved };
}

async function expireNow(orderId: string, now: Date) {
  await testDb.order.update({
    where: { id: orderId },
    data: { pendingExpiresAt: new Date(now.getTime() - minute) },
  });
}

describe("expire-reservations", () => {
  it("cancels overdue orders, releases stock, emails the customer, and is idempotent", async () => {
    const o = await placePendingOrder();
    const now = new Date();
    expect(await runExpireReservations({ now })).toMatchObject({ examined: 0 });
    await expireNow(o.orderId, now);

    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 1,
      cancelled: 1,
      confirmed: 0,
    });
    const order = await testDb.order.findUniqueOrThrow({
      where: { id: o.orderId },
      include: { reservations: true, events: true },
    });
    expect(order).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "PAYMENT_TIMEOUT",
    });
    expect(order.reservations[0]?.status).toBe("EXPIRED");
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 0 });
    expect(order.events.map((e) => e.type)).toContain("order.cancelled");
    const outbox = await testDb.notificationOutbox.findMany({
      where: { orderId: o.orderId },
    });
    expect(outbox.map((n) => n.kind)).toEqual(["order.cancelled"]);
    // The cart is untouched so the customer can try again.
    expect(
      (await testDb.cart.findUniqueOrThrow({ where: { id: o.cartId } })).status,
    ).toBe("ACTIVE");

    expect(await runExpireReservations({ now })).toMatchObject({ examined: 0 });
  });

  it("confirms instead of cancelling when the provider shows a capture we missed", async () => {
    const o = await placePendingOrder();
    gateway.simulatePayment(o.providerOrderId!, { status: "captured" });
    const now = new Date();
    await expireNow(o.orderId, now);
    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 1,
      confirmed: 1,
      cancelled: 0,
    });
    const order = await testDb.order.findUniqueOrThrow({
      where: { id: o.orderId },
    });
    expect(order.status).toBe("CONFIRMED");
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
  });

  it("cancels once when two sweeps overlap", async () => {
    const a = await placePendingOrder({ email: "a@example.com" });
    const b = await placePendingOrder({ email: "b@example.com" });
    const now = new Date();
    await expireNow(a.orderId, now);
    await expireNow(b.orderId, now);
    const [first, second] = await Promise.all([
      runExpireReservations({ now }),
      runExpireReservations({ now }),
    ]);
    expect((first.cancelled ?? 0) + (second.cancelled ?? 0)).toBe(2);
    expect(
      await testDb.orderEvent.count({ where: { type: "order.cancelled" } }),
    ).toBe(2);
    expect(await levels(a.variantId)).toEqual({ stockOnHand: 5, reserved: 0 });
  });
});

describe("recover-payments and reconcile-payments", () => {
  it("creates the provider order for a stale INITIATED attempt", async () => {
    gateway.failNext("createOrder", { retryable: true });
    const o = await placePendingOrder();
    expect(o.providerOrderId).toBeNull();
    const now = new Date();
    // Too fresh to touch.
    expect(await runRecoverPayments({ now })).toMatchObject({ examined: 0 });
    await testDb.payment.update({
      where: { id: o.attemptId },
      data: { updatedAt: new Date(now.getTime() - 10 * minute) },
    });
    expect(await runRecoverPayments({ now })).toMatchObject({
      examined: 1,
      created: 1,
    });
    const attempt = await testDb.payment.findUniqueOrThrow({
      where: { id: o.attemptId },
    });
    expect(attempt.status).toBe("CREATED");
    expect(attempt.providerOrderId).toMatch(/^order_fake/);
  });

  it("confirms an order whose capture reached neither the callback nor the webhook", async () => {
    const o = await placePendingOrder();
    gateway.simulatePayment(o.providerOrderId!, { status: "captured" });
    const now = new Date();
    expect(await runReconcilePayments({ now })).toMatchObject({ examined: 0 });
    await testDb.payment.update({
      where: { id: o.attemptId },
      data: { updatedAt: new Date(now.getTime() - 10 * minute) },
    });
    expect(await runReconcilePayments({ now })).toMatchObject({
      examined: 1,
      captured: 1,
    });
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status,
    ).toBe("CONFIRMED");
  });
});

describe("process-webhooks", () => {
  function captureBody(o: {
    providerOrderId: string | null;
    totalInPaise: number;
  }) {
    const { providerPaymentId } = gateway.simulatePayment(o.providerOrderId!, {
      status: "captured",
    });
    return JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: providerPaymentId,
            order_id: o.providerOrderId,
            amount: o.totalInPaise,
            currency: "INR",
            status: "captured",
          },
        },
      },
    });
  }

  it("applies stored deliveries and reclaims a lease a crashed worker left behind", async () => {
    const o = await placePendingOrder();
    const body = captureBody(o);
    const now = new Date();
    await ingestWebhook({
      rawBody: body,
      signature: gateway.signWebhook(body),
      eventId: "evt_job",
      now,
    });
    // Simulate a worker that claimed the row and died.
    await testDb.paymentWebhookEvent.update({
      where: { id: "evt_job" },
      data: { claimedAt: new Date(now.getTime() - minute), claimedBy: "dead" },
    });
    expect(await runProcessWebhooks({ now })).toMatchObject({ examined: 0 });
    const later = new Date(
      now.getTime() + (checkoutPolicy.jobs.leaseMinutes + 1) * minute,
    );
    expect(await runProcessWebhooks({ now: later })).toMatchObject({
      examined: 1,
      processed: 1,
    });
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status,
    ).toBe("CONFIRMED");
    expect(await runProcessWebhooks({ now: later })).toMatchObject({
      examined: 0,
    });
  });
});

describe("refund-payments", () => {
  async function refundIntent(options: { stock?: number } = {}) {
    const o = await placePendingOrder({ stock: options.stock ?? 1 });
    await cancelPendingOrder({ kind: "user", userId: o.userId! }, o.orderId);
    await testDb.inventory.update({
      where: { variantId: o.variantId },
      data: { stockOnHand: 0 },
    });
    const { providerPaymentId } = gateway.simulatePayment(o.providerOrderId!, {
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
    const refund = await testDb.refund.findFirstOrThrow({
      where: { orderId: o.orderId },
    });
    return {
      ...o,
      refundId: refund.id,
      providerPaymentId,
      reference: refund.reference,
    };
  }

  it("requests the refund, records the provider id and marks the payment refunded", async () => {
    const r = await refundIntent();
    const now = new Date();
    expect(await runRefundPayments({ now })).toMatchObject({ processed: 1 });
    const refund = await testDb.refund.findUniqueOrThrow({
      where: { id: r.refundId },
    });
    expect(refund).toMatchObject({ status: "PROCESSED", attempts: 1 });
    expect(refund.providerRefundId).toMatch(/^rfnd_fake/);
    expect(
      (await testDb.payment.findUniqueOrThrow({ where: { id: r.attemptId } }))
        .status,
    ).toBe("REFUNDED");
    expect(await gateway.listRefunds(r.providerPaymentId)).toHaveLength(1);
    expect(
      (await testDb.orderEvent.findMany({ where: { orderId: r.orderId } })).map(
        (e) => e.type,
      ),
    ).toContain("refund.processed");
    expect(await runRefundPayments({ now })).toMatchObject({
      processed: 0,
      requested: 0,
    });
  });

  it("retries a lost response and then finds the refund by reference instead of refunding twice", async () => {
    const r = await refundIntent();
    const now = new Date();
    gateway.failNext("createRefund", { retryable: true, afterEffect: true });
    expect(await runRefundPayments({ now })).toMatchObject({ retried: 1 });
    let refund = await testDb.refund.findUniqueOrThrow({
      where: { id: r.refundId },
    });
    expect(refund.status).toBe("INITIATED");
    expect(refund.attempts).toBe(1);
    expect(refund.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    expect(refund.lastError).toMatch(/createRefund failed/);

    const later = new Date(refund.nextAttemptAt.getTime() + minute);
    expect(await runRefundPayments({ now: later })).toMatchObject({
      processed: 1,
    });
    refund = await testDb.refund.findUniqueOrThrow({
      where: { id: r.refundId },
    });
    expect(refund.status).toBe("PROCESSED");
    expect(await gateway.listRefunds(r.providerPaymentId)).toHaveLength(1);
  });

  it("gives up on a rejection the provider will repeat, and alerts the owner", async () => {
    const r = await refundIntent();
    gateway.failNext("createRefund", { retryable: false });
    expect(await runRefundPayments({ now: new Date() })).toMatchObject({
      failed: 1,
    });
    const refund = await testDb.refund.findUniqueOrThrow({
      where: { id: r.refundId },
    });
    expect(refund.status).toBe("FAILED");
    const alerts = await testDb.notificationOutbox.findMany({
      where: { kind: "ops.alert", orderId: r.orderId },
    });
    expect(alerts.map((a) => a.dedupeKey)).toContain(
      `ops.alert:refund-failed:${r.reference}`,
    );
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: r.orderId } }))
        .status,
    ).toBe("NEEDS_REVIEW");
  });

  it("lets two workers share the queue without touching the same row", async () => {
    const first = await refundIntent();
    const second = await refundIntent();
    const now = new Date();
    const results = await Promise.all([
      runRefundPayments({ now, worker: "w1", limit: 1 }),
      runRefundPayments({ now, worker: "w2", limit: 1 }),
    ]);
    expect((results[0].processed ?? 0) + (results[1].processed ?? 0)).toBe(2);
    expect(await gateway.listRefunds(first.providerPaymentId)).toHaveLength(1);
    expect(await gateway.listRefunds(second.providerPaymentId)).toHaveLength(1);
  });
});

describe("send-notifications", () => {
  it("renders and sends queued emails once, with the dedupe key as idempotency key", async () => {
    const o = await placeCodGuestOrder();
    const sent: EmailMessage[] = [];
    const send = (message: EmailMessage) => {
      sent.push(message);
      return Promise.resolve();
    };
    const now = new Date();
    expect(await runSendNotifications({ now, send })).toMatchObject({
      claimed: 2,
      sent: 2,
    });
    expect(sent.map((m) => m.to).sort()).toEqual([
      o.email,
      "owner@example.com",
    ]);
    const confirmation = sent.find((m) => m.to === o.email)!;
    expect(confirmation.subject).toContain(o.orderNumber);
    expect(confirmation.text).toContain("₹1,098");
    expect(confirmation.text).toContain("12 Station Road");
    expect(confirmation.text).toContain("pay on delivery");
    expect(confirmation.idempotencyKey).toBe(`order.confirmed:${o.orderId}`);
    const owner = sent.find((m) => m.to === "owner@example.com")!;
    expect(owner.subject).toMatch(/New order MY-/);
    expect(owner.text).toContain(o.email);

    const rows = await testDb.notificationOutbox.findMany();
    expect(rows.every((r) => r.status === "SENT" && r.claimedAt === null)).toBe(
      true,
    );
    expect(await runSendNotifications({ now, send })).toMatchObject({
      claimed: 0,
    });
  });

  it("backs off on failure, gives up after the policy's attempts, and raises one alert", async () => {
    const o = await placeCodGuestOrder();
    const failing = () => Promise.reject(new Error("smtp down"));
    const now = new Date();
    expect(await runSendNotifications({ now, send: failing })).toMatchObject({
      claimed: 2,
      retried: 2,
    });
    const row = await testDb.notificationOutbox.findFirstOrThrow({
      where: { kind: "order.confirmed", orderId: o.orderId },
    });
    expect(row).toMatchObject({
      status: "PENDING",
      attempts: 1,
      claimedAt: null,
    });
    expect(row.lastError).toContain("smtp down");
    expect(row.nextAttemptAt.getTime()).toBe(
      now.getTime() + (checkoutPolicy.jobs.backoffMinutes[0] ?? 0) * minute,
    );
    // Not due yet.
    expect(await runSendNotifications({ now, send: failing })).toMatchObject({
      claimed: 0,
    });

    await testDb.notificationOutbox.updateMany({
      data: {
        attempts: checkoutPolicy.jobs.maxAttempts - 1,
        nextAttemptAt: now,
      },
    });
    expect(await runSendNotifications({ now, send: failing })).toMatchObject({
      failed: 2,
    });
    const after = await testDb.notificationOutbox.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(after.filter((r) => r.status === "FAILED")).toHaveLength(2);
    const alerts = after.filter((r) => r.kind === "ops.alert");
    expect(alerts).toHaveLength(2);
    expect(alerts.every((a) => a.recipient === "owner@example.com")).toBe(true);

    // A failing alert does not spawn another alert.
    await testDb.notificationOutbox.updateMany({
      where: { kind: "ops.alert" },
      data: {
        attempts: checkoutPolicy.jobs.maxAttempts - 1,
        nextAttemptAt: now,
      },
    });
    expect(await runSendNotifications({ now, send: failing })).toMatchObject({
      failed: 2,
    });
    expect(
      await testDb.notificationOutbox.count({ where: { kind: "ops.alert" } }),
    ).toBe(2);
  });

  it("honours leases and the single-row fast path", async () => {
    const o = await placeCodGuestOrder();
    const now = new Date();
    const row = await testDb.notificationOutbox.findFirstOrThrow({
      where: { kind: "order.confirmed", orderId: o.orderId },
    });
    await testDb.notificationOutbox.update({
      where: { id: row.id },
      data: { claimedAt: new Date(now.getTime() - minute), claimedBy: "busy" },
    });
    const sent: string[] = [];
    const send = (m: EmailMessage) => {
      sent.push(m.to);
      return Promise.resolve();
    };
    expect(
      await runSendNotifications({ now, send, onlyId: row.id }),
    ).toMatchObject({ claimed: 0 });
    expect(await runSendNotifications({ now, send })).toMatchObject({
      claimed: 1,
    });
    expect(sent).toEqual(["owner@example.com"]);

    const later = new Date(
      now.getTime() + (checkoutPolicy.jobs.leaseMinutes + 1) * minute,
    );
    expect(
      await runSendNotifications({ now: later, send, onlyId: row.id }),
    ).toMatchObject({ claimed: 1, sent: 1 });
    expect(sent).toEqual(["owner@example.com", o.email]);
  });
});

describe("cleanup", () => {
  it("removes expired and revoked access tokens, sessions and verifications", async () => {
    const o = await placeCodGuestOrder();
    const now = new Date();
    await testDb.orderAccessToken.create({
      data: {
        orderId: o.orderId,
        tokenHash: "expired-token-hash",
        expiresAt: new Date(now.getTime() - minute),
        createdAt: new Date(now.getTime() - 2 * minute),
      },
    });
    await testDb.orderAccessToken.create({
      data: {
        orderId: o.orderId,
        tokenHash: "revoked-token-hash",
        expiresAt: new Date(now.getTime() + minute),
        revokedAt: now,
      },
    });
    const user = await createUser("sessions@example.com");
    await testDb.session.createMany({
      data: [
        {
          userId: user.id,
          token: "live",
          expiresAt: new Date(now.getTime() + minute),
        },
        {
          userId: user.id,
          token: "dead",
          expiresAt: new Date(now.getTime() - minute),
        },
      ],
    });
    await testDb.verification.create({
      data: {
        identifier: "x",
        value: "y",
        expiresAt: new Date(now.getTime() - minute),
      },
    });

    const summary = await runCleanup({ now });
    expect(summary).toMatchObject({
      accessTokens: 2,
      sessions: 1,
      verifications: 1,
    });
    expect(await testDb.orderAccessToken.count()).toBe(1);
    expect(await testDb.session.count()).toBe(1);
  });
});

describe("cron route", () => {
  const call = (job: string, authorization?: string) =>
    cronGet(
      new Request(`http://localhost/api/cron/${job}`, {
        headers: authorization ? { authorization } : {},
      }),
      { params: Promise.resolve({ job }) },
    );

  it("requires the bearer secret and knows its jobs", async () => {
    expect((await call("cleanup")).status).toBe(401);
    expect(
      (await call("cleanup", "Bearer wrong-secret-value-here")).status,
    ).toBe(401);
    expect(
      (await call("nonsense", "Bearer integration-cron-secret-value")).status,
    ).toBe(404);
    const ok = await call("cleanup", "Bearer integration-cron-secret-value");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as Record<string, unknown>;
    expect(body.job).toBe("cleanup");
    expect(typeof body.durationMs).toBe("number");
  });
});

/** The signed-in owner of a fixture order. */
function ownerOf(o: { userId: string | null }): OrderAccess {
  if (!o.userId) throw new Error("fixture order has no user");
  return { kind: "user", userId: o.userId };
}

/** Counters out of step with the holds: releasing them fails inside T8. */
async function poison(variantId: string) {
  await testDb.inventory.update({
    where: { variantId },
    data: { reserved: 0 },
  });
}

function omit<T extends object, K extends keyof T & string>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  const excluded: readonly string[] = keys;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.includes(key)),
  ) as Omit<T, K>;
}

/** Copies one overdue order `count` times (no cart, no attempt), holds included. */
async function cloneOverdueOrders(
  base: { orderId: string; variantId: string },
  count: number,
  now: Date,
) {
  const order = await testDb.order.findUniqueOrThrow({
    where: { id: base.orderId },
    include: { items: true },
  });
  const fields = omit(order, [
    "id",
    "orderNumber",
    "createdAt",
    "cartId",
    "items",
  ]);
  const overdue = new Date(now.getTime() - minute);
  for (let i = 0; i < count; i += 1) {
    await testDb.order.create({
      data: {
        ...fields,
        orderNumber: `MY-CLONE${String(i).padStart(3, "0")}`,
        cartId: null,
        pendingExpiresAt: overdue,
        items: {
          create: order.items.map((item) => omit(item, ["id", "orderId"])),
        },
        reservations: {
          create: [
            { variantId: base.variantId, quantity: 1, expiresAt: overdue },
          ],
        },
      },
    });
  }
  await testDb.inventory.update({
    where: { variantId: base.variantId },
    data: {
      stockOnHand: { increment: count },
      reserved: { increment: count },
    },
  });
}

describe("expire-reservations resilience (audit batch 4, B-23)", () => {
  it("sets a failing order aside, alerts once, and still expires the orders behind it", async () => {
    const poisoned = await placePendingOrder({ email: "p@example.com" });
    const later = await placePendingOrder({ email: "l@example.com" });
    const now = new Date();
    await testDb.order.update({
      where: { id: poisoned.orderId },
      data: { pendingExpiresAt: new Date(now.getTime() - 2 * minute) },
    });
    await expireNow(later.orderId, now);
    await poison(poisoned.variantId);

    const first = await runExpireReservations({ now });
    expect(first).toMatchObject({ examined: 2, cancelled: 1, errors: 1 });
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: later.orderId } }))
        .status,
    ).toBe("CANCELLED");
    expect(
      (
        await testDb.order.findUniqueOrThrow({
          where: { id: poisoned.orderId },
        })
      ).status,
    ).toBe("PENDING_PAYMENT");
    const alerts = await testDb.notificationOutbox.findMany({
      where: { kind: "ops.alert", orderId: poisoned.orderId },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.dedupeKey).toMatch(/^ops\.alert:expire-failed:/);
    expect(alerts[0]?.payload).toMatchObject({
      orderNumber: poisoned.orderNumber,
      lastError: expect.stringContaining("out of step") as unknown,
    });

    // The next invocation tries again; the alert is one per order and day.
    const second = await runExpireReservations({ now });
    expect(second).toMatchObject({ examined: 1, errors: 1, cancelled: 0 });
    expect(
      await testDb.notificationOutbox.count({ where: { kind: "ops.alert" } }),
    ).toBe(1);

    // Once the counters are repaired it expires like any other.
    await testDb.inventory.update({
      where: { variantId: poisoned.variantId },
      data: { reserved: 1 },
    });
    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 1,
      cancelled: 1,
      errors: 0,
    });
    expect(await levels(poisoned.variantId)).toMatchObject({ reserved: 0 });
  });

  it("drains more than one batch, and leaves everything for the next run when the budget is spent", async () => {
    const base = await placePendingOrder();
    const now = new Date();
    await expireNow(base.orderId, now);
    await cloneOverdueOrders(base, 52, now);
    const pending = () =>
      testDb.order.count({ where: { status: "PENDING_PAYMENT" } });
    expect(await pending()).toBe(53);

    // No budget left: nothing is touched; the batch is reported as deferred.
    expect(await runExpireReservations({ now, budgetMs: 0 })).toMatchObject({
      examined: 0,
      cancelled: 0,
      deferred: 50,
    });
    expect(await pending()).toBe(53);
    expect(await levels(base.variantId)).toMatchObject({ reserved: 53 });

    // A normal run drains the first batch of 50 and then the remaining 3.
    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 53,
      cancelled: 53,
      errors: 0,
      deferred: 0,
    });
    expect(await pending()).toBe(0);
    expect(await levels(base.variantId)).toMatchObject({ reserved: 0 });
    expect(
      await testDb.orderEvent.count({ where: { type: "order.cancelled" } }),
    ).toBe(53);
  });

  it("never releases stock while the provider cannot be asked", async () => {
    const o = await placePendingOrder();
    const now = new Date();
    await expireNow(o.orderId, now);

    gateway.failNext("fetchOrderPayments", { retryable: true });
    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 1,
      unverified: 1,
      cancelled: 0,
      errors: 0,
    });
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status,
    ).toBe("PENDING_PAYMENT");
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 1 });
    expect(
      await testDb.orderEvent.count({ where: { type: "order.cancelled" } }),
    ).toBe(0);
    expect(await testDb.notificationOutbox.count()).toBe(0);

    // Reachable again: the same order expires normally.
    expect(await runExpireReservations({ now })).toMatchObject({
      cancelled: 1,
    });
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 0 });
  });

  it("counts and alerts an internal failure while applying a capture the provider reported, never as 'unverified'", async () => {
    const broken = await placePendingOrder({ email: "b@example.com" });
    const healthy = await placePendingOrder({ email: "h@example.com" });
    if (!broken.providerOrderId)
      throw new Error("fixture has no provider order");
    const now = new Date();
    await testDb.order.update({
      where: { id: broken.orderId },
      data: { pendingExpiresAt: new Date(now.getTime() - 2 * minute) },
    });
    await expireNow(healthy.orderId, now);
    // The provider holds a capture; applying it fails in our own database.
    gateway.simulatePayment(broken.providerOrderId, { status: "captured" });
    await poison(broken.variantId);
    const brokenOrder = () =>
      testDb.order.findUniqueOrThrow({
        where: { id: broken.orderId },
        include: { payments: true, reservations: true },
      });

    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 2,
      errors: 1,
      unverified: 0,
      confirmed: 0,
      cancelled: 1,
    });
    // Nothing moved for the failing order: pending, its hold active, the
    // capture not half-applied, no stock gone.
    const after = await brokenOrder();
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.payments.map((payment) => payment.status)).toEqual([
      "CREATED",
    ]);
    expect(after.reservations.map((hold) => hold.status)).toEqual(["ACTIVE"]);
    expect((await levels(broken.variantId)).stockOnHand).toBe(5);
    // The order behind it was still processed.
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: healthy.orderId } }))
        .status,
    ).toBe("CANCELLED");
    // The failure is on record.
    const alerts = await testDb.notificationOutbox.findMany({
      where: { kind: "ops.alert", orderId: broken.orderId },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.dedupeKey).toBe(
      `ops.alert:expire-failed:${broken.orderId}:${now.toISOString().slice(0, 10)}`,
    );
    expect(alerts[0]?.payload).toMatchObject({
      orderNumber: broken.orderNumber,
      lastError: expect.stringContaining("out of step") as unknown,
    });

    // Still failing a day later: a fresh alert, so it cannot stay out of sight.
    const tomorrow = new Date(now.getTime() + 24 * 60 * minute);
    expect(await runExpireReservations({ now: tomorrow })).toMatchObject({
      examined: 1,
      errors: 1,
      unverified: 0,
    });
    expect(
      await testDb.notificationOutbox.count({
        where: { kind: "ops.alert", orderId: broken.orderId },
      }),
    ).toBe(2);

    // Repaired: the capture is applied and the order confirmed, never cancelled.
    await testDb.inventory.update({
      where: { variantId: broken.variantId },
      data: { reserved: 1 },
    });
    expect(await runExpireReservations({ now: tomorrow })).toMatchObject({
      examined: 1,
      confirmed: 1,
      errors: 0,
    });
    expect((await brokenOrder()).status).toBe("CONFIRMED");
    expect(await levels(broken.variantId)).toEqual({
      stockOnHand: 4,
      reserved: 0,
    });
  });

  it("keeps going past a provider timeout, a failed capture application and a failed cancellation in one run", async () => {
    const timedOut = await placePendingOrder({ email: "t@example.com" });
    const capture = await placePendingOrder({ email: "c@example.com" });
    const cancel = await placePendingOrder({ email: "x@example.com" });
    const healthy = await placePendingOrder({ email: "h@example.com" });
    if (!capture.providerOrderId)
      throw new Error("fixture has no provider order");
    const now = new Date();
    // Oldest first: the sweep meets them in this order.
    for (const [index, o] of [timedOut, capture, cancel, healthy].entries()) {
      await testDb.order.update({
        where: { id: o.orderId },
        data: {
          pendingExpiresAt: new Date(now.getTime() - (10 - index) * minute),
        },
      });
    }
    // 1: the provider does not answer. 2: it reports a capture we cannot
    // apply. 3: it reports nothing and releasing the holds fails inside T8.
    gateway.failNext("fetchOrderPayments", { retryable: true });
    gateway.simulatePayment(capture.providerOrderId, { status: "captured" });
    await poison(capture.variantId);
    await poison(cancel.variantId);
    const status = async (orderId: string) =>
      (await testDb.order.findUniqueOrThrow({ where: { id: orderId } })).status;
    const alerted = async () =>
      (
        await testDb.notificationOutbox.findMany({
          where: { kind: "ops.alert" },
          select: { orderId: true },
        })
      )
        .map((alert) => alert.orderId)
        .sort();

    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 4,
      unverified: 1,
      errors: 2,
      cancelled: 1,
      confirmed: 0,
      skipped: 0,
    });
    expect(await status(timedOut.orderId)).toBe("PENDING_PAYMENT");
    expect(await status(capture.orderId)).toBe("PENDING_PAYMENT");
    expect(await status(cancel.orderId)).toBe("PENDING_PAYMENT");
    expect(await status(healthy.orderId)).toBe("CANCELLED");
    // No stock left any of the three unsettled orders.
    expect(
      await testDb.inventoryReservation.count({ where: { status: "ACTIVE" } }),
    ).toBe(3);
    expect(await levels(timedOut.variantId)).toEqual({
      stockOnHand: 5,
      reserved: 1,
    });
    expect((await levels(capture.variantId)).stockOnHand).toBe(5);
    expect((await levels(cancel.variantId)).stockOnHand).toBe(5);
    // Alerts for the two internal failures only: an outage is not one.
    expect(await alerted()).toEqual([capture.orderId, cancel.orderId].sort());

    // The provider answers again: the first order expires normally, and the
    // two failures are counted again without a second alert that day.
    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 3,
      cancelled: 1,
      errors: 2,
      unverified: 0,
    });
    expect(await status(timedOut.orderId)).toBe("CANCELLED");
    expect(await alerted()).toHaveLength(2);
  });

  it("logs, counts and carries on when the failure alert itself cannot be written", async () => {
    const poisoned = await placePendingOrder({ email: "p@example.com" });
    const later = await placePendingOrder({ email: "l@example.com" });
    const now = new Date();
    await testDb.order.update({
      where: { id: poisoned.orderId },
      data: { pendingExpiresAt: new Date(now.getTime() - 2 * minute) },
    });
    await expireNow(later.orderId, now);
    await poison(poisoned.variantId);

    // Not real credentials: the message only has to look like it carries some.
    const refused = vi
      .spyOn(outbox, "enqueueOpsAlert")
      .mockRejectedValue(
        new Error(
          "insert refused for p@example.com\n  via postgresql://app:not-a-real-password@db.internal:5432/shop api_key=sk_test_NOTAREALKEY000",
        ),
      );
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      // The error is counted even though it could not be alerted, and the
      // order behind it is still processed.
      expect(await runExpireReservations({ now })).toMatchObject({
        examined: 2,
        errors: 1,
        cancelled: 1,
      });
      expect(refused).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledTimes(1);
      // Allowlisted fields only: where to look, and what kind of failure.
      expect(logged).toHaveBeenCalledWith(
        "[expiry] failure alert not recorded",
        {
          orderId: poisoned.orderId,
          alertKey: `expire-failed:${poisoned.orderId}:${now.toISOString().slice(0, 10)}`,
          message:
            "An overdue order could not be expired, and the operations alert for it could not be written. Its stock holds are still active.",
          failure: { errorClass: "AppError", code: "INVENTORY_INCONSISTENT" },
          alertFailure: { errorClass: "Error" },
        },
      );
      // Neither exception's own words reach the log.
      const written = JSON.stringify(logged.mock.calls);
      for (const leaked of [
        "p@example.com",
        "not-a-real-password",
        "postgresql://",
        "db.internal",
        "sk_test_NOTAREALKEY000",
        "insert refused",
        "out of step",
      ]) {
        expect(written).not.toContain(leaked);
      }
    } finally {
      refused.mockRestore();
      logged.mockRestore();
    }
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: later.orderId } }))
        .status,
    ).toBe("CANCELLED");
    expect(
      (
        await testDb.order.findUniqueOrThrow({
          where: { id: poisoned.orderId },
        })
      ).status,
    ).toBe("PENDING_PAYMENT");
    expect(
      await testDb.notificationOutbox.count({ where: { kind: "ops.alert" } }),
    ).toBe(0);
  });

  it("never lets an exception's own text into the log: no credential, email address or connection string", async () => {
    const o = await placePendingOrder({ email: "asha.devi@example.com" });
    const now = new Date();
    // Fake values throughout; they only have to look like the real thing.
    const email = "asha.devi@example.com";
    const password = "not-a-real-password";
    const host = "db.internal";
    const connection = `postgresql://app:${password}@${host}:5432/shop`;
    const apiKey = "sk_test_NOTAREALKEY000";
    const keyId = "rzp_test_NOTAREALKEY000";
    const paymentId = "pay_NotARealPayment1";
    const text = `could not connect to ${connection} as ${email} with api_key=${apiKey} key_id=${keyId} payload={"id":"${paymentId}","email":"${email}"}`;
    // The message, the cause, and even the name and the code carry it: none
    // of them may come out.
    const failure = Object.assign(new Error(text, { cause: new Error(text) }), {
      name: email,
      code: connection,
    });
    const alertFailure = Object.assign(new Error(text), { code: "P2002" });
    class ReportedError extends Error {
      override readonly name = "ReportedError";
      readonly code = 23514;
    }

    const refused = vi
      .spyOn(outbox, "enqueueOpsAlert")
      .mockRejectedValue(alertFailure);
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await reportExpiryFailure(o.orderId, failure, now);
      await reportExpiryFailure(o.orderId, new ReportedError(text), now);
      // Something thrown that is not an Error at all.
      await reportExpiryFailure(o.orderId, text, now);

      const alertKey = `expire-failed:${o.orderId}:${now.toISOString().slice(0, 10)}`;
      const message =
        "An overdue order could not be expired, and the operations alert for it could not be written. Its stock holds are still active.";
      const label = "[expiry] failure alert not recorded";
      const alertFailureLogged = { errorClass: "Error", code: "P2002" };
      expect(logged.mock.calls).toEqual([
        [
          label,
          {
            orderId: o.orderId,
            alertKey,
            message,
            // A name and a code that are not shaped like one are not trusted.
            failure: { errorClass: "Error" },
            alertFailure: alertFailureLogged,
          },
        ],
        [
          label,
          {
            orderId: o.orderId,
            alertKey,
            message,
            failure: { errorClass: "ReportedError", code: "23514" },
            alertFailure: alertFailureLogged,
          },
        ],
        [
          label,
          {
            orderId: o.orderId,
            alertKey,
            message,
            failure: { errorClass: "Unknown" },
            alertFailure: alertFailureLogged,
          },
        ],
      ]);
      const written = JSON.stringify(logged.mock.calls);
      for (const leaked of [
        email,
        password,
        host,
        connection,
        "postgresql://",
        apiKey,
        keyId,
        paymentId,
        "could not connect",
      ]) {
        expect(written).not.toContain(leaked);
      }
    } finally {
      refused.mockRestore();
      logged.mockRestore();
    }
  });

  it("never logs an error name that is not a string, even when its toString() looks like a class name", async () => {
    const o = await placePendingOrder({ email: "name.object@example.com" });
    const now = new Date();
    // Fake values throughout; they only have to look like the real thing.
    const password = "not-a-real-password";
    const connection = `postgresql://app:${password}@db.internal:5432/shop`;
    const customer = "asha.devi@example.com";
    const apiKey = "sk_test_NOTAREALKEY000";
    // Each name is an object that passes for an identifier when it is turned
    // into a string, and carries data that must never be written out.
    const failure = Object.assign(new Error("expiry failed"), {
      name: {
        toString: () => "SafeLookingError",
        password,
        connection,
        customer,
      },
    });
    const alertFailure = Object.assign(new Error("alert refused"), {
      name: { toString: () => "AlsoSafeLooking", apiKey },
      code: "P2002",
    });

    const refused = vi
      .spyOn(outbox, "enqueueOpsAlert")
      .mockRejectedValue(alertFailure);
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await reportExpiryFailure(o.orderId, failure, now);

      // The class falls back to the fixed value; the code, a real one, stays.
      expect(logged.mock.calls).toEqual([
        [
          "[expiry] failure alert not recorded",
          {
            orderId: o.orderId,
            alertKey: `expire-failed:${o.orderId}:${now.toISOString().slice(0, 10)}`,
            message:
              "An overdue order could not be expired, and the operations alert for it could not be written. Its stock holds are still active.",
            failure: { errorClass: "Error" },
            alertFailure: { errorClass: "Error", code: "P2002" },
          },
        ],
      ]);
      // Nothing of either object reaches the log, however it is serialised.
      for (const written of [
        JSON.stringify(logged.mock.calls),
        inspect(logged.mock.calls, { depth: null, showHidden: true }),
      ]) {
        for (const leaked of [
          password,
          connection,
          "postgresql://",
          "db.internal",
          customer,
          apiKey,
          "SafeLookingError",
          "AlsoSafeLooking",
          "toString",
        ]) {
          expect(written).not.toContain(leaked);
        }
      }
    } finally {
      refused.mockRestore();
      logged.mockRestore();
    }
  });
});

describe("inline expiry (audit batch 4, B-23)", () => {
  it("settles the customer's own overdue order once, with a concurrent sweep as a no-op", async () => {
    const o = await placePendingOrder();
    const now = new Date();
    await expireNow(o.orderId, now);
    const access = ownerOf(o);

    const [inline, sweep] = await Promise.all([
      expireOverdueOrderFor(access, o.orderId, now),
      runExpireReservations({ now }),
    ]);
    const byInline = inline.kind === "cancelled" ? 1 : 0;
    expect(byInline + (sweep.cancelled ?? 0)).toBe(1);
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status,
    ).toBe("CANCELLED");
    expect(
      await testDb.orderEvent.count({ where: { type: "order.cancelled" } }),
    ).toBe(1);
    expect(
      await testDb.notificationOutbox.count({
        where: { kind: "order.cancelled" },
      }),
    ).toBe(1);
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 0 });
    expect(
      await testDb.inventoryReservation.count({ where: { status: "EXPIRED" } }),
    ).toBe(1);

    // Settled: every later caller is a no-op.
    expect(await expireOverdueOrderFor(access, o.orderId, now)).toEqual({
      kind: "skipped",
    });
    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 0,
    });
  });

  it("acts only on overdue orders the caller can see", async () => {
    const o = await placePendingOrder();
    const owner = ownerOf(o);
    const pending = async () =>
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status;

    // Not overdue yet: nothing happens, whoever asks.
    expect(await expireOverdueOrderFor(owner, o.orderId, new Date())).toEqual({
      kind: "skipped",
    });
    expect(await pending()).toBe("PENDING_PAYMENT");

    const now = new Date();
    await expireNow(o.orderId, now);
    for (const stranger of [
      { kind: "user" as const, userId: "01a1daf7-ca9c-737b-ac7e-b2054dd50aa4" },
      { kind: "guest" as const, tokenHash: "f".repeat(64) },
      { kind: "anonymous" as const },
    ]) {
      expect(await expireOverdueOrderFor(stranger, o.orderId, now)).toEqual({
        kind: "skipped",
      });
    }
    expect(await pending()).toBe("PENDING_PAYMENT");
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 1 });

    expect(await expireOverdueOrderFor(owner, o.orderId, now)).toEqual({
      kind: "cancelled",
      released: 1,
    });
    expect(await pending()).toBe("CANCELLED");
  });

  it("confirms instead of cancelling when the provider holds a capture nobody reported", async () => {
    const o = await placePendingOrder();
    const now = new Date();
    await expireNow(o.orderId, now);
    if (!o.providerOrderId) throw new Error("fixture has no provider order");
    gateway.simulatePayment(o.providerOrderId, { status: "captured" });

    expect(await expireOverdueOrder(o.orderId, now)).toEqual({
      kind: "confirmed",
      capture: "confirmed",
    });
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status,
    ).toBe("CONFIRMED");
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 4, reserved: 0 });
  });

  it("defers while the provider cannot be asked", async () => {
    const o = await placePendingOrder();
    const now = new Date();
    await expireNow(o.orderId, now);
    gateway.failNext("fetchOrderPayments", { retryable: true });
    expect(await expireOverdueOrder(o.orderId, now)).toEqual({
      kind: "unverified",
    });
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status,
    ).toBe("PENDING_PAYMENT");
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 1 });
  });

  it("reports an internal failure and tells the customer's page 'failed', with the stock still held", async () => {
    const o = await placePendingOrder();
    const now = new Date();
    await expireNow(o.orderId, now);
    await poison(o.variantId);

    // The unit itself throws: an internal error is never an outcome.
    await expect(expireOverdueOrder(o.orderId, now)).rejects.toThrow(
      "out of step",
    );
    // The customer's entry reports it and lets the page render.
    expect(await expireOverdueOrderFor(ownerOf(o), o.orderId, now)).toEqual({
      kind: "failed",
    });
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status,
    ).toBe("PENDING_PAYMENT");
    expect(
      await testDb.inventoryReservation.count({ where: { status: "ACTIVE" } }),
    ).toBe(1);
    const alerts = await testDb.notificationOutbox.findMany({
      where: { kind: "ops.alert", orderId: o.orderId },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.dedupeKey).toMatch(/^ops\.alert:expire-failed:/);
  });

  it("treats an outage on the customer's path as 'unverified', with no alert", async () => {
    const o = await placePendingOrder();
    const now = new Date();
    await expireNow(o.orderId, now);
    gateway.failNext("fetchOrderPayments", { retryable: true });
    expect(await expireOverdueOrderFor(ownerOf(o), o.orderId, now)).toEqual({
      kind: "unverified",
    });
    expect(await levels(o.variantId)).toEqual({ stockOnHand: 5, reserved: 1 });
    expect(
      await testDb.notificationOutbox.count({ where: { kind: "ops.alert" } }),
    ).toBe(0);
  });
});
