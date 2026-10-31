import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as data from "@/features/inventory/data";
import {
  StockUnavailableError,
  commitForOrder,
  consumeOrderHolds,
  releaseOrderHolds,
  reserveForOrder,
} from "@/features/inventory/service";
import { db } from "@/server/db";

import {
  createCategory,
  createProduct,
  createUser,
  createVariant,
  resetDatabase,
  testDb,
} from "./db";

/**
 * Stock movements are conditional single-row updates; these tests prove the
 * last unit is sold once under concurrency and that Inventory.reserved always
 * equals the sum of ACTIVE holds (docs/checkout.md §5.4).
 */

beforeEach(resetDatabase);
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

async function variantWithStock(stockOnHand: number, sku = "STK-1") {
  const category = await createCategory(`c-${sku}`);
  const product = await createProduct(category.id, `p-${sku}`);
  const variant = await createVariant(product.id, sku);
  await testDb.inventory.update({
    where: { variantId: variant.id },
    data: { stockOnHand },
  });
  return variant.id;
}

/** A minimal pending order row to own reservations (placement itself is tested elsewhere). */
async function pendingOrder(suffix: string) {
  const user = await createUser(`buyer-${suffix}@example.com`);
  return testDb.order.create({
    data: {
      orderNumber: `MY-TEST${suffix.padStart(4, "0")}`,
      userId: user.id,
      email: `buyer-${suffix}@example.com`,
      phone: "+919876543210",
      status: "PENDING_PAYMENT",
      paymentMethod: "RAZORPAY",
      subtotalInPaise: 1000,
      shippingInPaise: 0,
      totalInPaise: 1000,
      recipientName: "Asha Devi",
      addressLine1: "12 Station Road",
      city: "Madhubani",
      state: "Bihar",
      postalCode: "847211",
      pendingExpiresAt: inAnHour(),
    },
    select: { id: true },
  });
}

async function levels(variantId: string) {
  const inventory = await testDb.inventory.findUniqueOrThrow({
    where: { variantId },
  });
  const active = await testDb.inventoryReservation.aggregate({
    where: { variantId, status: "ACTIVE" },
    _sum: { quantity: true },
  });
  return {
    stockOnHand: inventory.stockOnHand,
    reserved: inventory.reserved,
    activeHolds: active._sum.quantity ?? 0,
  };
}

describe("reserving for an order", () => {
  it("holds stock, writes the reservations and keeps the counter in step", async () => {
    const variantId = await variantWithStock(5);
    const order = await pendingOrder("1");
    await db.$transaction((tx) =>
      reserveForOrder(tx, order.id, [{ variantId, quantity: 3 }], inAnHour()),
    );
    expect(await levels(variantId)).toEqual({
      stockOnHand: 5,
      reserved: 3,
      activeHolds: 3,
    });
    const hold = await testDb.inventoryReservation.findFirstOrThrow();
    expect(hold).toMatchObject({
      orderId: order.id,
      quantity: 3,
      status: "ACTIVE",
    });
  });

  it("refuses when fewer units are available than asked, rolling everything back", async () => {
    const a = await variantWithStock(5, "A");
    const b = await variantWithStock(1, "B");
    const order = await pendingOrder("2");
    await expect(
      db.$transaction((tx) =>
        reserveForOrder(
          tx,
          order.id,
          [
            { variantId: a, quantity: 2 },
            { variantId: b, quantity: 2 },
          ],
          inAnHour(),
        ),
      ),
    ).rejects.toMatchObject({ code: "STOCK_UNAVAILABLE", variantId: b });
    // The whole transaction rolled back: A was not held either.
    expect(await levels(a)).toEqual({
      stockOnHand: 5,
      reserved: 0,
      activeHolds: 0,
    });
    expect(await testDb.inventoryReservation.count()).toBe(0);
  });

  it("counts existing holds as unavailable", async () => {
    const variantId = await variantWithStock(3);
    const first = await pendingOrder("3");
    const second = await pendingOrder("4");
    await db.$transaction((tx) =>
      reserveForOrder(tx, first.id, [{ variantId, quantity: 2 }], inAnHour()),
    );
    await expect(
      db.$transaction((tx) =>
        reserveForOrder(
          tx,
          second.id,
          [{ variantId, quantity: 2 }],
          inAnHour(),
        ),
      ),
    ).rejects.toBeInstanceOf(StockUnavailableError);
    await db.$transaction((tx) =>
      reserveForOrder(tx, second.id, [{ variantId, quantity: 1 }], inAnHour()),
    );
    expect(await levels(variantId)).toEqual({
      stockOnHand: 3,
      reserved: 3,
      activeHolds: 3,
    });
  });

  it("sells the last unit exactly once under concurrent placements", async () => {
    const variantId = await variantWithStock(1);
    const orders = await Promise.all(
      ["5", "6", "7", "8", "9"].map((suffix) => pendingOrder(suffix)),
    );
    const outcomes = await Promise.allSettled(
      orders.map((order) =>
        db.$transaction((tx) =>
          reserveForOrder(
            tx,
            order.id,
            [{ variantId, quantity: 1 }],
            inAnHour(),
          ),
        ),
      ),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(
      outcomes.filter(
        (o) =>
          o.status === "rejected" && o.reason instanceof StockUnavailableError,
      ),
    ).toHaveLength(4);
    expect(await levels(variantId)).toEqual({
      stockOnHand: 1,
      reserved: 1,
      activeHolds: 1,
    });
  });

  it("never deadlocks when two orders hold the same variants in opposite input order", async () => {
    const a = await variantWithStock(10, "A");
    const b = await variantWithStock(10, "B");
    const first = await pendingOrder("10");
    const second = await pendingOrder("11");
    await Promise.all([
      db.$transaction((tx) =>
        reserveForOrder(
          tx,
          first.id,
          [
            { variantId: a, quantity: 1 },
            { variantId: b, quantity: 1 },
          ],
          inAnHour(),
        ),
      ),
      db.$transaction((tx) =>
        reserveForOrder(
          tx,
          second.id,
          [
            { variantId: b, quantity: 1 },
            { variantId: a, quantity: 1 },
          ],
          inAnHour(),
        ),
      ),
    ]);
    expect((await levels(a)).reserved).toBe(2);
    expect((await levels(b)).reserved).toBe(2);
  });
});

describe("consuming, releasing and committing", () => {
  it("turns holds into sales on confirmation, once", async () => {
    const variantId = await variantWithStock(5);
    const order = await pendingOrder("12");
    await db.$transaction((tx) =>
      reserveForOrder(tx, order.id, [{ variantId, quantity: 2 }], inAnHour()),
    );
    const now = new Date();
    expect(
      await db.$transaction((tx) => consumeOrderHolds(tx, order.id, now)),
    ).toBe(2);
    expect(await levels(variantId)).toEqual({
      stockOnHand: 3,
      reserved: 0,
      activeHolds: 0,
    });
    const hold = await testDb.inventoryReservation.findFirstOrThrow();
    expect(hold).toMatchObject({ status: "CONSUMED", closedAt: now });
    // Idempotent: nothing left to consume.
    expect(
      await db.$transaction((tx) =>
        consumeOrderHolds(tx, order.id, new Date()),
      ),
    ).toBe(0);
    expect((await levels(variantId)).stockOnHand).toBe(3);
  });

  it("gives holds back on release or expiry, once", async () => {
    const variantId = await variantWithStock(5);
    const order = await pendingOrder("13");
    await db.$transaction((tx) =>
      reserveForOrder(tx, order.id, [{ variantId, quantity: 4 }], inAnHour()),
    );
    expect(
      await db.$transaction((tx) =>
        releaseOrderHolds(tx, order.id, new Date(), "EXPIRED"),
      ),
    ).toBe(4);
    expect(await levels(variantId)).toEqual({
      stockOnHand: 5,
      reserved: 0,
      activeHolds: 0,
    });
    expect((await testDb.inventoryReservation.findFirstOrThrow()).status).toBe(
      "EXPIRED",
    );
    expect(
      await db.$transaction((tx) =>
        releaseOrderHolds(tx, order.id, new Date(), "RELEASED"),
      ),
    ).toBe(0);
  });

  it("commits stock outright for cash on delivery and refuses beyond availability", async () => {
    const variantId = await variantWithStock(3);
    const other = await pendingOrder("14");
    await db.$transaction((tx) =>
      reserveForOrder(tx, other.id, [{ variantId, quantity: 2 }], inAnHour()),
    );
    await db.$transaction((tx) =>
      commitForOrder(tx, [{ variantId, quantity: 1 }]),
    );
    expect(await levels(variantId)).toEqual({
      stockOnHand: 2,
      reserved: 2,
      activeHolds: 2,
    });
    await expect(
      db.$transaction((tx) => commitForOrder(tx, [{ variantId, quantity: 1 }])),
    ).rejects.toBeInstanceOf(StockUnavailableError);
  });

  it("rejects an unknown variant rather than inventing stock", async () => {
    const order = await pendingOrder("15");
    await expect(
      db.$transaction((tx) =>
        reserveForOrder(
          tx,
          order.id,
          [{ variantId: "00000000-0000-7000-8000-000000000000", quantity: 1 }],
          inAnHour(),
        ),
      ),
    ).rejects.toBeInstanceOf(StockUnavailableError);
    expect(await data.findInventoryLevels(db, [])).toEqual([]);
  });
});
