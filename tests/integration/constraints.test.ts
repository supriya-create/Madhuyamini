import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createCategory,
  createProduct,
  createUser,
  createVariant,
  resetDatabase,
  testDb,
} from "./db";

/**
 * The database enforces the invariants the application relies on, so a bug
 * in any code path (or a manual SQL edit) cannot corrupt stock, prices or
 * ratings. These tests exercise the hand-written constraints in the migration.
 */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

describe("inventory", () => {
  // Both constraints reject a negative value; PostgreSQL reports whichever it checks first.
  it("rejects negative stock on hand", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const variant = await createVariant(product.id);

    await expect(
      testDb.inventory.update({
        where: { variantId: variant.id },
        data: { stockOnHand: -1 },
      }),
    ).rejects.toThrow(/inventory_(stock_non_negative|reserved_within_stock)/);
  });

  it("rejects reservations above stock on hand", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const variant = await createVariant(product.id);

    await expect(
      testDb.inventory.update({
        where: { variantId: variant.id },
        data: { reserved: 6 },
      }),
    ).rejects.toThrow(/inventory_reserved_within_stock/);
    await expect(
      testDb.inventory.update({
        where: { variantId: variant.id },
        data: { reserved: -1 },
      }),
    ).rejects.toThrow(/inventory_reserved_non_negative/);
  });

  it("allows a conditional decrement only while stock remains", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const variant = await createVariant(product.id);

    const decrement = () =>
      testDb.inventory.updateMany({
        where: { variantId: variant.id, stockOnHand: { gte: 3 } },
        data: { stockOnHand: { decrement: 3 } },
      });

    expect((await decrement()).count).toBe(1);
    expect((await decrement()).count).toBe(0);
    const row = await testDb.inventory.findUniqueOrThrow({
      where: { variantId: variant.id },
    });
    expect(row.stockOnHand).toBe(2);
  });
});

describe("product variants", () => {
  it("rejects a zero or negative price", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);

    await expect(createVariant(product.id, "FREE", 0)).rejects.toThrow(
      /product_variants_price_positive/,
    );
  });

  it("rejects a struck-through price that is not above the selling price", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);

    await expect(
      testDb.productVariant.create({
        data: {
          productId: product.id,
          sku: "X",
          priceInPaise: 1000,
          compareAtPriceInPaise: 1000,
        },
      }),
    ).rejects.toThrow(/product_variants_compare_at_above_price/);
  });

  it("enforces unique SKUs", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    await createVariant(product.id, "DUP");

    await expect(createVariant(product.id, "DUP")).rejects.toThrow(
      /Unique constraint/,
    );
  });
});

describe("product images", () => {
  it("requires non-blank alt text and real dimensions", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);

    await expect(
      testDb.productImage.create({
        data: {
          productId: product.id,
          url: "https://img.example/a.jpg",
          alt: "   ",
          width: 1,
          height: 1,
        },
      }),
    ).rejects.toThrow(/product_images_alt_not_blank/);
    await expect(
      testDb.productImage.create({
        data: {
          productId: product.id,
          url: "https://img.example/a.jpg",
          alt: "Saree",
          width: 0,
          height: 10,
        },
      }),
    ).rejects.toThrow(/product_images_dimensions_positive/);
  });
});

describe("reviews", () => {
  it("keeps ratings between 1 and 5 and one review per customer per product", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const user = await createUser();
    const review = (rating: number) =>
      testDb.review.create({
        data: { productId: product.id, userId: user.id, rating, body: "ok" },
      });

    await expect(review(0)).rejects.toThrow(/reviews_rating_range/);
    await expect(review(6)).rejects.toThrow(/reviews_rating_range/);
    await expect(review(5)).resolves.toMatchObject({
      status: "PENDING",
      isVerifiedPurchase: false,
    });
    await expect(review(4)).rejects.toThrow(/Unique constraint/);
  });
});

describe("users and addresses", () => {
  it("stores emails only in normalised form and uniquely", async () => {
    await expect(createUser("Mixed.Case@Example.com")).rejects.toThrow(
      /users_email_lower_case/,
    );
    await createUser("asha@example.com");
    await expect(createUser("asha@example.com")).rejects.toThrow(
      /Unique constraint/,
    );
  });

  it("allows at most one default address per user", async () => {
    const user = await createUser();
    const address = (isDefault: boolean, line1: string) =>
      testDb.address.create({
        data: {
          userId: user.id,
          recipientName: "Asha Devi",
          phone: "+919876543210",
          line1,
          city: "Madhubani",
          state: "Bihar",
          postalCode: "847211",
          isDefault,
        },
      });

    await address(true, "1 Station Road");
    await address(false, "2 Station Road");
    await expect(address(true, "3 Station Road")).rejects.toThrow(
      /Unique constraint/,
    );
  });

  it("validates Indian PIN codes but not foreign postal codes", async () => {
    const user = await createUser();
    const base = {
      userId: user.id,
      recipientName: "Asha Devi",
      phone: "+919876543210",
      line1: "1 Station Road",
      city: "Madhubani",
      state: "Bihar",
    };

    await expect(
      testDb.address.create({ data: { ...base, postalCode: "0123" } }),
    ).rejects.toThrow(/addresses_postal_code_format/);
    await expect(
      testDb.address.create({
        data: { ...base, postalCode: "SW1A 1AA", country: "GB" },
      }),
    ).resolves.toBeTruthy();
  });
});

describe("categories", () => {
  it("cannot be their own parent", async () => {
    const category = await createCategory();
    await expect(
      testDb.category.update({
        where: { id: category.id },
        data: { parentId: category.id },
      }),
    ).rejects.toThrow(/categories_parent_not_self/);
  });
});
