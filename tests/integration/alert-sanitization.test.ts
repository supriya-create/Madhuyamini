import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { checkoutPolicy } from "@/config/checkout-policy";
import * as inventory from "@/features/inventory/service";
import { cancelPendingOrder } from "@/features/orders/service";
import * as capture from "@/features/payments/capture";
import {
  ingestWebhook,
  processWebhookEvent,
} from "@/features/payments/webhook";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { runExpireReservations } from "@/server/jobs/expire-reservations";
import { decideRetry } from "@/server/jobs/queue";
import { runRefundPayments } from "@/server/jobs/refund-payments";
import { runSendNotifications } from "@/server/jobs/send-notifications";
import * as notifications from "@/server/notifications/service";
import { getFakeGateway } from "@/server/payments";
import { PaymentGatewayError } from "@/server/payments/gateway";
import { describeFailure } from "@/server/safe-failure";

import { resetDatabase, testDb } from "./db";
import { placeCodGuestOrder, placePendingOrder } from "./fixtures/orders";

/**
 * The four producers that record an exception (reservation expiry, payment
 * webhooks, refunds, notification emails) are each made to fail with an
 * exception that carries everything an exception can: a key, a customer's
 * contact details, SQL, a file path, a stack, markup, a cause and metadata.
 * Whatever they then persist (alert payloads, `last_error` columns, event
 * notes) must hold a code and its fixed sentence, and none of that text.
 * Retry scheduling, give-up and state are checked to be what they were, and
 * to follow from the original error rather than from how it is described.
 * All values are synthetic.
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

const UNSAFE = {
  apiKey: "rzp_test_NOTAREALKEY000",
  secret: "sk_test_NOTAREALSECRET000",
  bearer: "Bearer eyFAKE.TOKEN.VALUE",
  email: "leak.victim@example.com",
  phone: "+919812345678",
  sql: 'INSERT INTO "users" ("email","phone") VALUES ($1,$2)',
  constraint: "users_email_key",
  path: "/var/task/src/features/payments/internal-file.ts:42:7",
  script: '<script>alert("x")</script>',
  connection: "postgresql://app:not-a-real-password@db.internal:5432/shop",
} as const;
const EVERYTHING = Object.values(UNSAFE).join(" | ");
const FORBIDDEN = [
  ...Object.values(UNSAFE),
  "NOTAREAL",
  "leak.victim",
  "9812345678",
  "not-a-real-password",
  "db.internal",
  "internal-file",
  "alert(",
  "INSERT INTO",
];

/** Loads an error with a stack, a cause, metadata and a `toString` that all carry the text. */
function hostile<T extends Error>(error: T): T {
  error.stack = `${error.name}: boom\n    at secretFunction (${UNSAFE.path})`;
  Object.defineProperty(error, "cause", {
    value: new Error(EVERYTHING, { cause: { token: UNSAFE.secret } }),
  });
  return Object.assign(error, {
    meta: { detail: `Failing row contains (${UNSAFE.email}, ${UNSAFE.phone})` },
    response: { status: 422, body: EVERYTHING },
    config: { headers: { Authorization: UNSAFE.bearer } },
    toString: () => EVERYTHING,
  });
}
const hostileError = () => hostile(new Error(EVERYTHING));
const hostileValidationError = () =>
  hostile(
    new Prisma.PrismaClientValidationError(
      `Invalid \`prisma.notificationOutbox.createMany()\` invocation:\n{ data: [{ recipient: "${UNSAFE.email}", payload: { phone: "${UNSAFE.phone}" } }] }`,
      { clientVersion: "test" },
    ),
  );

const UNKNOWN = "UNKNOWN_ERROR: An unexpected internal error occurred.";

/** Every row the four producers write to, as text. */
async function everythingPersisted(): Promise<string> {
  const [outbox, webhooks, refunds, events, payments] = await Promise.all([
    testDb.notificationOutbox.findMany(),
    testDb.paymentWebhookEvent.findMany(),
    testDb.refund.findMany(),
    testDb.orderEvent.findMany(),
    testDb.payment.findMany(),
  ]);
  return JSON.stringify({ outbox, webhooks, refunds, events, payments });
}

async function expectNothingUnsafePersisted(): Promise<void> {
  const persisted = await everythingPersisted();
  for (const forbidden of FORBIDDEN) {
    expect(persisted).not.toContain(forbidden);
  }
}

/** Every place a piece of text is persisted, as the path to each value that holds it. */
async function placesHolding(needle: string): Promise<string[]> {
  const persisted: unknown = JSON.parse(await everythingPersisted());
  const places: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (value.includes(needle)) places.push(path);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, `${path}[${index}]`);
      });
    } else if (typeof value === "object" && value !== null) {
      for (const [key, item] of Object.entries(value)) {
        const here = path === "" ? key : `${path}.${key}`;
        if (key.includes(needle)) places.push(`${here} (key)`);
        walk(item, here);
      }
    }
  };
  walk(persisted, "");
  return places.sort();
}

async function alerts() {
  return testDb.notificationOutbox.findMany({
    where: { kind: "ops.alert" },
    orderBy: { createdAt: "asc" },
  });
}

/** A pending order whose capture has been delivered as a signed webhook under `eventId`. */
async function deliverCapture(eventId: string, now: Date) {
  const o = await placePendingOrder();
  if (!o.providerOrderId) throw new Error("fixture has no provider order");
  const { providerPaymentId } = gateway.simulatePayment(o.providerOrderId, {
    status: "captured",
  });
  const body = JSON.stringify({
    entity: "event",
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
  expect(
    await ingestWebhook({
      rawBody: body,
      signature: gateway.signWebhook(body),
      eventId,
      now,
    }),
  ).toEqual({ status: "stored", eventId });
  return { ...o, providerOrderId: o.providerOrderId, providerPaymentId };
}

/** A captured payment on a cancelled order with no stock left: a refund is queued. */
async function refundIntent() {
  const o = await placePendingOrder({ stock: 1 });
  if (!o.userId || !o.providerOrderId) throw new Error("fixture incomplete");
  await cancelPendingOrder({ kind: "user", userId: o.userId }, o.orderId);
  await testDb.inventory.update({
    where: { variantId: o.variantId },
    data: { stockOnHand: 0 },
  });
  const { providerPaymentId } = gateway.simulatePayment(o.providerOrderId, {
    status: "captured",
  });
  expect(
    await capture.applyCapture({
      attemptId: o.attemptId,
      providerPaymentId,
      amountInPaise: o.totalInPaise,
      currency: "INR",
      actor: "WEBHOOK",
      signatureVerified: true,
      now: new Date(),
    }),
  ).toBe("refund_queued");
  const refund = await testDb.refund.findFirstOrThrow({
    where: { orderId: o.orderId },
  });
  return { ...o, refundId: refund.id, reference: refund.reference };
}

describe("reservation expiry", () => {
  async function overdue() {
    const o = await placePendingOrder();
    const now = new Date();
    await testDb.order.update({
      where: { id: o.orderId },
      data: { pendingExpiresAt: new Date(now.getTime() - minute) },
    });
    return { o, now };
  }

  it("records an unknown failure as the generic code, and nothing the exception carried", async () => {
    const { o, now } = await overdue();
    vi.spyOn(inventory, "releaseOrderHolds").mockRejectedValue(hostileError());

    expect(await runExpireReservations({ now })).toMatchObject({
      examined: 1,
      errors: 1,
      cancelled: 0,
    });
    const raised = await alerts();
    expect(raised).toHaveLength(1);
    expect(raised[0]?.dedupeKey).toBe(
      `ops.alert:expire-failed:${o.orderId}:${now.toISOString().slice(0, 10)}`,
    );
    expect(raised[0]?.payload).toEqual({
      reason:
        "An overdue order could not be expired; its stock holds are still active and need manual review",
      orderNumber: o.orderNumber,
      lastError: UNKNOWN,
      failure: {
        code: "UNKNOWN_ERROR",
        summary: "An unexpected internal error occurred.",
        source: "reservation-expiry",
        retryable: null,
        reference: `order:${o.orderId}`,
      },
    });
    await expectNothingUnsafePersisted();

    // The order and its stock are exactly where they were.
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status,
    ).toBe("PENDING_PAYMENT");
    expect(
      await testDb.inventoryReservation.count({ where: { status: "ACTIVE" } }),
    ).toBe(1);
    // Same day, same order: counted again, alerted once.
    expect(await runExpireReservations({ now })).toMatchObject({ errors: 1 });
    expect(await alerts()).toHaveLength(1);
  });

  it("records a database validation error by its kind, without the query it echoes", async () => {
    const { o, now } = await overdue();
    vi.spyOn(inventory, "releaseOrderHolds").mockRejectedValue(
      hostileValidationError(),
    );
    expect(await runExpireReservations({ now })).toMatchObject({ errors: 1 });
    const raised = await alerts();
    expect(raised).toHaveLength(1);
    // The whole payload, so a key that should not be there cannot go unseen.
    expect(raised[0]?.payload).toStrictEqual({
      reason:
        "An overdue order could not be expired; its stock holds are still active and need manual review",
      orderNumber: o.orderNumber,
      lastError:
        "DATABASE_INVALID_REQUEST: The application sent the database a request it could not accept.",
      failure: {
        code: "DATABASE_INVALID_REQUEST",
        summary:
          "The application sent the database a request it could not accept.",
        source: "reservation-expiry",
        retryable: false,
        reference: `order:${o.orderId}`,
      },
    });
    await expectNothingUnsafePersisted();
  });
});

describe("payment webhooks", () => {
  it("keeps only the code on the ledger row and in the alert, through every retry", async () => {
    let now = new Date();
    const o = await deliverCapture("evt_hostile", now);
    const { providerPaymentId } = o;
    vi.spyOn(capture, "applyCapture").mockRejectedValue(hostileError());

    const outcomes: string[] = [];
    for (let i = 0; i < checkoutPolicy.jobs.maxAttempts; i += 1) {
      outcomes.push(await processWebhookEvent("evt_hostile", { now }));
      const ledger = await testDb.paymentWebhookEvent.findUniqueOrThrow({
        where: { id: "evt_hostile" },
      });
      expect(ledger.lastError).toBe(UNKNOWN);
      expect(ledger.attempts).toBe(i + 1);
      now = new Date(now.getTime() + 2 * 24 * 60 * minute);
    }
    // Retried on schedule, then given up once: as before.
    expect(outcomes.slice(0, -1).every((o) => o === "retry_scheduled")).toBe(
      true,
    );
    expect(outcomes.at(-1)).toBe("failed");
    expect(
      await testDb.paymentWebhookEvent.findUniqueOrThrow({
        where: { id: "evt_hostile" },
      }),
    ).toMatchObject({
      status: "FAILED",
      attempts: checkoutPolicy.jobs.maxAttempts,
      lastError: UNKNOWN,
    });

    const raised = await alerts();
    expect(raised).toHaveLength(1);
    expect(raised[0]?.dedupeKey).toBe("ops.alert:webhook-failed:evt_hostile");
    // The whole payload, so a key that should not be there cannot go unseen.
    expect(raised[0]?.payload).toStrictEqual({
      reason: `Webhook payment.captured could not be applied after ${checkoutPolicy.jobs.maxAttempts} attempts; needs manual reconciliation`,
      eventId: "evt_hostile",
      eventType: "payment.captured",
      providerOrderId: o.providerOrderId,
      providerPaymentId,
      orderNumber: o.orderNumber,
      attempts: checkoutPolicy.jobs.maxAttempts,
      lastError: UNKNOWN,
      failure: {
        code: "UNKNOWN_ERROR",
        summary: "An unexpected internal error occurred.",
        source: "payment-webhook",
        retryable: null,
        reference: "webhook:evt_hostile",
      },
    });
    await expectNothingUnsafePersisted();
    // Nothing was applied.
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status,
    ).toBe("PENDING_PAYMENT");
    expect(await processWebhookEvent("evt_hostile", { now })).toBe("skipped");
    expect(await alerts()).toHaveLength(1);
  });

  it("an event id chosen by the sender is driven through the producer: it is not in the failure record, and is nowhere it was not already", async () => {
    // The id comes from a header the signature does not cover, so whoever
    // can send a signed body can put anything in it.
    const marker = "id.victim@example.net";
    const eventId = `evt <img src=x onerror=steal()> ${marker} "; DROP TABLE orders;--`;
    let now = new Date();
    const o = await deliverCapture(eventId, now);
    vi.spyOn(capture, "applyCapture").mockRejectedValue(hostileError());

    const outcomes: string[] = [];
    for (let i = 0; i < checkoutPolicy.jobs.maxAttempts; i += 1) {
      outcomes.push(await processWebhookEvent(eventId, { now }));
      expect(
        (
          await testDb.paymentWebhookEvent.findUniqueOrThrow({
            where: { id: eventId },
          })
        ).lastError,
      ).toBe(UNKNOWN);
      now = new Date(now.getTime() + 2 * 24 * 60 * minute);
    }
    expect(outcomes.slice(0, -1).every((o) => o === "retry_scheduled")).toBe(
      true,
    );
    expect(outcomes.at(-1)).toBe("failed");
    expect(
      await testDb.paymentWebhookEvent.findUniqueOrThrow({
        where: { id: eventId },
      }),
    ).toMatchObject({
      status: "FAILED",
      attempts: checkoutPolicy.jobs.maxAttempts,
      lastError: UNKNOWN,
    });

    const raised = await alerts();
    expect(raised).toHaveLength(1);
    expect(raised[0]?.payload).toStrictEqual({
      reason: `Webhook payment.captured could not be applied after ${checkoutPolicy.jobs.maxAttempts} attempts; needs manual reconciliation`,
      eventId,
      eventType: "payment.captured",
      providerOrderId: o.providerOrderId,
      providerPaymentId: o.providerPaymentId,
      orderNumber: o.orderNumber,
      attempts: checkoutPolicy.jobs.maxAttempts,
      lastError: UNKNOWN,
      failure: {
        code: "UNKNOWN_ERROR",
        summary: "An unexpected internal error occurred.",
        source: "payment-webhook",
        retryable: null,
        // Not shaped like an identifier, so not kept.
        reference: null,
      },
    });
    // What the exception carried is in none of the five tables.
    await expectNothingUnsafePersisted();

    // The id itself is stored in three places, all of which held it before
    // the failure record existed: it is the ledger row's key, part of the
    // alert's dedupe key, and the alert's `eventId`. Every row of every
    // table the producers write is searched, and there is no fourth.
    const stored = [
      "outbox[0].dedupeKey",
      "outbox[0].payload.eventId",
      "webhooks[0].id",
    ];
    for (const piece of [eventId, marker, "<img", "onerror", "DROP TABLE"]) {
      expect(await placesHolding(piece), piece).toEqual(stored);
    }
    expect(raised[0]?.dedupeKey).toBe(`ops.alert:webhook-failed:${eventId}`);
    // Still applied to nothing, and neither retried nor alerted again.
    expect(
      (await testDb.order.findUniqueOrThrow({ where: { id: o.orderId } }))
        .status,
    ).toBe("PENDING_PAYMENT");
    expect(await processWebhookEvent(eventId, { now })).toBe("skipped");
    expect(await alerts()).toHaveLength(1);
  });

  it("an event id shaped like an identifier is kept as the reference, and one that is not is dropped", () => {
    const referenceFor = (eventId: string) =>
      describeFailure(hostileError(), {
        source: "payment-webhook",
        reference: `webhook:${eventId}`,
      }).reference;
    expect(referenceFor("evt_Abc123")).toBe("webhook:evt_Abc123");
    expect(referenceFor("derived:payment.captured:pay_Abc123")).toBe(
      "webhook:derived:payment.captured:pay_Abc123",
    );
    expect(referenceFor(`evt ${UNSAFE.script}`)).toBeNull();
    expect(referenceFor(`evt_${"x".repeat(200)}`)).toBeNull();
    expect(referenceFor("evt_line\nbreak")).toBeNull();
  });
});

describe("refunds", () => {
  it("a rejection in the provider's own words is recorded as a code; it still gives up at once", async () => {
    const r = await refundIntent();
    vi.spyOn(gateway, "createRefund").mockRejectedValue(
      hostile(
        new PaymentGatewayError(
          `Razorpay rejected the request: ${EVERYTHING}`,
          {
            code: "PAYMENT_PROVIDER_REJECTED",
            retryable: false,
            cause: UNSAFE.script,
          },
        ),
      ),
    );
    expect(await runRefundPayments({ now: new Date() })).toMatchObject({
      failed: 1,
      retried: 0,
    });
    const rejected =
      "PAYMENT_PROVIDER_REJECTED: The payment provider refused the request.";
    expect(
      await testDb.refund.findUniqueOrThrow({ where: { id: r.refundId } }),
    ).toMatchObject({ status: "FAILED", lastError: rejected });
    expect(
      await testDb.orderEvent.findFirstOrThrow({
        where: { orderId: r.orderId, type: "refund.failed" },
      }),
    ).toMatchObject({ note: rejected });
    const raised = (await alerts()).filter((a) =>
      a.dedupeKey.startsWith("ops.alert:refund-failed:"),
    );
    expect(raised).toHaveLength(1);
    expect(raised[0]?.dedupeKey).toBe(`ops.alert:refund-failed:${r.reference}`);
    expect(raised[0]?.payload).toEqual({
      reason: "Refund could not be requested; needs a manual refund",
      orderNumber: r.orderNumber,
      reference: r.reference,
      amountInPaise: r.totalInPaise,
      lastError: rejected,
      failure: {
        code: "PAYMENT_PROVIDER_REJECTED",
        summary: "The payment provider refused the request.",
        source: "refund",
        retryable: false,
        reference: `refund:${r.reference}`,
      },
    });
    await expectNothingUnsafePersisted();
  });

  it("an unknown failure is retried on the same schedule, with only the generic code kept", async () => {
    const r = await refundIntent();
    const now = new Date();
    vi.spyOn(gateway, "createRefund").mockRejectedValue(hostileError());
    expect(await runRefundPayments({ now })).toMatchObject({
      retried: 1,
      failed: 0,
    });
    const refund = await testDb.refund.findUniqueOrThrow({
      where: { id: r.refundId },
    });
    expect(refund).toMatchObject({
      status: "INITIATED",
      attempts: 1,
      lastError: UNKNOWN,
    });
    expect(refund.nextAttemptAt.getTime()).toBe(
      now.getTime() + (checkoutPolicy.jobs.backoffMinutes[0] ?? 0) * minute,
    );
    expect(
      await testDb.orderEvent.findFirstOrThrow({
        where: { orderId: r.orderId, type: "refund.retry" },
      }),
    ).toMatchObject({ note: UNKNOWN });
    expect(
      (await alerts()).filter((a) => a.dedupeKey.includes("refund-failed")),
    ).toHaveLength(0);
    await expectNothingUnsafePersisted();
  });

  it("a failure while polling a requested refund leaves only the code on the row", async () => {
    const r = await refundIntent();
    const now = new Date();
    await testDb.refund.update({
      where: { id: r.refundId },
      data: {
        status: "REQUESTED",
        providerRefundId: "rfnd_test_polling",
        nextAttemptAt: now,
      },
    });
    vi.spyOn(gateway, "listRefunds").mockRejectedValue(hostileError());
    expect(await runRefundPayments({ now })).toMatchObject({ polled: 1 });
    expect(
      await testDb.refund.findUniqueOrThrow({ where: { id: r.refundId } }),
    ).toMatchObject({ status: "REQUESTED", lastError: UNKNOWN });
    await expectNothingUnsafePersisted();
  });
});

describe("notification emails", () => {
  const undelivered =
    "EMAIL_DELIVERY_FAILED: The email provider did not accept the message or could not be reached.";

  it("a delivery failure keeps only the code on the row and in the alert", async () => {
    const o = await placeCodGuestOrder();
    const failing = () => Promise.reject(hostileError());
    const now = new Date();
    expect(await runSendNotifications({ now, send: failing })).toMatchObject({
      claimed: 2,
      retried: 2,
    });
    const first = await testDb.notificationOutbox.findFirstOrThrow({
      where: { kind: "order.confirmed", orderId: o.orderId },
    });
    expect(first).toMatchObject({
      status: "PENDING",
      attempts: 1,
      lastError: undelivered,
    });
    expect(first.nextAttemptAt.getTime()).toBe(
      now.getTime() + (checkoutPolicy.jobs.backoffMinutes[0] ?? 0) * minute,
    );

    await testDb.notificationOutbox.updateMany({
      data: {
        attempts: checkoutPolicy.jobs.maxAttempts - 1,
        nextAttemptAt: now,
      },
    });
    expect(await runSendNotifications({ now, send: failing })).toMatchObject({
      failed: 2,
    });
    const raised = await alerts();
    expect(raised).toHaveLength(2);
    const confirmed = raised.find(
      (a) => a.dedupeKey === `ops.alert:notification-failed:${first.id}`,
    );
    expect(confirmed?.payload).toEqual({
      reason: "Email order.confirmed could not be sent",
      recipient: o.email,
      notificationId: first.id,
      lastError: undelivered,
      failure: {
        code: "EMAIL_DELIVERY_FAILED",
        summary:
          "The email provider did not accept the message or could not be reached.",
        source: "notification",
        retryable: null,
        reference: `notification:${first.id}`,
      },
    });
    await expectNothingUnsafePersisted();
  });

  it("a failure while building the email is recorded as that, or as the database error it is", async () => {
    await placeCodGuestOrder();
    const now = new Date();
    const render = vi.spyOn(notifications, "renderNotification");
    render.mockRejectedValue(hostileError());
    expect(await runSendNotifications({ now })).toMatchObject({ retried: 2 });
    expect(
      (await testDb.notificationOutbox.findMany()).map((row) => row.lastError),
    ).toEqual([
      "EMAIL_RENDER_FAILED: The email could not be built from its stored data.",
      "EMAIL_RENDER_FAILED: The email could not be built from its stored data.",
    ]);

    // An error that says what it is is not relabelled by where it happened.
    await testDb.notificationOutbox.updateMany({
      data: { nextAttemptAt: now },
    });
    render.mockRejectedValue(hostileValidationError());
    expect(await runSendNotifications({ now })).toMatchObject({ retried: 2 });
    expect(
      (await testDb.notificationOutbox.findMany()).map((row) => row.lastError),
    ).toEqual([
      "DATABASE_INVALID_REQUEST: The application sent the database a request it could not accept.",
      "DATABASE_INVALID_REQUEST: The application sent the database a request it could not accept.",
    ]);
    await expectNothingUnsafePersisted();
  });
});

describe("real database errors, as the client throws them", () => {
  it("a duplicate and a broken data rule are described without the values involved", async () => {
    let duplicate: unknown;
    try {
      await testDb.$transaction(async (tx) => {
        await tx.user.create({ data: { email: UNSAFE.email, name: "Probe" } });
        await tx.user.create({ data: { email: UNSAFE.email, name: "Probe" } });
      });
    } catch (error) {
      duplicate = error;
    }
    const first = describeFailure(duplicate, {
      source: "refund",
      reference: "refund:probe",
    });
    expect(first).toEqual({
      code: "DATABASE_UNIQUE_CONFLICT",
      summary:
        "The database refused the write because it would duplicate an existing record.",
      source: "refund",
      retryable: false,
      reference: "refund:probe",
      databaseCode: "P2002",
      sqlState: "23505",
    });

    let brokenRule: unknown;
    try {
      await testDb.notificationOutbox.create({
        data: {
          kind: "ops.alert",
          dedupeKey: "ops.alert:probe",
          recipient: null,
          status: "PENDING",
          payload: { customer: UNSAFE.email, phone: UNSAFE.phone },
        },
      });
    } catch (error) {
      brokenRule = error;
    }
    const second = describeFailure(brokenRule, {
      source: "notification",
      reference: "notification:probe",
    });
    expect(second).toMatchObject({
      code: "DATABASE_CONSTRAINT_VIOLATION",
      retryable: false,
      sqlState: "23514",
    });
    for (const failure of [first, second]) {
      const text = JSON.stringify(failure);
      for (const forbidden of FORBIDDEN) expect(text).not.toContain(forbidden);
      expect(text).not.toContain("notification_outbox");
    }
    // Both writes were refused: nothing was left behind.
    expect(await testDb.user.count()).toBe(0);
    expect(await testDb.notificationOutbox.count()).toBe(0);
  });
});

describe("a retry is decided from the original error, not from how it is described", () => {
  const refused =
    "APPLICATION_RULE_REFUSED: An application rule refused the operation.";
  const undelivered =
    "EMAIL_DELIVERY_FAILED: The email provider did not accept the message or could not be reached.";
  /**
   * Errors whose description says "retrying will not help", says nothing, or
   * is not an error at all. `retryable` is what the description records; the
   * jobs' own rule (give up only when the attempts run out, or when a real
   * provider error says so) must be untouched by it.
   */
  const failures = [
    {
      name: "an application error described as not worth retrying",
      thrown: (): unknown =>
        hostile(
          new AppError(EVERYTHING, {
            code: "INVENTORY_INCONSISTENT",
            status: 500,
          }),
        ),
      line: "INVENTORY_INCONSISTENT: The stock counters and the reservations for an item disagree.",
      emailLine:
        "INVENTORY_INCONSISTENT: The stock counters and the reservations for an item disagree.",
      retryable: false,
    },
    {
      name: "a database conflict described as not worth retrying",
      thrown: (): unknown =>
        hostile(
          new Prisma.PrismaClientKnownRequestError(EVERYTHING, {
            code: "P2002",
            clientVersion: "test",
          }),
        ),
      line: "DATABASE_UNIQUE_CONFLICT: The database refused the write because it would duplicate an existing record. [P2002]",
      emailLine:
        "DATABASE_UNIQUE_CONFLICT: The database refused the write because it would duplicate an existing record. [P2002]",
      retryable: false,
    },
    {
      name: "an application error with an unlisted code",
      thrown: (): unknown =>
        hostile(new AppError(EVERYTHING, { code: UNSAFE.email, status: 400 })),
      line: refused,
      emailLine: refused,
      retryable: null,
    },
    {
      name: "an unknown error",
      thrown: (): unknown => hostileError(),
      line: UNKNOWN,
      emailLine: undelivered,
      retryable: null,
    },
    {
      name: "an object that only looks like a provider rejection",
      thrown: (): unknown => ({
        name: "PaymentGatewayError",
        code: "PAYMENT_PROVIDER_REJECTED",
        retryable: false,
        status: 502,
        message: EVERYTHING,
        toString: () => EVERYTHING,
      }),
      line: UNKNOWN,
      emailLine: undelivered,
      retryable: null,
    },
  ];

  /** What the jobs' own rule gives for a first failure: not the description's doing. */
  function firstRetry(now: Date) {
    const decision = decideRetry(checkoutPolicy.jobs, 1, now);
    expect(decision.giveUp).toBe(false);
    expect(decision.nextAttemptAt.getTime()).toBe(
      now.getTime() + (checkoutPolicy.jobs.backoffMinutes[0] ?? 0) * minute,
    );
    return decision.nextAttemptAt.getTime();
  }

  it.each(failures)(
    "a webhook failing with $name is retried on schedule and given up only when the attempts run out",
    async ({ thrown, line, retryable }) => {
      let now = new Date();
      const o = await deliverCapture("evt_retry", now);
      vi.spyOn(capture, "applyCapture").mockImplementation(() =>
        Promise.reject(thrown()),
      );
      // What the record says about retrying; the outcomes below do not follow it.
      const description = describeFailure(thrown(), {
        source: "payment-webhook",
        reference: "webhook:evt_retry",
      });
      expect(description.retryable).toBe(retryable);

      expect(await processWebhookEvent("evt_retry", { now })).toBe(
        "retry_scheduled",
      );
      const ledger = await testDb.paymentWebhookEvent.findUniqueOrThrow({
        where: { id: "evt_retry" },
      });
      expect(ledger).toMatchObject({
        status: "RECEIVED",
        attempts: 1,
        lastError: line,
        claimedAt: null,
      });
      expect(ledger.nextAttemptAt.getTime()).toBe(firstRetry(now));
      expect(await alerts()).toHaveLength(0);

      // Every later attempt is retried too, until the policy's last one.
      for (let i = 2; i <= checkoutPolicy.jobs.maxAttempts; i += 1) {
        now = new Date(now.getTime() + 2 * 24 * 60 * minute);
        expect(await processWebhookEvent("evt_retry", { now })).toBe(
          i < checkoutPolicy.jobs.maxAttempts ? "retry_scheduled" : "failed",
        );
      }
      const raised = await alerts();
      expect(raised).toHaveLength(1);
      expect(raised[0]?.payload).toStrictEqual({
        reason: `Webhook payment.captured could not be applied after ${checkoutPolicy.jobs.maxAttempts} attempts; needs manual reconciliation`,
        eventId: "evt_retry",
        eventType: "payment.captured",
        providerOrderId: o.providerOrderId,
        providerPaymentId: o.providerPaymentId,
        orderNumber: o.orderNumber,
        attempts: checkoutPolicy.jobs.maxAttempts,
        lastError: line,
        failure: description,
      });
      await expectNothingUnsafePersisted();
    },
  );

  it.each(failures)(
    "a refund failing with $name is retried on schedule, not ended",
    async ({ thrown, line, retryable }) => {
      const r = await refundIntent();
      const now = new Date();
      vi.spyOn(gateway, "createRefund").mockImplementation(() =>
        Promise.reject(thrown()),
      );
      expect(
        describeFailure(thrown(), {
          source: "refund",
          reference: `refund:${r.reference}`,
        }).retryable,
      ).toBe(retryable);

      expect(await runRefundPayments({ now })).toMatchObject({
        retried: 1,
        failed: 0,
      });
      const refund = await testDb.refund.findUniqueOrThrow({
        where: { id: r.refundId },
      });
      expect(refund).toMatchObject({
        status: "INITIATED",
        attempts: 1,
        lastError: line,
        claimedAt: null,
      });
      expect(refund.nextAttemptAt.getTime()).toBe(firstRetry(now));
      expect(
        await testDb.orderEvent.count({
          where: { orderId: r.orderId, type: "refund.retry" },
        }),
      ).toBe(1);
      expect(
        await testDb.orderEvent.count({
          where: { orderId: r.orderId, type: "refund.failed" },
        }),
      ).toBe(0);
      expect(
        (await alerts()).filter((a) => a.dedupeKey.includes("refund-failed")),
      ).toHaveLength(0);
      await expectNothingUnsafePersisted();
    },
  );

  it("a refund ends at once only for a real provider error that says so, whatever the description says", async () => {
    // The provider's own flag, read from the error it threw, is the one
    // thing that ends a refund before its attempts run out.
    const r = await refundIntent();
    const now = new Date();
    const create = vi.spyOn(gateway, "createRefund");
    create.mockRejectedValue(
      hostile(
        new PaymentGatewayError(EVERYTHING, {
          code: "PAYMENT_PROVIDER_UNAVAILABLE",
          retryable: true,
        }),
      ),
    );
    expect(await runRefundPayments({ now })).toMatchObject({
      retried: 1,
      failed: 0,
    });
    const retried = await testDb.refund.findUniqueOrThrow({
      where: { id: r.refundId },
    });
    expect(retried).toMatchObject({
      status: "INITIATED",
      attempts: 1,
      lastError:
        "PAYMENT_PROVIDER_UNAVAILABLE: The payment provider could not be reached or did not answer in time.",
    });
    expect(retried.nextAttemptAt.getTime()).toBe(firstRetry(now));

    create.mockRejectedValue(
      hostile(
        new PaymentGatewayError(EVERYTHING, {
          code: "PAYMENT_PROVIDER_REJECTED",
          retryable: false,
        }),
      ),
    );
    const due = new Date(retried.nextAttemptAt.getTime() + minute);
    expect(await runRefundPayments({ now: due })).toMatchObject({
      retried: 0,
      failed: 1,
    });
    expect(
      await testDb.refund.findUniqueOrThrow({ where: { id: r.refundId } }),
    ).toMatchObject({
      status: "FAILED",
      attempts: 2,
      lastError:
        "PAYMENT_PROVIDER_REJECTED: The payment provider refused the request.",
    });
    await expectNothingUnsafePersisted();
  });

  it.each(failures)(
    "an email failing with $name is retried on schedule",
    async ({ thrown, emailLine }) => {
      await placeCodGuestOrder();
      const now = new Date();
      const failing = () => Promise.reject(thrown());
      expect(await runSendNotifications({ now, send: failing })).toMatchObject({
        claimed: 2,
        retried: 2,
        failed: 0,
      });
      const rows = await testDb.notificationOutbox.findMany();
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).toMatchObject({
          status: "PENDING",
          attempts: 1,
          lastError: emailLine,
          claimedAt: null,
        });
        expect(row.nextAttemptAt.getTime()).toBe(firstRetry(now));
      }
      await expectNothingUnsafePersisted();
    },
  );
});
