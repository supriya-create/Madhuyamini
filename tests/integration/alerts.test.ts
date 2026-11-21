import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  acknowledgeAlert,
  discardNotification,
  getAlerts,
  retryNotification,
} from "@/features/admin/operations/service";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { runExpireReservations } from "@/server/jobs/expire-reservations";
import { runSendNotifications } from "@/server/jobs/send-notifications";
import { enqueueOpsAlert } from "@/server/notifications/outbox";

import { resetDatabase, testDb } from "./db";
import { placePendingOrder } from "./fixtures/orders";
import { verifiedStaff } from "./staff";

/**
 * Operations alerts are durable rows whether or not an inbox is configured
 * (audit batch 4, docs/checkout.md §11): email is delivery, the row is the
 * record.
 */

const minute = 60 * 1000;

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

/** Runs `fn` with no operations inbox configured, as a deployment without ORDER_NOTIFY_EMAIL. */
async function withoutInbox<T>(fn: () => Promise<T>): Promise<T> {
  const notifications = env.notifications as { ownerEmail: string | null };
  const before = notifications.ownerEmail;
  notifications.ownerEmail = null;
  try {
    return await fn();
  } finally {
    notifications.ownerEmail = before;
  }
}

describe("operations alerts without an inbox", () => {
  it("records the alert as a SKIPPED row that the sender never claims", async () => {
    await db.$transaction((tx) =>
      enqueueOpsAlert(
        tx,
        { key: "test:1", orderId: null, payload: { reason: "r" } },
        { inbox: null },
      ),
    );
    const row = await testDb.notificationOutbox.findUniqueOrThrow({
      where: { dedupeKey: "ops.alert:test:1" },
    });
    expect(row).toMatchObject({
      kind: "ops.alert",
      status: "SKIPPED",
      recipient: null,
      attempts: 0,
    });

    const sent: string[] = [];
    expect(
      await runSendNotifications({
        send: (message) => {
          sent.push(message.to);
          return Promise.resolve();
        },
      }),
    ).toMatchObject({ claimed: 0, sent: 0 });
    expect(sent).toEqual([]);
    expect(
      (
        await testDb.notificationOutbox.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).status,
    ).toBe("SKIPPED");
  });

  it("queues the same alert for email when an inbox exists, once per key either way", async () => {
    await db.$transaction((tx) =>
      enqueueOpsAlert(tx, {
        key: "test:2",
        orderId: null,
        payload: { reason: "r" },
      }),
    );
    expect(
      await testDb.notificationOutbox.findUniqueOrThrow({
        where: { dedupeKey: "ops.alert:test:2" },
      }),
    ).toMatchObject({ status: "PENDING", recipient: "owner@example.com" });

    // The same fact again, with or without an inbox, is one row.
    await db.$transaction((tx) =>
      enqueueOpsAlert(
        tx,
        { key: "test:2", orderId: null, payload: { reason: "again" } },
        { inbox: null },
      ),
    );
    expect(
      await testDb.notificationOutbox.count({
        where: { dedupeKey: "ops.alert:test:2" },
      }),
    ).toBe(1);
  });

  it("is enforced by the database: a claimable row must be addressed", async () => {
    await expect(
      testDb.notificationOutbox.create({
        data: {
          kind: "ops.alert",
          dedupeKey: "ops.alert:bad",
          orderId: null,
          recipient: null,
          status: "PENDING",
          payload: {},
        },
      }),
    ).rejects.toThrow(/notification_outbox_pending_has_recipient/);
  });

  it("keeps a producer's alert when the environment has no inbox", async () => {
    const o = await placePendingOrder();
    const now = new Date();
    await testDb.order.update({
      where: { id: o.orderId },
      data: { pendingExpiresAt: new Date(now.getTime() - minute) },
    });
    // Counters out of step: the sweep's expiry of this order fails.
    await testDb.inventory.update({
      where: { variantId: o.variantId },
      data: { reserved: 0 },
    });
    const summary = await withoutInbox(() => runExpireReservations({ now }));
    expect(summary).toMatchObject({ errors: 1 });
    const alerts = await testDb.notificationOutbox.findMany({
      where: { kind: "ops.alert", orderId: o.orderId },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ status: "SKIPPED", recipient: null });
  });

  it("is listed in the admin inbox with the explanation, acknowledgeable, never retried or discarded", async () => {
    await db.$transaction((tx) =>
      enqueueOpsAlert(
        tx,
        { key: "test:3", orderId: null, payload: { reason: "r" } },
        { inbox: null },
      ),
    );
    const admin = await verifiedStaff("ADMIN");
    const [view] = await getAlerts(admin.ctx);
    expect(view).toMatchObject({
      kind: "ops.alert",
      status: "SKIPPED",
      recipient: null,
      acknowledged: false,
      canRetry: false,
      canDiscard: false,
    });
    if (!view) throw new Error("alert not listed");

    await expect(retryNotification(admin.ctx, view.id)).rejects.toThrow(
      /Only failed emails/,
    );
    await expect(
      discardNotification(admin.ctx, view.id, "not wanted"),
    ).rejects.toThrow(/Only a pending or failed email/);

    await acknowledgeAlert(admin.ctx, view.id);
    expect((await getAlerts(admin.ctx))[0]).toMatchObject({
      id: view.id,
      status: "SKIPPED",
      acknowledged: true,
    });
  });
});
