import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";

import { createUser, resetDatabase, testDb } from "./db";
import { deliveredOrder } from "./returns-fixtures";

/**
 * Migration 20261102210000_phase8_returns invariants
 * (docs/phase-8-returns-custom-artwork.md §7.2, §7.6): quantity bounds,
 * inspection sums, exchange and deduction rules, ownership of uploads and
 * their folders, one open request per order, closed timestamps, append-only
 * events and messages, and the runtime role's privileges.
 */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

async function base() {
  const order = await deliveredOrder({ sku: "SCH-1", quantity: 2 });
  const request = (
    overrides: Partial<Prisma.ReturnRequestUncheckedCreateInput> = {},
  ): Prisma.ReturnRequestUncheckedCreateInput => ({
    requestNumber: `RT-${randomUUID()
      .slice(0, 8)
      .toUpperCase()
      .replace(/[01IL]/g, "A")}`,
    orderId: order.orderId,
    userId: order.userId,
    status: "REQUESTED",
    operationKey: randomUUID(),
    policySnapshot: {},
    createdAt: new Date(Date.now() - 5 * 60_000),
    ...overrides,
  });
  const item = (
    requestId: string,
    overrides: Partial<Prisma.ReturnItemUncheckedCreateInput> = {},
  ): Prisma.ReturnItemUncheckedCreateInput => ({
    returnRequestId: requestId,
    orderItemId: order.orderItemId,
    variantId: order.variantId,
    requestedQty: 1,
    reason: "SIZE_OR_FIT",
    ...overrides,
  });
  return { order, request, item };
}

describe("return_requests", () => {
  it("needs an owner and a closed timestamp only when closed", async () => {
    const { request } = await base();
    await expect(
      testDb.returnRequest.create({ data: request({ userId: null }) }),
    ).rejects.toThrow(/return_requests_has_owner/);
    await expect(
      testDb.returnRequest.create({ data: request({ status: "REJECTED" }) }),
    ).rejects.toThrow(/return_requests_closed_has_timestamp/);
    await expect(
      testDb.returnRequest.create({ data: request({ closedAt: new Date() }) }),
    ).rejects.toThrow(/return_requests_closed_has_timestamp/);
    await expect(
      testDb.returnRequest.create({
        data: request({ decisionDueAt: new Date(Date.now() - 10 * 60_000) }),
      }),
    ).rejects.toThrow(/return_requests_clocks_after_creation/);
  });

  it("allows one open request per order, however many closed ones", async () => {
    const { request } = await base();
    await testDb.returnRequest.create({
      data: request({ status: "WITHDRAWN", closedAt: new Date() }),
    });
    await testDb.returnRequest.create({ data: request() });
    await expect(
      testDb.returnRequest.create({ data: request({ status: "APPROVED" }) }),
    ).rejects.toMatchObject({ code: "P2002" });
    await testDb.returnRequest.create({
      data: request({ status: "REJECTED", closedAt: new Date() }),
    });
    expect(await testDb.returnRequest.count()).toBe(3);
  });
});

describe("return_items", () => {
  it("bounds every quantity and ties received to approved", async () => {
    const { request, item } = await base();
    const req = await testDb.returnRequest.create({
      data: request(),
      select: { id: true },
    });
    await expect(
      testDb.returnItem.create({ data: item(req.id, { requestedQty: 0 }) }),
    ).rejects.toThrow(/return_items_quantities_bounded/);
    await expect(
      testDb.returnItem.create({
        data: item(req.id, { requestedQty: 1, approvedQty: 2 }),
      }),
    ).rejects.toThrow(/return_items_quantities_bounded/);
    await expect(
      testDb.returnItem.create({
        data: item(req.id, { requestedQty: 2, receivedQty: 1 }),
      }),
    ).rejects.toThrow(/return_items_quantities_bounded/);
    await expect(
      testDb.returnItem.create({
        data: item(req.id, { requestedQty: 2, approvedQty: 2, receivedQty: 3 }),
      }),
    ).rejects.toThrow(/return_items_quantities_bounded/);
    await expect(
      testDb.returnItem.create({ data: item(req.id, { restockQty: -1 }) }),
    ).rejects.toThrow(/return_items_quantities_bounded/);
  });

  it("requires inspection decisions to add up, an exchange to name a variant, and deductions to follow the rules", async () => {
    const { request, item, order } = await base();
    const req = await testDb.returnRequest.create({
      data: request(),
      select: { id: true },
    });
    await expect(
      testDb.returnItem.create({
        data: item(req.id, {
          requestedQty: 2,
          approvedQty: 2,
          receivedQty: 2,
          inspected: true,
          restockQty: 1,
        }),
      }),
    ).rejects.toThrow(/return_items_inspection_sums/);
    await expect(
      testDb.returnItem.create({
        data: item(req.id, { resolutionPreference: "EXCHANGE" }),
      }),
    ).rejects.toThrow(/return_items_exchange_names_variant/);
    await expect(
      testDb.returnItem.create({
        data: item(req.id, { deductionInPaise: 100 }),
      }),
    ).rejects.toThrow(/return_items_deduction_rules/);
    await expect(
      testDb.returnItem.create({
        data: item(req.id, {
          reason: "DAMAGED_ON_ARRIVAL",
          deductionInPaise: 100,
          deductionReason: "scratched",
        }),
      }),
    ).rejects.toThrow(/return_items_deduction_rules/);
    await testDb.returnItem.create({
      data: item(req.id, {
        resolutionPreference: "EXCHANGE",
        exchangeVariantId: order.variantId,
      }),
    });
    await expect(
      testDb.returnItem.create({ data: item(req.id) }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("return_shipments and customer_uploads", () => {
  it("accepts https tracking links only, and uploads with an issuer inside our folders only", async () => {
    const { request } = await base();
    const req = await testDb.returnRequest.create({
      data: request(),
      select: { id: true },
    });
    await expect(
      testDb.returnShipment.create({
        data: {
          returnRequestId: req.id,
          carrier: "DTDC",
          trackingUrl: "http://example.com/track",
          shippedAt: new Date(),
          recordedBy: "CUSTOMER",
        },
      }),
    ).rejects.toThrow(/return_shipments_tracking_url_https/);
    const user = await createUser("u@example.com");
    await expect(
      testDb.customerUpload.create({
        data: {
          purpose: "RETURN_EVIDENCE",
          publicId: "madhuyamini/returns/x/1",
          folder: "madhuyamini/returns/x",
        },
      }),
    ).rejects.toThrow(/customer_uploads_has_issuer/);
    await expect(
      testDb.customerUpload.create({
        data: {
          purpose: "RETURN_EVIDENCE",
          ownerUserId: user.id,
          publicId: "madhuyamini/products/x/1",
          folder: "madhuyamini/products/x",
        },
      }),
    ).rejects.toThrow(/customer_uploads_folder_scoped/);
    await expect(
      testDb.customerUpload.create({
        data: {
          purpose: "RETURN_EVIDENCE",
          ownerUserId: user.id,
          publicId: "madhuyamini/returns/x/2",
          folder: "madhuyamini/returns/x",
          bytes: -1,
        },
      }),
    ).rejects.toThrow(/customer_uploads_facts_non_negative/);
  });
});

describe("append-only tables and the runtime role", () => {
  it("refuses updates and deletes of events and messages, even for the owner role", async () => {
    const { request } = await base();
    const req = await testDb.returnRequest.create({
      data: request(),
      select: { id: true },
    });
    const event = await testDb.returnEvent.create({
      data: {
        returnRequestId: req.id,
        type: "return.requested",
        actor: "CUSTOMER",
      },
      select: { id: true },
    });
    const message = await testDb.returnMessage.create({
      data: { returnRequestId: req.id, author: "CUSTOMER", body: "Hello" },
      select: { id: true },
    });
    await expect(
      testDb.returnEvent.update({
        where: { id: event.id },
        data: { note: "x" },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      testDb.returnEvent.delete({ where: { id: event.id } }),
    ).rejects.toThrow(/append-only/);
    await expect(
      testDb.returnMessage.update({
        where: { id: message.id },
        data: { body: "x" },
      }),
    ).rejects.toThrow(/append-only/);
  });

  it("denies the runtime role UPDATE and DELETE on the append-only tables", async () => {
    const { request } = await base();
    const req = await testDb.returnRequest.create({
      data: request(),
      select: { id: true },
    });
    await testDb.returnMessage.create({
      data: { returnRequestId: req.id, author: "CUSTOMER", body: "Hello" },
    });
    await expect(
      testDb.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE madhuyamini_app`;
        await tx.$executeRaw`DELETE FROM return_messages`;
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      testDb.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL ROLE madhuyamini_app`;
        await tx.$executeRaw`UPDATE return_events SET note = 'x'`;
      }),
    ).rejects.toThrow(/permission denied/);
    // Inserts and reads remain possible for the application.
    await testDb.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE madhuyamini_app`;
      await tx.$executeRaw`INSERT INTO return_messages (id, return_request_id, author, body) VALUES (gen_random_uuid(), ${req.id}::uuid, 'STAFF', 'Reply')`;
    });
    expect(await testDb.returnMessage.count()).toBe(2);
  });
});
