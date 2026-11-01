import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  adjustInventory,
  getLevelDetail,
  getLevels,
  setLowStockThreshold,
} from "@/features/admin/inventory/service";
import { AdjustmentRefusedError } from "@/features/inventory/service";
import { db } from "@/server/db";

import {
  createCategory,
  createProduct,
  createVariant,
  resetDatabase,
  testDb,
} from "./db";
import { placeTestOrder, stockOf } from "./order-fixtures";
import { verifiedStaff } from "./staff";

/** Audited stock adjustments and levels (docs/admin.md §5.3, A3). */

beforeEach(resetDatabase);
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

describe("adjustments", () => {
  it("records received stock, corrections and write-offs with before/after, actor and audit id", async () => {
    const staff = await verifiedStaff("STAFF");
    const category = await createCategory();
    const product = await createProduct(category.id);
    const variant = await createVariant(product.id, "INV-1");
    expect(await stockOf(variant.id)).toEqual({ stockOnHand: 5, reserved: 0 });

    const received = await adjustInventory(staff.ctx, variant.id, {
      kind: "RECEIVED",
      delta: 10,
      reason: "Delivery from the workshop.",
    });
    expect(received).toEqual({ stockBefore: 5, stockAfter: 15 });
    await adjustInventory(staff.ctx, variant.id, {
      kind: "CORRECTION",
      delta: -1,
      reason: "Count found 14.",
    });
    await adjustInventory(staff.ctx, variant.id, {
      kind: "WRITE_OFF",
      delta: -2,
      reason: "Water damage.",
    });
    expect(await stockOf(variant.id)).toEqual({ stockOnHand: 12, reserved: 0 });

    const detail = await getLevelDetail(staff.ctx, variant.id);
    expect(detail?.level).toMatchObject({
      stockOnHand: 12,
      available: 12,
      lowStock: false,
    });
    expect(
      detail?.history.map((h) => [
        h.kind,
        h.delta,
        h.stockBefore,
        h.stockAfter,
        h.actor,
      ]),
    ).toEqual([
      ["WRITE_OFF", -2, 14, 12, "Test STAFF"],
      ["CORRECTION", -1, 15, 14, "Test STAFF"],
      ["RECEIVED", 10, 5, 15, "Test STAFF"],
    ]);
    const audits = await testDb.adminAuditLog.findMany({
      where: { action: "inventory.adjust" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.outcome)).toEqual([
      "SUCCESS",
      "SUCCESS",
      "SUCCESS",
    ]);
    const rows = await testDb.inventoryAdjustment.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.auditId)).toEqual(audits.map((a) => a.id));
    expect(rows.every((r) => r.actorId === staff.user.id)).toBe(true);
  });

  it("never lets stock fall below the units held for pending orders, and audits the refusal", async () => {
    const staff = await verifiedStaff("STAFF");
    const placed = await placeTestOrder("RAZORPAY", {
      sku: "INV-2",
      stock: 3,
      quantity: 2,
    });
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 3,
      reserved: 2,
    });
    await expect(
      adjustInventory(staff.ctx, placed.variantId, {
        kind: "WRITE_OFF",
        delta: -2,
        reason: "Damaged.",
      }),
    ).rejects.toBeInstanceOf(AdjustmentRefusedError);
    await expect(
      adjustInventory(staff.ctx, placed.variantId, {
        kind: "WRITE_OFF",
        delta: -2,
        reason: "Damaged.",
      }),
    ).rejects.toThrow(/2 unit\(s\) of INV-2 are held/);
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 3,
      reserved: 2,
    });
    expect(await testDb.inventoryAdjustment.count()).toBe(0);
    const audits = await testDb.adminAuditLog.findMany({
      where: { action: "inventory.adjust" },
    });
    expect(audits.map((a) => [a.outcome, a.errorCode])).toEqual([
      ["FAILED", "INVENTORY_ADJUSTMENT_REFUSED"],
      ["FAILED", "INVENTORY_ADJUSTMENT_REFUSED"],
    ]);
    // Down to exactly the held units is allowed.
    await adjustInventory(staff.ctx, placed.variantId, {
      kind: "WRITE_OFF",
      delta: -1,
      reason: "One damaged.",
    });
    expect(await stockOf(placed.variantId)).toEqual({
      stockOnHand: 2,
      reserved: 2,
    });
  });

  it("lists levels with the low-stock filter and updates thresholds", async () => {
    const staff = await verifiedStaff("STAFF");
    const category = await createCategory();
    const product = await createProduct(category.id);
    const a = await createVariant(product.id, "INV-A");
    const b = await createVariant(product.id, "INV-B");
    await testDb.inventory.update({
      where: { variantId: b.id },
      data: { stockOnHand: 1 },
    });

    const all = await getLevels(staff.ctx, {
      lowStockOnly: false,
      q: null,
      page: 1,
    });
    expect(all.items.map((i) => [i.sku, i.available, i.lowStock])).toEqual([
      ["INV-A", 5, false],
      ["INV-B", 1, true],
    ]);
    const low = await getLevels(staff.ctx, {
      lowStockOnly: true,
      q: null,
      page: 1,
    });
    expect(low.items.map((i) => i.sku)).toEqual(["INV-B"]);
    const search = await getLevels(staff.ctx, {
      lowStockOnly: false,
      q: "inv-a",
      page: 1,
    });
    expect(search.items.map((i) => i.sku)).toEqual(["INV-A"]);

    await setLowStockThreshold(staff.ctx, a.id, 10);
    const after = await getLevels(staff.ctx, {
      lowStockOnly: true,
      q: null,
      page: 1,
    });
    expect(after.items.map((i) => i.sku)).toEqual(["INV-A", "INV-B"]);
    const audit = await testDb.adminAuditLog.findFirstOrThrow({
      where: { action: "inventory.threshold" },
    });
    expect(audit).toMatchObject({
      outcome: "SUCCESS",
      before: { lowStockThreshold: 2 },
      after: { lowStockThreshold: 10 },
    });
  });
});
