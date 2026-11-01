import "server-only";

import { getAdminPolicy } from "@/config/admin-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { ProductStatus } from "@/generated/prisma/enums";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { requirePermission } from "../authz";

/** Catalogue reads for the admin (docs/admin.md §5.2), gated like every admin read. */

type Tx = Prisma.TransactionClient;

export const productListSelect = {
  id: true,
  slug: true,
  title: true,
  status: true,
  isFeatured: true,
  isOneOfAKind: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  variants: {
    select: {
      isActive: true,
      inventory: { select: { stockOnHand: true, reserved: true } },
    },
  },
  images: {
    select: { url: true, alt: true },
    orderBy: { position: "asc" },
    take: 1,
  },
} satisfies Prisma.ProductSelect;

export type ProductListRow = Prisma.ProductGetPayload<{
  select: typeof productListSelect;
}>;

export interface ProductListFilters {
  readonly status: ProductStatus | null;
  readonly q: string | null;
  readonly page: number;
}

export async function listProducts(
  ctx: StaffContext,
  filters: ProductListFilters,
  tx: Tx = db,
): Promise<{
  rows: ProductListRow[];
  total: number;
  page: number;
  pageCount: number;
}> {
  await requirePermission(ctx, "admin.view", { tx });
  const pageSize = getAdminPolicy().lists.pageSize;
  const where: Prisma.ProductWhereInput = {};
  if (filters.status) where.status = filters.status;
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { slug: { contains: q.toLowerCase() } },
      { variants: { some: { sku: { contains: q, mode: "insensitive" } } } },
    ];
  }
  const total = await tx.product.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  const rows = await tx.product.findMany({
    where,
    select: productListSelect,
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { rows, total, page, pageCount };
}

export const productEditSelect = {
  id: true,
  slug: true,
  title: true,
  subtitle: true,
  description: true,
  techniques: true,
  constructionMethods: true,
  material: true,
  careInstructions: true,
  categoryId: true,
  status: true,
  publishedAt: true,
  isFeatured: true,
  isOneOfAKind: true,
  hsnCode: true,
  taxRateBp: true,
  metaTitle: true,
  metaDescription: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  options: {
    select: {
      id: true,
      name: true,
      position: true,
      values: {
        select: { id: true, value: true, position: true },
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
      weightGrams: true,
      position: true,
      isActive: true,
      inventory: {
        select: { stockOnHand: true, reserved: true, lowStockThreshold: true },
      },
      optionValues: { select: { optionId: true, optionValueId: true } },
      _count: { select: { orderItems: true, cartItems: true } },
    },
    orderBy: { position: "asc" },
  },
  images: {
    select: {
      id: true,
      url: true,
      publicId: true,
      alt: true,
      width: true,
      height: true,
      position: true,
      variantId: true,
    },
    orderBy: { position: "asc" },
  },
  _count: { select: { wishlistItems: true } },
} satisfies Prisma.ProductSelect;

export type ProductEditRow = Prisma.ProductGetPayload<{
  select: typeof productEditSelect;
}>;

export async function findProductForEdit(
  ctx: StaffContext,
  productId: string,
  tx: Tx = db,
): Promise<ProductEditRow | null> {
  await requirePermission(ctx, "admin.view", { tx });
  return tx.product.findUnique({
    where: { id: productId },
    select: productEditSelect,
  });
}

export const categoryAdminSelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  parentId: true,
  position: true,
  isActive: true,
  _count: { select: { products: true, children: true } },
} satisfies Prisma.CategorySelect;

export type CategoryAdminRow = Prisma.CategoryGetPayload<{
  select: typeof categoryAdminSelect;
}>;

export async function listCategories(
  ctx: StaffContext,
  tx: Tx = db,
): Promise<CategoryAdminRow[]> {
  await requirePermission(ctx, "admin.view", { tx });
  return tx.category.findMany({
    select: categoryAdminSelect,
    orderBy: [
      { parentId: { sort: "asc", nulls: "first" } },
      { position: "asc" },
      { name: "asc" },
    ],
  });
}
