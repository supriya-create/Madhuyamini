import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createCategory,
  createProduct,
  createVariant,
  resetDatabase,
  testDb,
} from "./db";

/**
 * Stock holds (Phase 6 uses them for pending online payments). These tests
 * pin the schema-level rules so checkout can rely on them: positive
 * quantities, closed_at tracking status, holds blocking variant deletion,
 * and the expiry sweep keeping Inventory.reserved consistent.
 */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

async function variantWithStock(stockOnHand = 5) {
  const category = await createCategory();
  const product = await createProduct(category.id);
  const variant = await createVariant(product.id);
  await testDb.inventory.update({
    where: { variantId: variant.id },
    data: { stockOnHand },
  });
  return variant;
}

describe("inventory reservations", () => {
  it("requires a positive quantity", async () => {
    const variant = await variantWithStock();
    await expect(
      testDb.inventoryReservation.create({
        data: { variantId: variant.id, quantity: 0, expiresAt: inAnHour() },
      }),
    ).rejects.toThrow(/inventory_reservations_quantity_positive/);
  });

  it("keeps closed_at in step with the status", async () => {
    const variant = await variantWithStock();
    await expect(
      testDb.inventoryReservation.create({
        data: {
          variantId: variant.id,
          quantity: 1,
          expiresAt: inAnHour(),
          closedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/inventory_reservations_closed_at_matches_status/);
    await expect(
      testDb.inventoryReservation.create({
        data: {
          variantId: variant.id,
          quantity: 1,
          expiresAt: inAnHour(),
          status: "RELEASED",
        },
      }),
    ).rejects.toThrow(/inventory_reservations_closed_at_matches_status/);
  });

  it("blocks deleting a variant that still has holds", async () => {
    const variant = await variantWithStock();
    await testDb.inventoryReservation.create({
      data: { variantId: variant.id, quantity: 1, expiresAt: inAnHour() },
    });
    await expect(
      testDb.productVariant.delete({ where: { id: variant.id } }),
    ).rejects.toThrow(/Foreign key constraint/);
  });

  it("expiry sweep releases overdue holds and returns their units to stock", async () => {
    const variant = await variantWithStock(5);
    await testDb.inventoryReservation.createMany({
      data: [
        { variantId: variant.id, quantity: 2, expiresAt: anHourAgo() },
        { variantId: variant.id, quantity: 1, expiresAt: inAnHour() },
      ],
    });
    await testDb.inventory.update({
      where: { variantId: variant.id },
      data: { reserved: 3 },
    });

    // The pattern Phase 6 will run on a schedule: close overdue holds and
    // release their quantity, both inside one transaction.
    const now = new Date();
    await testDb.$transaction(async (tx) => {
      const overdue = await tx.inventoryReservation.findMany({
        where: { status: "ACTIVE", expiresAt: { lt: now } },
        select: { id: true, variantId: true, quantity: true },
      });
      for (const hold of overdue) {
        await tx.inventoryReservation.update({
          where: { id: hold.id },
          data: { status: "EXPIRED", closedAt: now },
        });
        await tx.inventory.update({
          where: { variantId: hold.variantId },
          data: { reserved: { decrement: hold.quantity } },
        });
      }
    });

    const inventory = await testDb.inventory.findUniqueOrThrow({
      where: { variantId: variant.id },
    });
    expect(inventory).toMatchObject({ stockOnHand: 5, reserved: 1 });
    const activeTotal = await testDb.inventoryReservation.aggregate({
      where: { variantId: variant.id, status: "ACTIVE" },
      _sum: { quantity: true },
    });
    expect(activeTotal._sum.quantity).toBe(inventory.reserved);
  });
});
