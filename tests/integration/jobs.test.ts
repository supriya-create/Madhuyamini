import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { checkoutPolicy } from "@/config/checkout-policy";
import { GET as cronGet } from "@/app/api/cron/[job]/route";
import { cancelPendingOrder } from "@/features/orders/service";
import { applyCapture } from "@/features/payments/capture";
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
