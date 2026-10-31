import "server-only";

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

  const { items, total } = await data.findProductsPage({
    categoryIds,
    sort: query.sort,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });

  return {
    items: items.map(toProductSummary),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
    category,
  };
}

export async function getProductBySlug(input: unknown): Promise<ProductDetail> {
  const slug = parseOrThrow(slugSchema, input);
  const product = await data.findActiveProductBySlug(slug);
  if (!product) throw new NotFoundError("Product");
  return toProductDetail(product);
}

export async function getFeaturedProducts(
  limit = 8,
): Promise<ProductSummary[]> {
  const take = parseOrThrow(featuredLimitSchema, limit);
  const rows = await data.findFeaturedProducts(take);
  return rows.map(toProductSummary);
}

// ---- Mapping -------------------------------------------------------------

function toProductSummary(row: ProductSummaryRow): ProductSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    technique: row.technique,
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
