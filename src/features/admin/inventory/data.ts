import "server-only";

import { getAdminPolicy } from "@/config/admin-policy";
import { Prisma } from "@/generated/prisma/client";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { requirePermission } from "../authz";

/** Inventory reads (docs/admin.md §5.3), gated like every admin read. */

type Tx = Prisma.TransactionClient;

export const levelSelect = {
  id: true,
  sku: true,
  title: true,
  isActive: true,
  position: true,
  priceInPaise: true,
  product: { select: { id: true, title: true, slug: true, status: true } },
  inventory: {
    select: {
      stockOnHand: true,
      reserved: true,
      lowStockThreshold: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ProductVariantSelect;

export type LevelRow = Prisma.ProductVariantGetPayload<{
  select: typeof levelSelect;
}>;

export interface LevelFilters {
  readonly lowStockOnly: boolean;
  readonly q: string | null;
  readonly page: number;
}

export async function listLevels(
  ctx: StaffContext,
  filters: LevelFilters,
  tx: Tx = db,
): Promise<{
  rows: LevelRow[];
  total: number;
  page: number;
  pageCount: number;
}> {
  await requirePermission(ctx, "admin.view", { tx });
  const pageSize = getAdminPolicy().lists.pageSize;
  const where: Prisma.ProductVariantWhereInput = {};
  if (filters.lowStockOnly) {
    const low = await tx.$queryRaw<Array<{ variant_id: string }>>(Prisma.sql`
      SELECT variant_id FROM inventory
       WHERE stock_on_hand - reserved <= low_stock_threshold
    `);
    where.id = { in: low.map((row) => row.variant_id) };
  }
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { sku: { contains: q, mode: "insensitive" } },
      { product: { title: { contains: q, mode: "insensitive" } } },
    ];
  }
  const total = await tx.productVariant.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  const rows = await tx.productVariant.findMany({
    where,
    select: levelSelect,
    orderBy: [
      { product: { title: "asc" } },
      { position: "asc" },
      { sku: "asc" },
    ],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { rows, total, page, pageCount };
}

export const adjustmentSelect = {
  id: true,
  kind: true,
  delta: true,
  stockBefore: true,
  stockAfter: true,
  reservedAtTime: true,
  reason: true,
  actorId: true,
  orderId: true,
  auditId: true,
  createdAt: true,
} satisfies Prisma.InventoryAdjustmentSelect;

export type AdjustmentRow = Prisma.InventoryAdjustmentGetPayload<{
  select: typeof adjustmentSelect;
}>;

export async function findLevel(
  ctx: StaffContext,
  variantId: string,
  tx: Tx = db,
): Promise<{
  level: LevelRow;
  adjustments: AdjustmentRow[];
  actors: Map<string, string>;
  orders: Map<string, string>;
} | null> {
  await requirePermission(ctx, "admin.view", { tx });
  const level = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: levelSelect,
  });
  if (!level) return null;
  const adjustments = await tx.inventoryAdjustment.findMany({
    where: { variantId },
    select: adjustmentSelect,
    orderBy: { createdAt: "desc" },
    take: getAdminPolicy().lists.maxPageSize,
  });
  const actorIds = [
    ...new Set(
      adjustments.map((a) => a.actorId).filter((id): id is string => !!id),
    ),
  ];
  const orderIds = [
    ...new Set(
      adjustments.map((a) => a.orderId).filter((id): id is string => !!id),
    ),
  ];
  const [users, orders] = await Promise.all([
    actorIds.length
      ? tx.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [],
    orderIds.length
      ? tx.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNumber: true },
        })
      : [],
  ]);
  return {
    level,
    adjustments,
    actors: new Map(users.map((u) => [u.id, u.name])),
    orders: new Map(orders.map((o) => [o.id, o.orderNumber])),
  };
}
