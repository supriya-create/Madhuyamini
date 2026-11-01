import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ForbiddenCapabilityError } from "@/features/admin/authz";
import {
  OperationsError,
  acknowledgeAlert,
  discardNotification,
  getAlerts,
  getOperationsCounts,
  getOutbox,
  getWebhooks,
  reapplyWebhook,
  retryNotification,
  runJobNow,
} from "@/features/admin/operations/service";
import { db } from "@/server/db";
import { runSweepUploads } from "@/server/jobs/sweep-uploads";
import {
  enqueueNotification,
  enqueueOpsAlert,
} from "@/server/notifications/outbox";

import { createCategory, createProduct, resetDatabase, testDb } from "./db";
import { verifiedStaff } from "./staff";

/**
 * Operations monitoring (docs/admin.md §5.6, A10, A12, A17): row resets,
 * masking for STAFF, audited job runs, and the ledger-driven upload sweep.
 */

beforeEach(resetDatabase);
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

async function failedEmail(recipient = "asha.devi@example.com") {
  await db.$transaction((tx) =>
    enqueueNotification(tx, {
      kind: "order.cancelled",
      orderId: null,
      recipient,
      dedupeKey: `test:${recipient}`,
      payload: { orderNumber: "MY-TEST", reason: "customer", email: recipient },
    }),
  );
  const row = await testDb.notificationOutbox.findUniqueOrThrow({
    where: { dedupeKey: `test:${recipient}` },
  });
  await testDb.notificationOutbox.update({
    where: { id: row.id },
    data: { status: "FAILED", attempts: 5, lastError: "SMTP down" },
  });
  return row.id;
}

describe("email outbox", () => {
  it("lets STAFF retry a failed email by resetting the row, keeping its dedupe key", async () => {
    const staff = await verifiedStaff("STAFF");
    const id = await failedEmail();
    await retryNotification(staff.ctx, id);
    const row = await testDb.notificationOutbox.findUniqueOrThrow({
      where: { id },
    });
    expect(row).toMatchObject({
      status: "PENDING",
      attempts: 0,
      lastError: null,
      claimedAt: null,
      dedupeKey: "test:asha.devi@example.com",
    });
    await expect(retryNotification(staff.ctx, id)).rejects.toBeInstanceOf(
      OperationsError,
    );
    const audit = await testDb.adminAuditLog.findMany({
      where: { action: "outbox.retry" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.outcome)).toEqual(["SUCCESS", "FAILED"]);
    expect(JSON.stringify(audit[0]?.before)).not.toContain("asha.devi@");
  });

  it("masks recipients and payloads for STAFF but not for ADMIN", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    await failedEmail();
    const [forStaff] = await getOutbox(staff.ctx, {
      status: "FAILED",
      kind: null,
    });
    expect(forStaff?.recipient).toBe("a********@example.com");
    expect((forStaff?.payload as { email: string }).email).toBe(
      "a********@example.com",
    );
    expect((forStaff?.payload as { orderNumber: string }).orderNumber).toBe(
      "MY-TEST",
    );
    expect(forStaff?.canRetry).toBe(true);
    expect(forStaff?.canDiscard).toBe(false);
    const [forAdmin] = await getOutbox(admin.ctx, {
      status: "FAILED",
      kind: null,
    });
    expect(forAdmin?.recipient).toBe("asha.devi@example.com");
    expect(forAdmin?.canDiscard).toBe(true);
  });

  it("lets only an ADMIN discard, and never a sent email", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    const id = await failedEmail();
    await expect(
      discardNotification(staff.ctx, id, "Customer asked us to stop."),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    await discardNotification(admin.ctx, id, "Customer asked us to stop.");
    const row = await testDb.notificationOutbox.findUniqueOrThrow({
      where: { id },
    });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toBe(
      "Discarded by staff: Customer asked us to stop.",
    );
    expect(row.nextAttemptAt.getFullYear()).toBeGreaterThan(2900);

    await testDb.notificationOutbox.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date() },
    });
    await expect(
      discardNotification(admin.ctx, id, "Too late."),
    ).rejects.toBeInstanceOf(OperationsError);
  });
});

describe("webhook ledger", () => {
  it("re-applies a failed event (ADMIN only) by resetting it to RECEIVED, with payload masked for STAFF", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    await testDb.paymentWebhookEvent.create({
      data: {
        id: "evt_test_1",
        eventType: "payment.captured",
        status: "FAILED",
        attempts: 3,
        lastError: "boom",
        payload: {
          payload: {
            payment: { entity: { email: "asha@example.com", amount: 100 } },
          },
        },
      },
    });
    const [forStaff] = await getWebhooks(staff.ctx, {
      status: null,
      eventType: null,
    });
    expect(JSON.stringify(forStaff?.payload)).not.toContain("asha@example.com");
    expect(JSON.stringify(forStaff?.payload)).toContain('"amount":100');
    expect(forStaff?.canReapply).toBe(false);
    const [forAdmin] = await getWebhooks(admin.ctx, {
      status: "FAILED",
      eventType: null,
    });
    expect(JSON.stringify(forAdmin?.payload)).toContain("asha@example.com");

    await expect(
      reapplyWebhook(staff.ctx, "evt_test_1", "Retry."),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    await reapplyWebhook(
      admin.ctx,
      "evt_test_1",
      "Provider confirmed the event is valid.",
    );
    const row = await testDb.paymentWebhookEvent.findUniqueOrThrow({
      where: { id: "evt_test_1" },
    });
    expect(row).toMatchObject({
      status: "RECEIVED",
      attempts: 0,
      lastError: null,
    });
    await expect(
      reapplyWebhook(admin.ctx, "evt_test_1", "Again."),
    ).rejects.toBeInstanceOf(OperationsError);
  });
});

describe("run a job now", () => {
  it("is ADMIN-only and leaves two audit rows around the run", async () => {
    const staff = await verifiedStaff("STAFF");
    const admin = await verifiedStaff("ADMIN");
    await expect(runJobNow(staff.ctx, "cleanup")).rejects.toBeInstanceOf(
      ForbiddenCapabilityError,
    );
    const summary = await runJobNow(admin.ctx, "cleanup");
    expect(summary).toMatchObject({ carts: 0, sessions: 0 });
    expect(typeof summary.durationMs).toBe("number");
    const audit = await testDb.adminAuditLog.findMany({
      where: { targetType: "job" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => [a.action, a.outcome, a.targetId])).toEqual([
      ["job.run", "REFUSED", "cleanup"],
      ["job.run.started", "SUCCESS", "cleanup"],
      ["job.run", "SUCCESS", "cleanup"],
    ]);
    expect(JSON.stringify(audit[2]?.after)).toContain("carts");
  });
});

describe("alerts inbox and counts", () => {
  it("lists alerts, records acknowledgement as an audit fact, and counts queues", async () => {
    const staff = await verifiedStaff("STAFF");
    await db.$transaction((tx) =>
      enqueueOpsAlert(tx, {
        key: "test-alert",
        orderId: null,
        payload: { reason: "Something needs a look", email: "x@example.com" },
      }),
    );
    let [alert] = await getAlerts(staff.ctx);
    expect(alert).toMatchObject({ kind: "ops.alert", acknowledged: false });
    expect(alert?.recipient).toMatch(/^o\*+@example\.com$/);
    if (!alert) throw new Error("no alert");
    await acknowledgeAlert(staff.ctx, alert.id);
    [alert] = await getAlerts(staff.ctx);
    expect(alert?.acknowledged).toBe(true);
    expect(
      await testDb.notificationOutbox.findUniqueOrThrow({
        where: { id: alert?.id ?? "" },
      }),
    ).toMatchObject({ status: "PENDING" });

    const counts = await getOperationsCounts(staff.ctx);
    expect(counts.outbox.byStatus).toEqual({ PENDING: 1 });
    expect(counts.outbox.dueNow).toBe(1);
    expect(counts.webhooks.byStatus).toEqual({});
    expect(counts.orphanUploads).toBe(0);
  });
});

describe("upload orphan sweep (A17)", () => {
  async function ledgerRow(
    productId: string,
    suffix: string,
    issuedAt: Date,
    status: "ISSUED" | "ATTACHED" = "ISSUED",
  ) {
    const staff = await verifiedStaff("STAFF");
    return testDb.productImageUpload.create({
      data: {
        productId,
        publicId: `madhuyamini/products/${productId}/${suffix}`,
        folder: `madhuyamini/products/${productId}`,
        issuedById: staff.user.id,
        status,
        issuedAt,
      },
    });
  }

  it("deletes only issued assets older than the grace period, inside our folder, and audits each", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const now = new Date();
    const old = new Date(now.getTime() - 30 * 60 * 60 * 1000);
    const stale = await ledgerRow(product.id, "stale", old);
    const recent = await ledgerRow(product.id, "recent", now);
    const attached = await ledgerRow(product.id, "attached", old, "ATTACHED");
    const broken = await ledgerRow(product.id, "broken", old);

    const destroyed: string[] = [];
    const summary = await runSweepUploads({
      now,
      destroy: (publicId) => {
        if (publicId.endsWith("/broken"))
          return Promise.reject(new Error("Cloudinary 503"));
        destroyed.push(publicId);
        return Promise.resolve("deleted");
      },
    });
    expect(summary).toEqual({ examined: 2, swept: 1, errors: 1, skipped: 0 });
    expect(destroyed).toEqual([stale.publicId]);
    const rows = Object.fromEntries(
      (await testDb.productImageUpload.findMany()).map((row) => [row.id, row]),
    );
    expect(rows[stale.id]).toMatchObject({ status: "SWEPT", sweepError: null });
    expect(rows[stale.id]?.resolvedAt).toEqual(now);
    expect(rows[recent.id]).toMatchObject({
      status: "ISSUED",
      sweepError: null,
    });
    expect(rows[attached.id]).toMatchObject({ status: "ATTACHED" });
    expect(rows[broken.id]).toMatchObject({
      status: "ISSUED",
      sweepError: "Error: Cloudinary 503",
    });

    const audit = await testDb.adminAuditLog.findMany({
      where: { action: "upload.sweep" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => [a.actorLabel, a.outcome, a.targetId])).toEqual([
      ["system:upload-sweep", "SUCCESS", stale.id],
      ["system:upload-sweep", "FAILED", broken.id],
    ]);

    // A second run retries the failed one and leaves the swept one alone.
    const second = await runSweepUploads({
      now,
      destroy: () => Promise.resolve("not_found"),
    });
    expect(second).toEqual({ examined: 1, swept: 1, errors: 0, skipped: 0 });
  });

  it("refuses rows whose public id lies outside the upload folder at the database level", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const staff = await verifiedStaff("STAFF");
    await expect(
      testDb.productImageUpload.create({
        data: {
          productId: product.id,
          publicId: "somewhere/else",
          folder: `madhuyamini/products/${product.id}`,
          issuedById: staff.user.id,
        },
      }),
    ).rejects.toThrow(/product_image_uploads_folder_scoped|check constraint/);
  });
});
