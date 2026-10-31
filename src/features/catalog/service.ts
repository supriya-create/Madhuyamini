import "server-only";

import { cache } from "react";

import { parseOrThrow } from "@/lib/validation";
import { NotFoundError } from "@/server/errors";

import * as data from "./data";
import type { ProductDetailRow, ProductSummaryRow } from "./data";
import {
  availableStock,
  isPurchasable,
  priceRange,
  stockStatus,
} from "./rules";
import {
  featuredLimitSchema,
  productListQuerySchema,
  relatedLimitSchema,
  slugSchema,
} from "./schemas";
import type {
  CategoryDetail,
  CategoryNode,
  ProductDetail,
  ProductPage,
  ProductSummary,
} from "./types";

/**
 * Storefront-facing catalog reads. Inputs are validated here, so callers can
 * pass untrusted values (route params, search params) straight through.
 */

export function getCategoryTree(): Promise<CategoryNode[]> {
  return data.findCategoryTree();
}

export async function getCategoryBySlug(
  input: unknown,
): Promise<CategoryDetail> {
  const slug = parseOrThrow(slugSchema, input);
  const category = await data.findCategoryBySlug(slug);
  if (!category) throw new NotFoundError("Category");
  return category;
}

export async function listProducts(input: unknown): Promise<ProductPage> {
  const query = parseOrThrow(productListQuerySchema, input);

  let category: CategoryDetail | null = null;
  let categoryIds: string[] | undefined;
  if (query.category) {
    category = await getCategoryBySlug(query.category);
    categoryIds = [category.id, ...category.children.map((child) => child.id)];
  }

  const [{ items, total }, availableTechniques] = await Promise.all([
    data.findProductsPage({
      categoryIds,
      q: query.q,
      techniques: query.techniques,
      minPriceInPaise: query.minPriceInPaise,
      maxPriceInPaise: query.maxPriceInPaise,
      inStock: query.inStock,
      sort: query.sort,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    data.findAvailableTechniques(categoryIds),
  ]);

  return {
    items: items.map(toProductSummary),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
    category,
    filters: {
      q: query.q ?? null,
      techniques: query.techniques,
      minPriceInPaise: query.minPriceInPaise ?? null,
      maxPriceInPaise: query.maxPriceInPaise ?? null,
      inStock: query.inStock,
      sort: query.sort,
    },
    availableTechniques: [...availableTechniques].sort(),
  };
}

export const getProductBySlug = cache(
  async (input: unknown): Promise<ProductDetail> => {
    const slug = parseOrThrow(slugSchema, input);
    const product = await data.findActiveProductBySlug(slug);
    if (!product) throw new NotFoundError("Product");
    return toProductDetail(product);
  },
);

/** Other active products from the same category, then its siblings. */
export async function getRelatedProducts(
  product: Pick<ProductDetail, "id" | "category">,
  limit = 4,
): Promise<ProductSummary[]> {
  const take = parseOrThrow(relatedLimitSchema, limit);
  const category = await data.findCategoryBySlug(product.category.slug);
  if (!category) return [];

  const sameCategory = await data.findRelatedProducts({
    productId: product.id,
    categoryIds: [category.id],
    take,
  });
  if (sameCategory.length >= take) return sameCategory.map(toProductSummary);

  const family = await data.findCategoryFamily(category.id);
  const wider = await data.findRelatedProducts({
    productId: product.id,
    categoryIds: family,
    take,
  });
  return wider.map(toProductSummary);
}

export async function getFeaturedProducts(
  limit = 8,
): Promise<ProductSummary[]> {
  const take = parseOrThrow(featuredLimitSchema, limit);
  const rows = await data.findFeaturedProducts(take);
  return rows.map(toProductSummary);
}

// ---- Mapping -------------------------------------------------------------

export function toProductSummary(row: ProductSummaryRow): ProductSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    techniques: row.techniques,
    constructionMethods: row.constructionMethods,
    isOneOfAKind: row.isOneOfAKind,
    category: row.category,
    image: row.images[0] ?? null,
    price: priceRange(row.variants),
    inStock: row.variants.some(
      (variant) => variant.isActive && availableStock(variant.inventory) > 0,
    ),
  };
}

function toProductDetail(row: ProductDetailRow): ProductDetail {
  return {
    ...toProductSummary(row),
    description: row.description,
    material: row.material,
    careInstructions: row.careInstructions,
    images: row.images,
    options: row.options,
    variants: row.variants.map((variant) => {
      const available = availableStock(variant.inventory);
      return {
        id: variant.id,
        sku: variant.sku,
        title: variant.title,
        priceInPaise: variant.priceInPaise,
        compareAtPriceInPaise: variant.compareAtPriceInPaise,
        isActive: variant.isActive,
        optionValueIds: variant.optionValues.map(
          (value) => value.optionValueId,
        ),
        available,
        stockStatus: stockStatus(
          available,
          variant.inventory?.lowStockThreshold ?? 0,
        ),
        isPurchasable: isPurchasable(variant, available),
      };
    }),
    seo: {
      title: row.metaTitle ?? row.title,
      description: row.metaDescription ?? row.subtitle,
    },
  };
}
