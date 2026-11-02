import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { Technique } from "@/generated/prisma/enums";
import { db } from "@/server/db";

import { escapeLikePattern } from "./rules";
import type { ProductSort } from "./schemas";

/**
 * Catalog data access. Every query uses an explicit `select`, returns bounded
 * result sets, and only ever exposes ACTIVE catalogue products to the
 * storefront (commission products, Phase 8, never appear here).
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
  techniques: true,
  constructionMethods: true,
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

/** Newest first, with deterministic tie-breaks so pagination never repeats or skips. */
const newestOrder: Prisma.ProductOrderByWithRelationInput[] = [
  { publishedAt: "desc" },
  { createdAt: "desc" },
  { id: "asc" },
];

export interface ProductPageFilters {
  readonly categoryIds?: readonly string[];
  readonly q?: string;
  readonly techniques: readonly Technique[];
  readonly minPriceInPaise?: number;
  readonly maxPriceInPaise?: number;
  readonly inStock: boolean;
  readonly sort: ProductSort;
  readonly skip: number;
  readonly take: number;
}

const { sql, join, empty } = Prisma;

/** Full-text document: title weighs most, then subtitle, then description. */
const searchDocument = sql`(
  setweight(to_tsvector('english', p.title), 'A') ||
  setweight(to_tsvector('english', coalesce(p.subtitle, '')), 'B') ||
  setweight(to_tsvector('english', p.description), 'C')
)`;

const minActivePrice = sql`(
  SELECT MIN(v.price_in_paise) FROM product_variants v
  WHERE v.product_id = p.id AND v.is_active
)`;

function orderBy(sort: ProductSort, hasQuery: boolean): Prisma.Sql {
  switch (sort) {
    case "relevance":
      // Without a search term there is no relevance; fall back to newest.
      return hasQuery
        ? sql`ORDER BY rank DESC, p.published_at DESC NULLS LAST, p.id ASC`
        : sql`ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC, p.id ASC`;
    case "newest":
      return sql`ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC, p.id ASC`;
    case "price-asc":
      return sql`ORDER BY ${minActivePrice} ASC NULLS LAST, p.id ASC`;
    case "price-desc":
      return sql`ORDER BY ${minActivePrice} DESC NULLS LAST, p.id ASC`;
    case "title":
      return sql`ORDER BY p.title ASC, p.id ASC`;
  }
}

interface ProductIdRow {
  readonly id: string;
  readonly total: bigint;
}

/**
 * One parameterised query resolves filters, search, ordering and the total
 * count (via a window function); summaries are then loaded by id. Every value
 * is bound as a parameter: nothing from the request is interpolated as SQL.
 */
export async function findProductsPage(filters: ProductPageFilters) {
  const conditions: Prisma.Sql[] = [
    sql`p.status = 'ACTIVE' AND p.kind = 'CATALOGUE'`,
  ];

  if (filters.categoryIds) {
    conditions.push(
      sql`p.category_id = ANY(${[...filters.categoryIds]}::uuid[])`,
    );
  }
  if (filters.techniques.length > 0) {
    conditions.push(
      sql`p.techniques && ${[...filters.techniques]}::"technique"[]`,
    );
  }
  if (
    filters.minPriceInPaise !== undefined ||
    filters.maxPriceInPaise !== undefined
  ) {
    const min = filters.minPriceInPaise ?? 0;
    const max = filters.maxPriceInPaise ?? 2_147_483_647;
    conditions.push(sql`EXISTS (
      SELECT 1 FROM product_variants v
      WHERE v.product_id = p.id AND v.is_active AND v.price_in_paise BETWEEN ${min} AND ${max}
    )`);
  }
  if (filters.inStock) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM product_variants v JOIN inventory i ON i.variant_id = v.id
      WHERE v.product_id = p.id AND v.is_active AND i.stock_on_hand - i.reserved > 0
    )`);
  }

  const hasQuery = filters.q !== undefined;
  const likePattern = hasQuery ? `%${escapeLikePattern(filters.q)}%` : null;
  if (hasQuery) {
    conditions.push(sql`(
      ${searchDocument} @@ websearch_to_tsquery('english', ${filters.q})
      OR p.title ILIKE ${likePattern} ESCAPE '\\'
    )`);
  }

  const rankColumn = hasQuery
    ? sql`, ts_rank(${searchDocument}, websearch_to_tsquery('english', ${filters.q})) AS rank`
    : empty;

  const rows = await db.$queryRaw<ProductIdRow[]>`
    SELECT p.id, COUNT(*) OVER () AS total ${rankColumn}
    FROM products p
    WHERE ${join(conditions, " AND ")}
    ${orderBy(filters.sort, hasQuery)}
    LIMIT ${filters.take} OFFSET ${filters.skip}
  `;

  const total = Number(rows[0]?.total ?? 0);
  const ids = rows.map((row) => row.id);
  const items = await findProductSummariesByIds(ids);
  return { items, total };
}

/** Loads summaries for ids and restores the order given. */
export async function findProductSummariesByIds(ids: readonly string[]) {
  if (ids.length === 0) return [];
  const rows = await db.product.findMany({
    where: { id: { in: [...ids] } },
    select: productSummarySelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/** Techniques actually present among active products in scope, for filter controls. */
export async function findAvailableTechniques(categoryIds?: readonly string[]) {
  const scope = categoryIds
    ? sql`AND p.category_id = ANY(${[...categoryIds]}::uuid[])`
    : empty;
  const rows = await db.$queryRaw<Array<{ technique: Technique }>>`
    SELECT DISTINCT unnest(p.techniques) AS technique
    FROM products p
    WHERE p.status = 'ACTIVE' AND p.kind = 'CATALOGUE' ${scope}
  `;
  return rows.map((row) => row.technique);
}

/**
 * Products that share the category (then the parent category), newest first,
 * never including the product itself. Bounded by `take`.
 */
export async function findRelatedProducts(params: {
  readonly productId: string;
  readonly categoryIds: readonly string[];
  readonly take: number;
}) {
  return db.product.findMany({
    where: {
      status: "ACTIVE",
      kind: "CATALOGUE",
      id: { not: params.productId },
      categoryId: { in: [...params.categoryIds] },
    },
    select: productSummarySelect,
    orderBy: newestOrder,
    take: params.take,
  });
}

export function findActiveProductBySlug(slug: string) {
  return db.product.findFirst({
    where: { slug, status: "ACTIVE", kind: "CATALOGUE" },
    select: productDetailSelect,
  });
}

export function findFeaturedProducts(take: number) {
  return db.product.findMany({
    where: { status: "ACTIVE", kind: "CATALOGUE", isFeatured: true },
    select: productSummarySelect,
    orderBy: newestOrder,
    take,
  });
}

/** Category ids for a category and its direct children, for scoping listings. */
export async function findCategoryScope(categoryId: string) {
  const children = await db.category.findMany({
    where: { parentId: categoryId, isActive: true },
    select: { id: true },
  });
  return [categoryId, ...children.map((child) => child.id)];
}

/** Parent and sibling categories of a product's category, for related products. */
export async function findCategoryFamily(categoryId: string) {
  const category = await db.category.findUnique({
    where: { id: categoryId },
    select: { id: true, parentId: true },
  });
  if (!category) return [categoryId];
  if (category.parentId === null) return [categoryId];
  const siblings = await db.category.findMany({
    where: { parentId: category.parentId, isActive: true },
    select: { id: true },
  });
  return [
    categoryId,
    ...siblings.map((sibling) => sibling.id).filter((id) => id !== categoryId),
  ];
}
