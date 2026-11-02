import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getReturnsPolicy } from "@/config/returns-policy";
import {
  ReturnActionError,
  approveReturn,
  getReturnDetail,
  getReturnQueue,
  inspectReturn,
  receiveReturn,
  recordShipmentByStaff,
  rejectReturn,
  requestInformation,
} from "@/features/admin/returns/service";
import {
  ReturnError,
  ReturnIneligibleError,
  addReturnEvidence,
  getReturnEligibility,
  getReturnView,
  listReturnSummaries,
  recordReturnShipment,
  replyToReturnRequest,
  submitReturnRequest,
  withdrawReturnRequest,
} from "@/features/returns/service";
import { NotFoundError } from "@/server/errors";
import { runExpireReturns } from "@/server/jobs/expire-returns";
import { runSweepCustomerUploads } from "@/server/jobs/sweep-customer-uploads";
import {
  issueCustomerUploadTicket,
  verifyCustomerUpload,
} from "@/server/uploads/customer";
import { expectedResponseSignature } from "@/server/uploads/signature";
import { env } from "@/server/env";

import { createUser, resetDatabase, testDb } from "./db";
import { stockOf } from "./order-fixtures";
import {
  customerFor,
  deliveredOrder,
  siblingVariant,
  verifiedEvidence,
} from "./returns-fixtures";
import { minutesLater, verifiedStaff } from "./staff";

/**
 * Customer returns, step 8.1 (docs/phase-8-returns-custom-artwork.md §3,
 * §8, §9, §10): eligibility, submission and its guards, the customer's own
 * actions, the admin review through inspection, ownership, the private
 * file ledger, the clocks job and the sweep. Stock moves only at
 * inspection; money never moves here.
 */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

const policy = getReturnsPolicy();
const day = 24 * 60 * 60 * 1000;

const line = (
  orderItemId: string,
  overrides: Record<string, unknown> = {},
) => ({
  orderItemId,
  quantity: 1,
  reason: "SIZE_OR_FIT" as const,
  description: "",
  resolution: "REFUND" as const,
  exchangeVariantId: "",
  ...overrides,
});

async function submitted(
  order: Awaited<ReturnType<typeof deliveredOrder>>,
  overrides: Record<string, unknown> = {},
  now = new Date(),
) {
  const { requestNumber } = await submitReturnRequest(
    order.customer,
    {
      orderNumber: order.orderNumber,
      operationKey: randomUUID(),
      lines: [line(order.orderItemId, overrides)],
      evidenceIds: [],
    },
    "203.0.113.5",
    now,
  );
  const row = await testDb.returnRequest.findUniqueOrThrow({
    where: { requestNumber },
    include: { items: true },
  });
  return { requestNumber, id: row.id, itemId: row.items[0]?.id ?? "" };
}

const auditOf = (action: string) =>
  testDb.adminAuditLog.findMany({
    where: { action },
    orderBy: { createdAt: "asc" },
  });

describe("eligibility", () => {
  it("offers nothing before delivery and the right units and reasons after it", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await (
      await import("./order-fixtures")
    ).placeTestOrder("COD", {
      sku: "EL-1",
      quantity: 2,
    });
    const customer = await customerFor(placed.userId);
    const before = await getReturnEligibility(customer, placed.orderNumber);
    expect(before?.canRequest).toBe(false);
    expect(before?.lines[0]?.ineligible).toBe("ORDER_NOT_DELIVERED");
    void staff;

    const order = await deliveredOrder({ sku: "EL-2", quantity: 2 });
    await siblingVariant(order.productId, "EL-2-ALT");
    const view = await getReturnEligibility(order.customer, order.orderNumber);
    expect(view?.canRequest).toBe(true);
    expect(view?.windowClosesAt).toEqual(
      new Date(order.deliveredAt.getTime() + policy.windowDays * day),
    );
    const only = view?.lines[0];
    expect(only).toMatchObject({ availableQty: 2, ineligible: null });
    expect(only?.reasons).toContain("DAMAGED_ON_ARRIVAL");
    expect(only?.exchangeOptions.map((o) => o.label)).toEqual([
      "Variant EL-2-ALT",
    ]);
    // Another customer sees nothing.
    const stranger = await customerFor(
      (await createUser("stranger@example.com")).id,
    );
    expect(await getReturnEligibility(stranger, order.orderNumber)).toBeNull();
  });
});

describe("submitting a return request", () => {
  it("records items, snapshot, events, the order event and the e-mails, without touching stock", async () => {
    const order = await deliveredOrder({ sku: "SUB-1", stock: 5, quantity: 2 });
    const stockBefore = await stockOf(order.variantId);
    const now = new Date();
    const key = randomUUID();
    const result = await submitReturnRequest(
      order.customer,
      {
        orderNumber: order.orderNumber,
        operationKey: key,
        lines: [
          line(order.orderItemId, { quantity: 1, description: "Too small." }),
        ],
        evidenceIds: [],
      },
      "203.0.113.5",
      now,
    );
    expect(result.reused).toBe(false);
    expect(result.requestNumber).toMatch(/^RT-[23456789A-HJ-NP-Z]{8}$/);
    const row = await testDb.returnRequest.findUniqueOrThrow({
      where: { requestNumber: result.requestNumber },
      include: { items: true, events: true },
    });
    expect(row).toMatchObject({
      status: "REQUESTED",
      userId: order.userId,
      orderId: order.orderId,
      operationKey: key,
      decisionDueAt: new Date(
        now.getTime() + policy.clocks.staffDecisionDays * day,
      ),
    });
    expect(row.policySnapshot).toMatchObject({ windowDays: policy.windowDays });
    expect(
      row.items.map((i) => [i.requestedQty, i.reason, i.description]),
    ).toEqual([[1, "SIZE_OR_FIT", "Too small."]]);
    expect(
      row.events.map((e) => [e.type, e.toStatus, e.visibleToCustomer]),
    ).toEqual([["return.requested", "REQUESTED", true]]);
    const orderEvents = await testDb.orderEvent.findMany({
      where: { orderId: order.orderId, type: "return.requested" },
    });
    expect(orderEvents).toHaveLength(1);
    const outbox = await testDb.notificationOutbox.findMany({
      where: { orderId: order.orderId, kind: { startsWith: "return." } },
    });
    expect(outbox.map((n) => [n.kind, n.recipient])).toEqual([
      ["return.requested", order.customer.email],
    ]);
    expect(
      await testDb.notificationOutbox.count({
        where: {
          kind: "owner.return_requested",
          recipient: "owner@example.com",
        },
      }),
    ).toBe(1);
    expect(await stockOf(order.variantId)).toEqual(stockBefore);
    expect(
      (await getReturnView(order.customer, result.requestNumber))?.canWithdraw,
    ).toBe(true);
    expect(
      (await listReturnSummaries(order.customer)).map((r) => r.requestNumber),
    ).toEqual([result.requestNumber]);
  });

  it("returns the existing request for a replayed key and refuses a second open request", async () => {
    const order = await deliveredOrder({ sku: "SUB-2", quantity: 2 });
    const key = randomUUID();
    const input = {
      orderNumber: order.orderNumber,
      operationKey: key,
      lines: [line(order.orderItemId)],
      evidenceIds: [],
    };
    const first = await submitReturnRequest(
      order.customer,
      input,
      "203.0.113.5",
    );
    const again = await submitReturnRequest(
      order.customer,
      input,
      "203.0.113.5",
    );
    expect(again).toEqual({ requestNumber: first.requestNumber, reused: true });
    await expect(
      submitReturnRequest(
        order.customer,
        { ...input, operationKey: randomUUID() },
        "203.0.113.5",
      ),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof ReturnIneligibleError &&
        error.problems.some((p) => p.reason === "REQUEST_ALREADY_OPEN"),
    );
    expect(await testDb.returnRequest.count()).toBe(1);
    // The same key from another customer is refused, not replayed.
    const stranger = await customerFor((await createUser("s2@example.com")).id);
    await expect(
      submitReturnRequest(stranger, input, "203.0.113.5"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses quantities above the line, closed windows, disallowed reasons and missing evidence", async () => {
    const order = await deliveredOrder({ sku: "SUB-3", quantity: 2 });
    const problems = async (
      overrides: Record<string, unknown>,
      now = new Date(),
    ) => {
      try {
        await submitReturnRequest(
          order.customer,
          {
            orderNumber: order.orderNumber,
            operationKey: randomUUID(),
            lines: [line(order.orderItemId, overrides)],
            evidenceIds: [],
          },
          "203.0.113.5",
          now,
        );
        return [];
      } catch (error) {
        if (error instanceof ReturnIneligibleError)
          return error.problems.map((p) => p.reason);
        throw error;
      }
    };
    expect(await problems({ quantity: 3 })).toEqual(["QUANTITY_EXCEEDED"]);
    expect(
      await problems(
        {},
        new Date(order.deliveredAt.getTime() + (policy.windowDays + 1) * day),
      ),
    ).toEqual(["WINDOW_CLOSED"]);
    expect(await problems({ reason: "DAMAGED_ON_ARRIVAL" })).toEqual([
      "EVIDENCE_REQUIRED",
    ]);
    await testDb.product.update({
      where: { id: order.productId },
      data: { isOneOfAKind: true },
    });
    expect(await problems({ reason: "CHANGED_MIND" })).toEqual([
      "REASON_NOT_ALLOWED",
    ]);
    expect(await testDb.returnRequest.count()).toBe(0);
  });

  it("attaches the customer's own verified photographs and refuses anyone else's", async () => {
    const order = await deliveredOrder({ sku: "SUB-4", quantity: 1 });
    const mine = await verifiedEvidence(order.userId);
    const other = await verifiedEvidence(
      (await createUser("other@example.com")).id,
    );
    await expect(
      submitReturnRequest(
        order.customer,
        {
          orderNumber: order.orderNumber,
          operationKey: randomUUID(),
          lines: [line(order.orderItemId, { reason: "DAMAGED_ON_ARRIVAL" })],
          evidenceIds: [mine.id, other.id],
        },
        "203.0.113.5",
      ),
    ).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });
    const { requestNumber } = await submitReturnRequest(
      order.customer,
      {
        orderNumber: order.orderNumber,
        operationKey: randomUUID(),
        lines: [line(order.orderItemId, { reason: "DAMAGED_ON_ARRIVAL" })],
        evidenceIds: [mine.id],
      },
      "203.0.113.5",
    );
    const request = await testDb.returnRequest.findUniqueOrThrow({
      where: { requestNumber },
    });
    expect(
      await testDb.customerUpload.findUniqueOrThrow({ where: { id: mine.id } }),
    ).toMatchObject({
      status: "ATTACHED",
      targetType: "return_request",
      targetId: request.id,
    });
    expect(
      (await getReturnView(order.customer, requestNumber))?.evidence,
    ).toHaveLength(1);
    // The other customer's row is untouched and still theirs only.
    expect(
      (
        await testDb.customerUpload.findUniqueOrThrow({
          where: { id: other.id },
        })
      ).status,
    ).toBe("ISSUED");
  });

  it("limits requests per customer", async () => {
    const customer = await customerFor(
      (await createUser("limited@example.com")).id,
    );
    const attempt = () =>
      submitReturnRequest(
        customer,
        {
          orderNumber: "MY-ABCDEFGH",
          operationKey: randomUUID(),
          lines: [line("00000000-0000-7000-8000-000000000001")],
          evidenceIds: [],
        },
        "203.0.113.9",
      );
    for (let i = 0; i < policy.limits.requestPerUser.max; i += 1) {
      await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(attempt()).rejects.toMatchObject({
      code: "RETURN_RATE_LIMITED",
    });
  });
});

describe("the private file ledger", () => {
  it("issues an authenticated ticket for the customer's own folder and verifies only a signed response", async () => {
    const customer = await customerFor((await createUser("up@example.com")).id);
    const ticket = await issueCustomerUploadTicket(customer, "RETURN_EVIDENCE");
    expect(ticket.fields.type).toBe("authenticated");
    expect(
      ticket.publicId.startsWith(`madhuyamini/returns/${customer.id}/`),
    ).toBe(true);
    const secret = env.cloudinary?.apiSecret ?? "";
    const facts = {
      uploadId: ticket.uploadId,
      publicId: ticket.publicId,
      version: "1700000000",
      signature: expectedResponseSignature(
        ticket.publicId,
        "1700000000",
        secret,
      ),
      format: "jpg",
      bytes: 50_000,
      width: 1000,
      height: 800,
      resourceType: "image",
    };
    await expect(
      verifyCustomerUpload(customer, { ...facts, signature: "0".repeat(40) }),
    ).rejects.toMatchObject({ code: "UPLOAD_SIGNATURE_INVALID" });
    await expect(
      verifyCustomerUpload(customer, { ...facts, width: 10 }),
    ).rejects.toMatchObject({ code: "UPLOAD_DIMENSIONS" });
    const stranger = await customerFor(
      (await createUser("up2@example.com")).id,
    );
    await expect(verifyCustomerUpload(stranger, facts)).rejects.toMatchObject({
      code: "UPLOAD_NOT_OWNED",
    });
    await verifyCustomerUpload(customer, facts);
    expect(
      await testDb.customerUpload.findUniqueOrThrow({
        where: { id: ticket.uploadId },
      }),
    ).toMatchObject({
      status: "ISSUED",
      width: 1000,
      format: "jpg",
      ownerUserId: customer.id,
    });
    await expect(verifyCustomerUpload(customer, facts)).rejects.toMatchObject({
      code: "UPLOAD_NOT_OWNED",
    });
  });

  it("sweeps orphans after the grace period and evidence of long-closed requests", async () => {
    const order = await deliveredOrder({ sku: "SW-1", quantity: 1 });
    const stale = await verifiedEvidence(
      order.userId,
      new Date(Date.now() - 2 * day),
    );
    const fresh = await verifiedEvidence(order.userId);
    const attached = await verifiedEvidence(order.userId);
    const { requestNumber } = await submitReturnRequest(
      order.customer,
      {
        orderNumber: order.orderNumber,
        operationKey: randomUUID(),
        lines: [line(order.orderItemId)],
        evidenceIds: [attached.id],
      },
      "203.0.113.5",
    );
    await withdrawReturnRequest(order.customer, requestNumber);
    const destroyed: string[] = [];
    const destroy = (publicId: string) => {
      destroyed.push(publicId);
      return Promise.resolve("deleted" as const);
    };
    await runSweepCustomerUploads({ destroy });
    expect(destroyed).toEqual([stale.publicId]);
    expect(
      (
        await testDb.customerUpload.findUniqueOrThrow({
          where: { id: stale.id },
        })
      ).status,
    ).toBe("SWEPT");
    expect(
      (
        await testDb.customerUpload.findUniqueOrThrow({
          where: { id: fresh.id },
        })
      ).status,
    ).toBe("ISSUED");
    // Retention: once the request has been closed long enough, its evidence goes too.
    const longAgo = new Date(
      Date.now() - (policy.files.retentionDaysAfterClose + 1) * day,
    );
    await testDb.returnRequest.update({
      where: { requestNumber },
      data: { createdAt: longAgo, closedAt: longAgo },
    });
    await runSweepCustomerUploads({ destroy });
    expect(destroyed).toEqual([stale.publicId, attached.publicId]);
    expect(
      (
        await testDb.customerUpload.findUniqueOrThrow({
          where: { id: attached.id },
        })
      ).status,
    ).toBe("DISCARDED");
    expect(await auditOf("upload.sweep")).toHaveLength(2);
  });
});

describe("the customer's own actions", () => {
  it("withdraws while allowed, never after the parcel was sent", async () => {
    const order = await deliveredOrder({ sku: "CA-1" });
    const first = await submitted(order);
    await withdrawReturnRequest(order.customer, first.requestNumber);
    const row = await testDb.returnRequest.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(row.status).toBe("WITHDRAWN");
    expect(row.closedAt).toBeInstanceOf(Date);
    expect(
      await testDb.notificationOutbox.count({
        where: { kind: "return.withdrawn" },
      }),
    ).toBe(1);
    // A new request is possible again.
    const staff = await verifiedStaff("STAFF");
    const second = await submitted(order);
    await approveReturn(staff.ctx, second.id, {
      instructions: "Post it to our studio; we will reimburse the postage.",
      note: "",
      items: [{ returnItemId: second.itemId, approvedQty: 1 }],
    });
    await recordReturnShipment(order.customer, second.requestNumber, {
      carrier: "DTDC",
      trackingNumber: "X1",
      trackingUrl: null,
    });
    await expect(
      withdrawReturnRequest(order.customer, second.requestNumber),
    ).rejects.toMatchObject({ code: "RETURN_STATE" });
    const stranger = await customerFor((await createUser("w@example.com")).id);
    await expect(
      withdrawReturnRequest(stranger, second.requestNumber),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("replies to a question, which resumes the decision clock and alerts the owner", async () => {
    const order = await deliveredOrder({ sku: "CA-2" });
    const staff = await verifiedStaff("STAFF");
    const { id, requestNumber } = await submitted(order);
    await requestInformation(staff.ctx, id, "Which size would fit better?");
    expect(
      (await testDb.returnRequest.findUniqueOrThrow({ where: { id } })).status,
    ).toBe("INFO_REQUESTED");
    await replyToReturnRequest(
      order.customer,
      requestNumber,
      "A medium, please.",
    );
    const row = await testDb.returnRequest.findUniqueOrThrow({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(row.status).toBe("REQUESTED");
    expect(row.decisionDueAt).toBeInstanceOf(Date);
    expect(row.messages.map((m) => [m.author, m.body])).toEqual([
      ["STAFF", "Which size would fit better?"],
      ["CUSTOMER", "A medium, please."],
    ]);
    expect(
      await testDb.notificationOutbox.count({
        where: {
          kind: "ops.alert",
          dedupeKey: { startsWith: `ops.alert:return-message:${id}` },
        },
      }),
    ).toBe(1);
    const view = await getReturnView(order.customer, requestNumber);
    expect(view?.messages).toHaveLength(2);
    expect(view?.timeline.map((e) => e.label)).toEqual([
      "Return requested",
      "We asked you a question",
      "You replied",
    ]);
  });

  it("adds photographs later while the request is open", async () => {
    const order = await deliveredOrder({ sku: "CA-3" });
    const { requestNumber } = await submitted(order);
    const extra = await verifiedEvidence(order.userId);
    expect(
      await addReturnEvidence(order.customer, requestNumber, [extra.id]),
    ).toBe(1);
    expect(
      (await getReturnView(order.customer, requestNumber))?.evidence,
    ).toHaveLength(1);
    await expect(
      addReturnEvidence(order.customer, requestNumber, [extra.id]),
    ).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });
  });
});

describe("admin review through inspection", () => {
  it("queues, masks, questions, approves partially, receives short and restocks only what passed inspection", async () => {
    const order = await deliveredOrder({ sku: "AD-1", stock: 5, quantity: 2 });
    const stockAfterSale = await stockOf(order.variantId);
    expect(stockAfterSale).toEqual({ stockOnHand: 3, reserved: 0 });
    const staff = await verifiedStaff("STAFF");
    const { id, itemId } = await submitted(order, {
      quantity: 2,
      reason: "QUALITY",
    });

    const queue = await getReturnQueue(staff.ctx, {
      status: "open",
      q: null,
      page: 1,
    });
    expect(queue.items.map((i) => i.id)).toEqual([id]);
    expect(queue.items[0]?.emailMasked).toMatch(/\*{2,}@/);
    const detail = await getReturnDetail(staff.ctx, id);
    expect(detail?.customer.emailMasked).not.toBe(order.customer.email);
    expect(detail?.actions).toMatchObject({
      approve: true,
      reject: true,
      inspect: false,
    });

    // Inspection before receipt is refused.
    await expect(
      inspectReturn(staff.ctx, id, {
        note: "x",
        items: [
          {
            returnItemId: itemId,
            condition: "AS_NEW",
            restockQty: 1,
            repairQty: 0,
            quarantineQty: 0,
            writeOffQty: 0,
            returnToCustomerQty: 0,
            note: "",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ReturnActionError);

    await approveReturn(staff.ctx, id, {
      instructions: "Post the parcel to the studio address on the website.",
      note: "",
      items: [{ returnItemId: itemId, approvedQty: 2 }],
    });
    let row = await testDb.returnRequest.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    expect(row.status).toBe("APPROVED");
    expect(row.instructionsSnapshot).toMatchObject({ payer: "CUSTOMER" });
    expect(row.shipByAt).toBeInstanceOf(Date);
    expect(row.items[0]?.approvedQty).toBe(2);
    expect(
      await testDb.notificationOutbox.count({
        where: { kind: "return.approved" },
      }),
    ).toBe(1);

    await recordShipmentByStaff(staff.ctx, id, {
      carrier: "DTDC",
      trackingNumber: null,
      trackingUrl: null,
    });
    await receiveReturn(staff.ctx, id, {
      note: "Box intact, one unit missing.",
      items: [{ returnItemId: itemId, receivedQty: 1 }],
    });
    const afterReceipt = await testDb.returnRequest.findUniqueOrThrow({
      where: { id },
      include: { items: true, shipments: true },
    });
    expect(afterReceipt.status).toBe("RECEIVED");
    expect(afterReceipt.items[0]).toMatchObject({
      receivedQty: 1,
      notReceivedQty: 1,
    });
    expect(afterReceipt.shipments[0]?.receivedAt).toBeInstanceOf(Date);
    expect(await stockOf(order.variantId)).toEqual(stockAfterSale);

    // Sums must match what was received.
    await expect(
      inspectReturn(staff.ctx, id, {
        note: "Mismatch",
        items: [
          {
            returnItemId: itemId,
            condition: "AS_NEW",
            restockQty: 1,
            repairQty: 1,
            quarantineQty: 0,
            writeOffQty: 0,
            returnToCustomerQty: 0,
            note: "",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ReturnActionError);

    await inspectReturn(staff.ctx, id, {
      note: "Unit resaleable.",
      items: [
        {
          returnItemId: itemId,
          condition: "AS_NEW",
          restockQty: 1,
          repairQty: 0,
          quarantineQty: 0,
          writeOffQty: 0,
          returnToCustomerQty: 0,
          note: "",
        },
      ],
    });
    row = await testDb.returnRequest.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });
    expect(row.status).toBe("INSPECTED");
    expect(row.items[0]).toMatchObject({
      inspected: true,
      restockQty: 1,
      heldQty: 0,
      condition: "AS_NEW",
    });
    expect(await stockOf(order.variantId)).toEqual({
      stockOnHand: 4,
      reserved: 0,
    });
    const adjustments = await testDb.inventoryAdjustment.findMany({
      where: { orderId: order.orderId },
    });
    expect(
      adjustments.map((a) => [
        a.kind,
        a.delta,
        a.actorId !== null,
        a.auditId !== null,
      ]),
    ).toEqual([["RESTOCK_ON_RETURN", 1, true, true]]);
    const audits = await testDb.adminAuditLog.findMany({
      where: { targetType: "return", targetId: id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => [a.action, a.outcome])).toEqual([
      ["return.inspected", "FAILED"],
      ["return.approved", "SUCCESS"],
      ["return.shipment_recorded", "SUCCESS"],
      ["return.received", "SUCCESS"],
      ["return.inspected", "FAILED"],
      ["return.inspected", "SUCCESS"],
    ]);
    const view = await getReturnView(order.customer, row.requestNumber);
    expect(view?.items[0]?.outcome).toEqual({
      restocked: 1,
      repair: 0,
      quarantine: 0,
      writtenOff: 0,
      returnedToCustomer: 0,
      notReceived: 1,
    });
    // Money untouched.
    expect(await testDb.refund.count()).toBe(0);
  });

  it("holds repair and quarantine units off the shelf and writes off nothing to stock", async () => {
    const order = await deliveredOrder({ sku: "AD-2", stock: 4, quantity: 3 });
    const staff = await verifiedStaff("STAFF");
    const { id, itemId } = await submitted(order, {
      quantity: 3,
      reason: "DAMAGED_ON_ARRIVAL",
    }).catch(async () => {
      const evidence = await verifiedEvidence(order.userId);
      const { requestNumber } = await submitReturnRequest(
        order.customer,
        {
          orderNumber: order.orderNumber,
          operationKey: randomUUID(),
          lines: [
            line(order.orderItemId, {
              quantity: 3,
              reason: "DAMAGED_ON_ARRIVAL",
            }),
          ],
          evidenceIds: [evidence.id],
        },
        "203.0.113.5",
      );
      const row = await testDb.returnRequest.findUniqueOrThrow({
        where: { requestNumber },
        include: { items: true },
      });
      return { requestNumber, id: row.id, itemId: row.items[0]?.id ?? "" };
    });
    await approveReturn(staff.ctx, id, {
      instructions: "We will send a prepaid label by e-mail.",
      note: "",
      items: [{ returnItemId: itemId, approvedQty: 3 }],
    });
    expect(
      (await testDb.returnRequest.findUniqueOrThrow({ where: { id } }))
        .instructionsSnapshot,
    ).toMatchObject({ payer: "SHOP" });
    await receiveReturn(staff.ctx, id, {
      note: "All three arrived.",
      items: [{ returnItemId: itemId, receivedQty: 3 }],
    });
    await inspectReturn(staff.ctx, id, {
      note: "One fine, one to repair, one beyond repair.",
      items: [
        {
          returnItemId: itemId,
          condition: "DAMAGED",
          restockQty: 1,
          repairQty: 1,
          quarantineQty: 0,
          writeOffQty: 1,
          returnToCustomerQty: 0,
          note: "Frame cracked on one.",
        },
      ],
    });
    expect(await stockOf(order.variantId)).toEqual({
      stockOnHand: 2,
      reserved: 0,
    });
    const item = await testDb.returnItem.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(item).toMatchObject({
      restockQty: 1,
      repairQty: 1,
      writeOffQty: 1,
      heldQty: 1,
    });
    expect(
      await testDb.inventoryAdjustment.count({ where: { kind: "WRITE_OFF" } }),
    ).toBe(0);
  });

  it("rejects with a reason and closes; a zero approval is refused", async () => {
    const order = await deliveredOrder({ sku: "AD-3" });
    const staff = await verifiedStaff("STAFF");
    const { id, itemId } = await submitted(order);
    await expect(
      approveReturn(staff.ctx, id, {
        instructions: "Send it back to the studio.",
        note: "",
        items: [{ returnItemId: itemId, approvedQty: 0 }],
      }),
    ).rejects.toBeInstanceOf(ReturnActionError);
    await rejectReturn(
      staff.ctx,
      id,
      "Outside the return window agreed at purchase.",
    );
    const row = await testDb.returnRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      status: "REJECTED",
      rejectionReason: expect.any(String),
    });
    expect(row.closedAt).toBeInstanceOf(Date);
    expect(
      await testDb.notificationOutbox.count({
        where: { kind: "return.rejected" },
      }),
    ).toBe(1);
    await expect(rejectReturn(staff.ctx, id, "Again.")).rejects.toBeInstanceOf(
      ReturnActionError,
    );
  });
});

describe("clocks", () => {
  it("expires unshipped approvals, flags overdue parcels and alerts on overdue decisions, once each", async () => {
    const staff = await verifiedStaff("STAFF");
    const a = await deliveredOrder({ sku: "CL-1", email: "a@example.com" });
    const b = await deliveredOrder({ sku: "CL-2", email: "b@example.com" });
    const c = await deliveredOrder({ sku: "CL-3", email: "c@example.com" });
    const ra = await submitted(a);
    const rb = await submitted(b);
    const rc = await submitted(c);
    await approveReturn(staff.ctx, ra.id, {
      instructions: "Post it back.",
      note: "",
      items: [{ returnItemId: ra.itemId, approvedQty: 1 }],
    });
    await approveReturn(staff.ctx, rb.id, {
      instructions: "Post it back.",
      note: "",
      items: [{ returnItemId: rb.itemId, approvedQty: 1 }],
    });
    await recordReturnShipment(b.customer, rb.requestNumber, {
      carrier: "DTDC",
      trackingNumber: null,
      trackingUrl: null,
    });
    const later = new Date(
      Date.now() + (policy.clocks.receiveByDays + 1) * day,
    );
    const summary = await runExpireReturns({ now: later });
    expect(summary).toMatchObject({
      expired: 1,
      overdue: 1,
      decisionAlerts: 1,
      errors: 0,
    });
    expect(
      (await testDb.returnRequest.findUniqueOrThrow({ where: { id: ra.id } }))
        .status,
    ).toBe("EXPIRED");
    expect(
      (await testDb.returnRequest.findUniqueOrThrow({ where: { id: rb.id } }))
        .status,
    ).toBe("OVERDUE");
    expect(
      (await testDb.returnRequest.findUniqueOrThrow({ where: { id: rc.id } }))
        .status,
    ).toBe("REQUESTED");
    expect(
      await testDb.notificationOutbox.count({
        where: { kind: "return.expired" },
      }),
    ).toBe(1);
    const again = await runExpireReturns({ now: later });
    expect(again).toMatchObject({ expired: 0, overdue: 0, decisionAlerts: 1 });
    expect(
      await testDb.notificationOutbox.count({
        where: {
          dedupeKey: { startsWith: `ops.alert:return-decision-due:${rc.id}` },
        },
      }),
    ).toBe(1);
    // An overdue parcel can still be received.
    await receiveReturn(staff.ctx, rb.id, {
      note: "Arrived late.",
      items: [{ returnItemId: rb.itemId, receivedQty: 1 }],
    });
    expect(
      (await testDb.returnRequest.findUniqueOrThrow({ where: { id: rb.id } }))
        .status,
    ).toBe("RECEIVED");
  });
});

describe("concurrency", () => {
  it("one request per key and per order under concurrent submissions", async () => {
    const order = await deliveredOrder({ sku: "CC-1", quantity: 2 });
    const key = randomUUID();
    const input = (operationKey: string) => ({
      orderNumber: order.orderNumber,
      operationKey,
      lines: [line(order.orderItemId)],
      evidenceIds: [],
    });
    const same = await Promise.all([
      submitReturnRequest(order.customer, input(key), "203.0.113.5"),
      submitReturnRequest(order.customer, input(key), "203.0.113.5"),
    ]);
    expect(new Set(same.map((r) => r.requestNumber)).size).toBe(1);
    expect(await testDb.returnRequest.count()).toBe(1);
    await withdrawReturnRequest(order.customer, same[0]?.requestNumber ?? "");
    const different = await Promise.allSettled([
      submitReturnRequest(order.customer, input(randomUUID()), "203.0.113.5"),
      submitReturnRequest(order.customer, input(randomUUID()), "203.0.113.5"),
    ]);
    expect(different.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await testDb.returnRequest.count({ where: { status: "REQUESTED" } }),
    ).toBe(1);
  });

  it("exactly one of several concurrent inspections restocks", async () => {
    const order = await deliveredOrder({ sku: "CC-2", stock: 5, quantity: 2 });
    const staff = await verifiedStaff("STAFF");
    const { id, itemId } = await submitted(order, { quantity: 2 });
    await approveReturn(staff.ctx, id, {
      instructions: "Post it back.",
      note: "",
      items: [{ returnItemId: itemId, approvedQty: 2 }],
    });
    await receiveReturn(staff.ctx, id, {
      note: "Both here.",
      items: [{ returnItemId: itemId, receivedQty: 2 }],
    });
    const decision = {
      note: "Fine.",
      items: [
        {
          returnItemId: itemId,
          condition: "AS_NEW" as const,
          restockQty: 2,
          repairQty: 0,
          quarantineQty: 0,
          writeOffQty: 0,
          returnToCustomerQty: 0,
          note: "",
        },
      ],
    };
    const results = await Promise.allSettled([
      inspectReturn(staff.ctx, id, decision),
      inspectReturn(staff.ctx, id, decision),
      inspectReturn(staff.ctx, id, decision),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stockOf(order.variantId)).toEqual({
      stockOnHand: 5,
      reserved: 0,
    });
    expect(
      await testDb.inventoryAdjustment.count({
        where: { orderId: order.orderId },
      }),
    ).toBe(1);
  });
});

describe("re-authentication is not required for review", () => {
  it("lets a staff member whose verification is older than the window review returns", async () => {
    const order = await deliveredOrder({ sku: "RA-1" });
    const staff = await verifiedStaff("STAFF", minutesLater(new Date(), -30));
    const { id } = await submitted(order);
    await requestInformation(staff.ctx, id, "Could you send a photo?");
    expect((await getReturnDetail(staff.ctx, id))?.status).toBe(
      "INFO_REQUESTED",
    );
  });
});

describe("errors", () => {
  it("surfaces typed errors with HTTP-like statuses", () => {
    expect(new ReturnError("x", "RETURN_STATE").status).toBe(409);
    expect(
      new ReturnIneligibleError([
        { orderItemId: null, reason: "WINDOW_CLOSED" },
      ]).status,
    ).toBe(422);
  });
});
