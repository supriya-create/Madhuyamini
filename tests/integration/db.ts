import { createPrismaClient } from "@/server/prisma-client";

import { resolveTestDatabaseUrl } from "./test-database";

/** Direct client for arranging fixtures and asserting on rows. */
export const testDb = createPrismaClient(resolveTestDatabaseUrl());

/** Empties every table. Order does not matter: CASCADE follows the foreign keys. */
export async function resetDatabase(): Promise<void> {
  await testDb.$executeRaw`
    TRUNCATE TABLE
      reviews, inventory, product_variant_values, product_variants,
      product_option_values, product_options, product_images, products,
      categories, addresses, users
    RESTART IDENTITY CASCADE
  `;
}

/** Minimal valid rows for tests that only need "a product" or "a user". */
export async function createCategory(slug = "test-category") {
  return testDb.category.create({
    data: { slug, name: slug },
    select: { id: true },
  });
}

export async function createProduct(categoryId: string, slug = "test-product") {
  return testDb.product.create({
    data: {
      slug,
      title: slug,
      description: "Integration test product",
      techniques: ["HAND_PAINTED"],
      categoryId,
      status: "ACTIVE",
    },
    select: { id: true },
  });
}

export async function createVariant(
  productId: string,
  sku = "TEST-SKU-1",
  priceInPaise = 100_000,
) {
  return testDb.productVariant.create({
    data: {
      productId,
      sku,
      priceInPaise,
      inventory: { create: { stockOnHand: 5 } },
    },
    select: { id: true },
  });
}

export async function createUser(email = "customer@example.com") {
  return testDb.user.create({
    data: { email, name: "Test Customer" },
    select: { id: true },
  });
}
