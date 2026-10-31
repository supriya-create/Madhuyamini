import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

import type { ProductSort } from "./schemas";

/**
 * Catalog data access. Every query uses an explicit `select`, returns bounded
 * result sets, and only ever exposes ACTIVE products to the storefront.
 */

const categorySummarySelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
} satisfies Prisma.CategorySelect;

const imageSelect = {
  url: true,
  alt: true,
  width: true,
  height: true,
  variantId: true,
} satisfies Prisma.ProductImageSelect;

const inventorySelect = {
  stockOnHand: true,
  reserved: true,
  lowStockThreshold: true,
} satisfies Prisma.InventorySelect;

const productSummarySelect = {
  id: true,
  slug: true,
  title: true,
  subtitle: true,
  technique: true,
  isOneOfAKind: true,
  category: { select: { slug: true, name: true } },
  images: { select: imageSelect, orderBy: { position: "asc" }, take: 1 },
  variants: {
    select: {
      priceInPaise: true,
      isActive: true,
      inventory: { select: inventorySelect },
    },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.ProductSelect;

const productDetailSelect = {
  ...productSummarySelect,
  description: true,
  material: true,
  careInstructions: true,
  metaTitle: true,
  metaDescription: true,
  images: { select: imageSelect, orderBy: { position: "asc" } },
  options: {
    select: {
      id: true,
      name: true,
      values: {
        select: { id: true, value: true },
        orderBy: { position: "asc" },
      },
    },
    orderBy: { position: "asc" },
  },
  variants: {
    select: {
      id: true,
      sku: true,
      title: true,
      priceInPaise: true,
      compareAtPriceInPaise: true,
      isActive: true,
      inventory: { select: inventorySelect },
      optionValues: {
        select: { optionValueId: true, option: { select: { position: true } } },
        orderBy: { option: { position: "asc" } },
      },
    },
    orderBy: { position: "asc" },
  },
} satisfies Prisma.ProductSelect;

export type CategorySummaryRow = Prisma.CategoryGetPayload<{
  select: typeof categorySummarySelect;
}>;
export type ProductSummaryRow = Prisma.ProductGetPayload<{
  select: typeof productSummarySelect;
}>;
export type ProductDetailRow = Prisma.ProductGetPayload<{
  select: typeof productDetailSelect;
}>;

const activeCategoryChildren = {
  where: { isActive: true },
  select: categorySummarySelect,
  orderBy: { position: "asc" },
} satisfies Prisma.Category$childrenArgs;

export function findCategoryTree() {
  return db.category.findMany({
    where: { isActive: true, parentId: null },
    select: { ...categorySummarySelect, children: activeCategoryChildren },
    orderBy: { position: "asc" },
  });
}

export function findCategoryBySlug(slug: string) {
  return db.category.findFirst({
    where: { slug, isActive: true },
    select: {
      ...categorySummarySelect,
      parent: { select: categorySummarySelect },
      children: activeCategoryChildren,
    },
  });
}

const sortOrder: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> =
  {
    newest: [{ publishedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    title: [{ title: "asc" }, { id: "asc" }],
  };

export interface ProductPageQuery {
  readonly categoryIds?: readonly string[];
  readonly sort: ProductSort;
  readonly skip: number;
  readonly take: number;
}

export async function findProductsPage(query: ProductPageQuery) {
  const where: Prisma.ProductWhereInput = {
    status: "ACTIVE",
    ...(query.categoryIds
      ? { categoryId: { in: [...query.categoryIds] } }
      : {}),
  };

  const [items, total] = await db.$transaction([
    db.product.findMany({
      where,
      select: productSummarySelect,
      orderBy: sortOrder[query.sort],
      skip: query.skip,
      take: query.take,
    }),
    db.product.count({ where }),
  ]);

  return { items, total };
}

export function findActiveProductBySlug(slug: string) {
  return db.product.findFirst({
    where: { slug, status: "ACTIVE" },
    select: productDetailSelect,
  });
}

export function findFeaturedProducts(take: number) {
  return db.product.findMany({
    where: { status: "ACTIVE", isFeatured: true },
    select: productSummarySelect,
    orderBy: sortOrder.newest,
    take,
  });
}
