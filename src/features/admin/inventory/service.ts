import "server-only";

import type { InventoryAdjustmentKind } from "@/generated/prisma/enums";
import {
  AdjustmentRefusedError,
  applyAdjustment,
} from "@/features/inventory/service";
import type { StaffContext } from "@/server/auth/staff";
import { NotFoundError } from "@/server/errors";

import { runAudited } from "../audit";
import { findLevel, listLevels } from "./data";
import type { AdjustmentRow, LevelFilters, LevelRow } from "./data";

/**
 * Inventory operations (docs/admin.md §5.3, A3). Every stock movement is
 * an audited adjustment through the shared `applyAdjustment`; `reserved`
 * is never edited here.
 */

export interface LevelView {
  readonly variantId: string;
  readonly sku: string;
  readonly variantTitle: string | null;
  readonly isActive: boolean;
  readonly priceInPaise: number;
  readonly productId: string;
  readonly productTitle: string;
  readonly productStatus: string;
  readonly stockOnHand: number;
  readonly reserved: number;
  readonly available: number;
  readonly lowStockThreshold: number;
  readonly lowStock: boolean;
  readonly updatedAt: Date | null;
}

function toLevelView(row: LevelRow): LevelView {
  const stockOnHand = row.inventory?.stockOnHand ?? 0;
  const reserved = row.inventory?.reserved ?? 0;
  const threshold = row.inventory?.lowStockThreshold ?? 0;
  return {
    variantId: row.id,
    sku: row.sku,
    variantTitle: row.title,
    isActive: row.isActive,
    priceInPaise: row.priceInPaise,
    productId: row.product.id,
    productTitle: row.product.title,
    productStatus: row.product.status,
    stockOnHand,
    reserved,
    available: stockOnHand - reserved,
    lowStockThreshold: threshold,
    lowStock: stockOnHand - reserved <= threshold,
    updatedAt: row.inventory?.updatedAt ?? null,
  };
}

export async function getLevels(
  ctx: StaffContext,
  filters: LevelFilters,
): Promise<{
  items: LevelView[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const result = await listLevels(ctx, filters);
  return { ...result, items: result.rows.map(toLevelView) };
}

export interface AdjustmentView {
  readonly id: string;
  readonly kind: InventoryAdjustmentKind;
  readonly delta: number;
  readonly stockBefore: number;
  readonly stockAfter: number;
  readonly reservedAtTime: number;
  readonly reason: string;
  readonly actor: string;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly at: Date;
}

export async function getLevelDetail(
  ctx: StaffContext,
  variantId: string,
): Promise<{ level: LevelView; history: AdjustmentView[] } | null> {
  const found = await findLevel(ctx, variantId);
  if (!found) return null;
  const history = found.adjustments.map(
    (row: AdjustmentRow): AdjustmentView => ({
      id: row.id,
      kind: row.kind,
      delta: row.delta,
      stockBefore: row.stockBefore,
      stockAfter: row.stockAfter,
      reservedAtTime: row.reservedAtTime,
      reason: row.reason,
      actor: row.actorId
        ? (found.actors.get(row.actorId) ?? "staff")
        : "system",
      orderId: row.orderId,
      orderNumber: row.orderId ? (found.orders.get(row.orderId) ?? null) : null,
      at: row.createdAt,
    }),
  );
  return { level: toLevelView(found.level), history };
}

export type ManualAdjustmentKind = Extract<
  InventoryAdjustmentKind,
  "RECEIVED" | "CORRECTION" | "WRITE_OFF"
>;

export async function adjustInventory(
  ctx: StaffContext,
  variantId: string,
  input: {
    readonly kind: ManualAdjustmentKind;
    readonly delta: number;
    readonly reason: string;
  },
  now = new Date(),
): Promise<{ stockBefore: number; stockAfter: number }> {
  return runAudited(
    {
      ctx,
      action: "inventory.adjust",
      targetType: "inventory",
      targetId: variantId,
      capability: "inventory.adjust",
      reason: input.reason,
      now,
    },
    async (tx, audit) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: {
          id: true,
          sku: true,
          inventory: { select: { reserved: true } },
        },
      });
      if (!variant) throw new NotFoundError("Variant");
      try {
        const result = await applyAdjustment(tx, {
          variantId,
          kind: input.kind,
          delta: input.delta,
          reason: input.reason,
          actorId: ctx.user.id,
          auditId: audit.id,
        });
        return {
          result: {
            stockBefore: result.stockBefore,
            stockAfter: result.stockAfter,
          },
          before: {
            variantId,
            stockBefore: result.stockBefore,
            reservedAtTime: result.reserved,
          },
          after: {
            variantId,
            kind: input.kind,
            delta: input.delta,
            stockBefore: result.stockBefore,
            stockAfter: result.stockAfter,
            reservedAtTime: result.reserved,
          },
        };
      } catch (error) {
        if (error instanceof AdjustmentRefusedError) {
          const held = variant.inventory?.reserved ?? 0;
          throw new AdjustmentRefusedError(
            variantId,
            held > 0
              ? `${error.message} ${held} unit(s) of ${variant.sku} are held by pending orders.`
              : error.message,
          );
        }
        throw error;
      }
    },
  );
}

export async function setLowStockThreshold(
  ctx: StaffContext,
  variantId: string,
  threshold: number,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "inventory.threshold",
      targetType: "inventory",
      targetId: variantId,
      capability: "inventory.adjust",
      now,
    },
    async (tx) => {
      const current = await tx.inventory.findUnique({
        where: { variantId },
        select: { lowStockThreshold: true },
      });
      if (!current) throw new NotFoundError("Inventory");
      await tx.inventory.update({
        where: { variantId },
        data: { lowStockThreshold: threshold },
      });
      return {
        result: undefined,
        before: { variantId, lowStockThreshold: current.lowStockThreshold },
        after: { variantId, lowStockThreshold: threshold },
      };
    },
  );
}
