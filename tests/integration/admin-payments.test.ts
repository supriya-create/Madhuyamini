import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ForbiddenCapabilityError,
  ReauthRequiredError,
} from "@/features/admin/authz";
import { cancelOrder } from "@/features/admin/orders/service";
import {
  PaymentReviewError,
  acceptMismatch,
  attachProviderPayment,
  createRefund,
  getRefunds,
  getReviewQueue,
  markRefundedExternally,
  recheckWithProvider,
  retryRefund,
} from "@/features/admin/payments/service";
import { applyCapture } from "@/features/payments/capture";
import { db } from "@/server/db";
import { runRefundPayments } from "@/server/jobs/refund-payments";
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
 * Payment review and refunds (docs/admin.md §5.5, §6 A6–A8): the admin
 * never asserts a payment; every path goes through provider facts and the
 * Phase 6 capture and refund machinery, and is audited with the evidence.
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

async function providerOrderIdOf(attemptId: string): Promise<string> {
  const attempt = await testDb.payment.findUniqueOrThrow({
    where: { id: attemptId },
  });
  if (!attempt.providerOrderId) throw new Error("no provider order");
  return attempt.providerOrderId;
}

async function auditOf(action: string) {
  return testDb.adminAuditLog.findMany({
    where: { action },
    orderBy: { createdAt: "asc" },
  });
}

describe("re-check with the provider (STAFF)", () => {
  it("applies a capture the webhook missed and records what the provider said", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await placeTestOrder("RAZORPAY", { sku: "RC-1" });
    const providerOrderId = await providerOrderIdOf(placed.attemptId);
    gateway.simulatePayment(providerOrderId, { status: "captured" });

    const outcomes = await recheckWithProvider(staff.ctx, placed.orderId);
    expect(outcomes).toEqual([
      { attemptNo: 1, kind: "captured", capture: "confirmed" },
    ]);
    const snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("CONFIRMED");
    expect(snap.order.payments[0]?.status).toBe("CAPTURED");
    const [audit] = await auditOf("payment.recheck");
    expect(audit).toMatchObject({
      outcome: "SUCCESS",
      reason: "attempt 1: captured (confirmed)",
      after: { status: "CONFIRMED" },
    });

    // Nothing open any more: a second re-check does nothing and says so.
    expect(await recheckWithProvider(staff.ctx, placed.orderId)).toEqual([]);
    const second = (await auditOf("payment.recheck"))[1];
    expect(second?.reason).toBe("No attempt to re-check.");
  });

  it("refuses cash-on-delivery orders", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await placeTestOrder("COD", { sku: "RC-2" });
    await expect(
      recheckWithProvider(staff.ctx, placed.orderId),
    ).rejects.toBeInstanceOf(PaymentReviewError);
    expect((await auditOf("payment.recheck"))[0]?.outcome).toBe("FAILED");
  });
});

describe("attach a provider payment (ADMIN, re-auth)", () => {
  it("fetches the payment, checks it belongs to the order, and applies it through applyCapture", async () => {
    const now = new Date();
    const staff = await verifiedStaff("STAFF", now);
    const admin = await verifiedStaff("ADMIN", now);
    const placed = await placeTestOrder("RAZORPAY", { sku: "AT-1" });
    const providerOrderId = await providerOrderIdOf(placed.attemptId);
    const { providerPaymentId } = gateway.simulatePayment(providerOrderId, {
      status: "captured",
    });
    const other = await placeTestOrder("RAZORPAY", {
      sku: "AT-2",
      email: "other@example.com",
    });
    const otherPayment = gateway.simulatePayment(
      await providerOrderIdOf(other.attemptId),
      { status: "captured" },
    );

    await expect(
      attachProviderPayment(
        staff.ctx,
        placed.orderId,
        { providerPaymentId, reason: "Dashboard shows paid." },
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    await expect(
      attachProviderPayment(
        admin.ctx,
        placed.orderId,
        { providerPaymentId, reason: "Dashboard shows paid." },
        minutesLater(now, 20),
      ),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
    await expect(
      attachProviderPayment(
        admin.ctx,
        placed.orderId,
        { providerPaymentId: "pay_does_not_exist", reason: "Guess." },
        now,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND_AT_PROVIDER" });
    await expect(
      attachProviderPayment(
        admin.ctx,
        placed.orderId,
        {
          providerPaymentId: otherPayment.providerPaymentId,
          reason: "Wrong order.",
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_WRONG_ORDER" });
    expect((await orderSnapshot(placed.orderId)).order.status).toBe(
      "PENDING_PAYMENT",
    );

    const outcome = await attachProviderPayment(
      admin.ctx,
      placed.orderId,
      { providerPaymentId, reason: "Dashboard shows paid." },
      now,
    );
    expect(outcome).toBe("confirmed");
    const snap = await orderSnapshot(placed.orderId);
    expect(snap.order.status).toBe("CONFIRMED");
    expect(snap.order.payments[0]).toMatchObject({
      status: "CAPTURED",
      providerPaymentId,
      signatureVerifiedAt: null,
    });
    const audits = await auditOf("payment.attach");
    expect(audits.map((a) => [a.outcome, a.errorCode])).toEqual([
      ["REFUSED", "ADMIN_FORBIDDEN"],
      ["REFUSED", "ADMIN_REAUTH_REQUIRED"],
      ["FAILED", "PAYMENT_NOT_FOUND_AT_PROVIDER"],
      ["FAILED", "PAYMENT_WRONG_ORDER"],
      ["SUCCESS", null],
    ]);
    expect(audits[4]?.after).toMatchObject({
      status: "CONFIRMED",
      providerPaymentId,
      providerStatus: "captured",
      providerAmountInPaise: placed.totalInPaise,
      captureOutcome: "confirmed",
    });
  });

  it("refuses a payment the provider has not captured", async () => {
    const admin = await verifiedStaff("ADMIN");
    const placed = await placeTestOrder("RAZORPAY", { sku: "AT-3" });
    const providerOrderId = await providerOrderIdOf(placed.attemptId);
    const { providerPaymentId } = gateway.simulatePayment(providerOrderId, {
      status: "failed",
      errorCode: "BAD_REQUEST_ERROR",
    });
    await expect(
      attachProviderPayment(admin.ctx, placed.orderId, {
        providerPaymentId,
        reason: "Try.",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_CAPTURED_AT_PROVIDER" });
    expect((await orderSnapshot(placed.orderId)).order.status).toBe(
      "PENDING_PAYMENT",
    );
  });
});

describe("mismatch review (ADMIN, re-auth)", () => {
  async function mismatchedOrder(deltaInPaise: number, sku: string) {
    const placed = await placeTestOrder("RAZORPAY", { sku, stock: 3 });
    const outcome = await applyCapture({
      attemptId: placed.attemptId,
      providerPaymentId: `pay_${sku}`,
      amountInPaise: placed.totalInPaise + deltaInPaise,
      currency: "INR",
      actor: "WEBHOOK",
      signatureVerified: true,
      now: new Date(),
    });
    expect(outcome).toBe("mismatch");
    expect((await orderSnapshot(placed.orderId)).order.status).toBe(
      "NEEDS_REVIEW",
    );
    return placed;
  }

  it("lists the queue, accepts an overpayment and refuses an underpayment", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    const over = await mismatchedOrder(100, "MM-1");
    const under = await mismatchedOrder(-100, "MM-2");

    const queue = await getReviewQueue(staff.ctx);
    expect(queue.map((o) => o.id).sort()).toEqual(
      [over.orderId, under.orderId].sort(),
    );
    expect(await stockOf(over.variantId)).toEqual({
      stockOnHand: 3,
      reserved: 1,
    });

    await expect(
      acceptMismatch(staff.ctx, over.orderId, {
        reason: "Customer tipped.",
        confirmOrderNumber: over.orderNumber,
      }),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    await expect(
      acceptMismatch(admin.ctx, over.orderId, {
        reason: "Customer tipped.",
        confirmOrderNumber: "MY-NOPE",
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });

    await acceptMismatch(admin.ctx, over.orderId, {
      reason: "Customer paid ₹1 extra; accepted.",
      confirmOrderNumber: over.orderNumber,
    });
    const snap = await orderSnapshot(over.orderId);
    expect(snap.order.status).toBe("CONFIRMED");
    expect(snap.order.confirmedAt).toBeInstanceOf(Date);
    expect(snap.order.reservations.map((r) => r.status)).toEqual(["CONSUMED"]);
    expect(await stockOf(over.variantId)).toEqual({
      stockOnHand: 2,
      reserved: 0,
    });
    expect(snap.eventTypes).toEqual(
      expect.arrayContaining(["payment.mismatch_accepted", "order.confirmed"]),
    );
    expect(snap.outboxKinds).toContain("order.confirmed");
    expect(snap.auditOutcomes).toEqual([
      ["payment.accept_mismatch", "REFUSED"],
      ["payment.accept_mismatch", "FAILED"],
      ["payment.accept_mismatch", "SUCCESS"],
    ]);

    await expect(
      acceptMismatch(admin.ctx, under.orderId, {
        reason: "Let it go.",
        confirmOrderNumber: under.orderNumber,
      }),
    ).rejects.toMatchObject({ code: "UNDERPAYMENT" });
    expect((await orderSnapshot(under.orderId)).order.status).toBe(
      "NEEDS_REVIEW",
    );

    // The underpayment is resolved by cancelling: holds released, refund queued.
    await cancelOrder(admin.ctx, under.orderId, {
      reason: "Short payment; refunding.",
      confirmOrderNumber: under.orderNumber,
    });
    const cancelled = await orderSnapshot(under.orderId);
    expect(cancelled.order.status).toBe("CANCELLED");
    expect(cancelled.order.reservations.map((r) => r.status)).toEqual([
      "RELEASED",
    ]);
    expect(cancelled.order.refunds[0]).toMatchObject({
      reason: "review_cancelled",
      amountInPaise: under.totalInPaise - 100,
    });
    expect(await getReviewQueue(staff.ctx)).toEqual([]);
  });

  it("needs a captured attempt before anything can be accepted", async () => {
    const admin = await verifiedStaff("ADMIN");
    const placed = await placeTestOrder("RAZORPAY", { sku: "MM-3" });
    await testDb.order.update({
      where: { id: placed.orderId },
      data: { status: "NEEDS_REVIEW" },
    });
    await expect(
      acceptMismatch(admin.ctx, placed.orderId, {
        reason: "Looks fine.",
        confirmOrderNumber: placed.orderNumber,
      }),
    ).rejects.toMatchObject({ code: "NO_CAPTURED_ATTEMPT" });
  });
});

describe("refunds (ADMIN, re-auth)", () => {
  it("queues bounded refunds that the refund job executes, and lists them", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    const placed = await confirmedOnlineOrder({ sku: "RF-1" });

    await expect(
      createRefund(staff.ctx, placed.orderId, {
        amountInPaise: 500,
        reason: "Goodwill.",
      }),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    await expect(
      createRefund(admin.ctx, placed.orderId, {
        amountInPaise: placed.totalInPaise + 1,
        reason: "Too much.",
      }),
    ).rejects.toMatchObject({ code: "AMOUNT_EXCEEDS_REFUNDABLE" });
    await expect(
      createRefund(admin.ctx, placed.orderId, {
        amountInPaise: 0,
        reason: "Nothing.",
      }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });

    const first = await createRefund(admin.ctx, placed.orderId, {
      amountInPaise: 500,
      reason: "Goodwill for the delay.",
    });
    expect(first.reference).toBe(`${placed.orderNumber}-R1`);
    const second = await createRefund(admin.ctx, placed.orderId, {
      amountInPaise: placed.totalInPaise - 500,
      reason: "Rest of it.",
    });
    expect(second.reference).toBe(`${placed.orderNumber}-R1-2`);
    await expect(
      createRefund(admin.ctx, placed.orderId, {
        amountInPaise: 1,
        reason: "One more.",
      }),
    ).rejects.toMatchObject({ code: "NOTHING_TO_REFUND" });

    let snap = await orderSnapshot(placed.orderId);
    expect(snap.order.refunds.map((r) => [r.status, r.amountInPaise])).toEqual([
      ["INITIATED", 500],
      ["INITIATED", placed.totalInPaise - 500],
    ]);
    expect(snap.order.status).toBe("CONFIRMED");
    expect(
      snap.outboxKinds.filter((k) => k === "order.refund_requested"),
    ).toHaveLength(2);

    // The fake provider processes refunds at once.
    await runRefundPayments();
    snap = await orderSnapshot(placed.orderId);
    expect(snap.order.refunds.map((r) => r.status)).toEqual([
      "PROCESSED",
      "PROCESSED",
    ]);
    expect(snap.order.payments[0]?.status).toBe("REFUNDED");

    const listed = await getRefunds(admin.ctx, { status: "PROCESSED" });
    expect(listed.map((r) => r.reference)).toEqual(
      expect.arrayContaining([first.reference, second.reference]),
    );
    expect(listed.every((r) => !r.canRetry && !r.canMarkExternal)).toBe(true);
  });

  it("retries a failed refund by resetting the queue row, keeping the old error in the audit", async () => {
    const admin = await verifiedStaff("ADMIN");
    const placed = await confirmedOnlineOrder({ sku: "RF-2" });
    const { reference } = await createRefund(admin.ctx, placed.orderId, {
      amountInPaise: 1000,
      reason: "Goodwill.",
    });
    const refund = await testDb.refund.findUniqueOrThrow({
      where: { reference },
    });
    await testDb.refund.update({
      where: { id: refund.id },
      data: { status: "FAILED", attempts: 5, lastError: "Provider down" },
    });

    await retryRefund(admin.ctx, refund.id, "Provider is back.");
    const reset = await testDb.refund.findUniqueOrThrow({
      where: { id: refund.id },
    });
    expect(reset).toMatchObject({
      status: "INITIATED",
      attempts: 0,
      lastError: null,
    });
    await expect(
      retryRefund(admin.ctx, refund.id, "Again."),
    ).rejects.toBeInstanceOf(PaymentReviewError);
    const [audit] = await auditOf("refund.retry");
    expect(audit).toMatchObject({
      outcome: "SUCCESS",
      targetType: "refund",
      targetId: refund.id,
      before: { status: "FAILED", attempts: 5, lastError: "Provider down" },
      after: { status: "INITIATED", attempts: 0 },
    });

    await runRefundPayments();
    expect(
      (await testDb.refund.findUniqueOrThrow({ where: { id: refund.id } }))
        .status,
    ).toBe("PROCESSED");
  });

  it("records a refund made by hand only after the provider confirms it", async () => {
    const admin = await verifiedStaff("ADMIN");
    const placed = await confirmedOnlineOrder({ sku: "RF-3" });
    const { reference } = await createRefund(admin.ctx, placed.orderId, {
      amountInPaise: 2000,
      reason: "Goodwill.",
    });
    const refund = await testDb.refund.findUniqueOrThrow({
      where: { reference },
    });
    const providerPaymentId = placed.providerPaymentId ?? "";

    await expect(
      markRefundedExternally(admin.ctx, refund.id, {
        providerRefundId: "rfnd_unknown",
        reason: "Done in dashboard.",
      }),
    ).rejects.toMatchObject({ code: "REFUND_NOT_FOUND_AT_PROVIDER" });

    // The money was refunded by hand: the provider knows a refund of a different amount…
    const wrong = await gateway.createRefund(providerPaymentId, {
      amountInPaise: 1500,
      reference: "manual-1",
      notes: {},
    });
    await expect(
      markRefundedExternally(admin.ctx, refund.id, {
        providerRefundId: wrong.providerRefundId,
        reason: "Done in dashboard.",
      }),
    ).rejects.toMatchObject({ code: "REFUND_AMOUNT_MISMATCH" });

    // …and one that matches.
    gateway.capturePayment(providerPaymentId);
    const right = await gateway.createRefund(providerPaymentId, {
      amountInPaise: 2000,
      reference: "manual-2",
      notes: {},
    });
    await markRefundedExternally(admin.ctx, refund.id, {
      providerRefundId: right.providerRefundId,
      reason: "Done in dashboard.",
    });
    const stored = await testDb.refund.findUniqueOrThrow({
      where: { id: refund.id },
    });
    expect(stored).toMatchObject({
      status: "PROCESSED",
      providerRefundId: right.providerRefundId,
    });
    expect(stored.processedAt).toBeInstanceOf(Date);
    const snap = await orderSnapshot(placed.orderId);
    // A partial refund leaves the attempt captured; only a full one settles it.
    expect(snap.order.payments[0]?.status).toBe("CAPTURED");
    expect(snap.eventTypes).toContain("refund.processed");
    expect(
      (await auditOf("refund.mark_external")).map((a) => a.outcome),
    ).toEqual(["FAILED", "FAILED", "SUCCESS"]);
  });
});
