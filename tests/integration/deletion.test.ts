import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createCategory,
  createProduct,
  createUser,
  createVariant,
  resetDatabase,
  testDb,
} from "./db";

/** Deletion behaviour as documented in docs/data-model.md §3. */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

async function productWithEverything() {
  const category = await createCategory();
  const product = await createProduct(category.id);
  const option = await testDb.productOption.create({
    data: {
      productId: product.id,
      name: "Size",
      values: { create: { value: "M" } },
    },
    select: { id: true, values: { select: { id: true } } },
  });
  const valueId = option.values[0]?.id;
  if (!valueId) throw new Error("expected an option value");
  const variant = await createVariant(product.id);
  await testDb.productVariantValue.create({
    data: {
      variantId: variant.id,
      optionId: option.id,
      optionValueId: valueId,
    },
  });
  const image = await testDb.productImage.create({
    data: {
      productId: product.id,
      variantId: variant.id,
      url: "https://img.example/a.jpg",
      alt: "Saree",
      width: 10,
      height: 10,
    },
    select: { id: true },
  });
  const user = await createUser();
  await testDb.review.create({
    data: { productId: product.id, userId: user.id, rating: 5, body: "Lovely" },
  });
  return { category, product, option, valueId, variant, image, user };
}

describe("product deletion", () => {
  it("cascades to images, options, values, variants, inventory, links and reviews", async () => {
    const { product } = await productWithEverything();

    await testDb.product.delete({ where: { id: product.id } });

    expect(await testDb.productImage.count()).toBe(0);
    expect(await testDb.productOption.count()).toBe(0);
    expect(await testDb.productOptionValue.count()).toBe(0);
    expect(await testDb.productVariant.count()).toBe(0);
    expect(await testDb.productVariantValue.count()).toBe(0);
    expect(await testDb.inventory.count()).toBe(0);
    expect(await testDb.review.count()).toBe(0);
    // Customers and categories are untouched.
    expect(await testDb.user.count()).toBe(1);
    expect(await testDb.category.count()).toBe(1);
  });
});

describe("variant deletion", () => {
  it("removes inventory and links but keeps the image as a product image", async () => {
    const { variant, image } = await productWithEverything();

    await testDb.productVariant.delete({ where: { id: variant.id } });

    expect(await testDb.inventory.count()).toBe(0);
    expect(await testDb.productVariantValue.count()).toBe(0);
    const kept = await testDb.productImage.findUniqueOrThrow({
      where: { id: image.id },
    });
    expect(kept.variantId).toBeNull();
  });
});

describe("restricted deletions", () => {
  it("refuses to delete a category that still has products", async () => {
    const { category } = await productWithEverything();
    await expect(
      testDb.category.delete({ where: { id: category.id } }),
    ).rejects.toThrow(/Foreign key constraint/);
  });

  it("refuses to delete a parent category that still has children", async () => {
    const parent = await createCategory("parent");
    await testDb.category.create({
      data: { slug: "child", name: "Child", parentId: parent.id },
    });
    await expect(
      testDb.category.delete({ where: { id: parent.id } }),
    ).rejects.toThrow(/Foreign key constraint/);
  });

  it("refuses to delete an option value that a variant uses", async () => {
    const { valueId } = await productWithEverything();
    await expect(
      testDb.productOptionValue.delete({ where: { id: valueId } }),
    ).rejects.toThrow(/Foreign key constraint/);
  });
});

describe("user deletion", () => {
  it("removes the customer's addresses and reviews", async () => {
    const { user } = await productWithEverything();
    await testDb.address.create({
      data: {
        userId: user.id,
        recipientName: "Asha Devi",
        phone: "+919876543210",
        line1: "1 Station Road",
        city: "Madhubani",
        state: "Bihar",
        postalCode: "847211",
      },
    });

    await testDb.user.delete({ where: { id: user.id } });

    expect(await testDb.address.count()).toBe(0);
    expect(await testDb.review.count()).toBe(0);
    expect(await testDb.product.count()).toBe(1);
  });
});
