import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { ReservationStatus } from "@/generated/prisma/enums";

/**
 * Stock movements as conditional single-row updates (docs/checkout.md §5.4):
 * each returns whether the row qualified, so no read-then-write race exists.
 * Callers run them inside the transaction that changes the matching order and
 * reservation rows, and visit variants in ascending id order (lock order).
 */

type Tx = Prisma.TransactionClient;

/** Holds `quantity` units while a payment is pending. False = not enough available. */
export async function reserveStock(
  tx: Tx,
  variantId: string,
  quantity: number,
): Promise<boolean> {
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE inventory SET reserved = reserved + ${quantity}
     WHERE variant_id = ${variantId}::uuid AND stock_on_hand - reserved >= ${quantity}
  `);
  return count === 1;
}

/** Sells `quantity` units outright (COD, or a late capture re-securing stock). */
export async function commitStock(
  tx: Tx,
  variantId: string,
  quantity: number,
): Promise<boolean> {
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE inventory SET stock_on_hand = stock_on_hand - ${quantity}
     WHERE variant_id = ${variantId}::uuid AND stock_on_hand - reserved >= ${quantity}
  `);
  return count === 1;
}

/** Turns a hold into a sale. */
export async function consumeReserved(
  tx: Tx,
  variantId: string,
  quantity: number,
): Promise<boolean> {
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE inventory
       SET stock_on_hand = stock_on_hand - ${quantity}, reserved = reserved - ${quantity}
     WHERE variant_id = ${variantId}::uuid AND reserved >= ${quantity}
  `);
  return count === 1;
}

/** Gives a hold back. */
export async function releaseReserved(
  tx: Tx,
  variantId: string,
  quantity: number,
): Promise<boolean> {
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE inventory SET reserved = reserved - ${quantity}
     WHERE variant_id = ${variantId}::uuid AND reserved >= ${quantity}
  `);
  return count === 1;
}

export function createReservation(
  tx: Tx,
  input: {
    orderId: string;
    variantId: string;
    quantity: number;
    expiresAt: Date;
  },
) {
  return tx.inventoryReservation.create({
    data: input,
    select: { id: true },
  });
}

export function findActiveReservations(tx: Tx, orderId: string) {
  return tx.inventoryReservation.findMany({
    where: { orderId, status: "ACTIVE" },
    select: { id: true, variantId: true, quantity: true },
    orderBy: { variantId: "asc" },
  });
}

/** Closes one ACTIVE hold; 0 rows means it was already closed. */
export async function closeReservation(
  tx: Tx,
  id: string,
  status: Exclude<ReservationStatus, "ACTIVE">,
  closedAt: Date,
): Promise<boolean> {
  const result = await tx.inventoryReservation.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status, closedAt },
  });
  return result.count === 1;
}

/**
 * Moves `stock_on_hand` by a signed `delta` (A3). False = the row would go
 * below its holds or below zero; nothing is written.
 */
export async function adjustStockOnHand(
  tx: Tx,
  variantId: string,
  delta: number,
): Promise<boolean> {
  const count = await tx.$executeRaw(Prisma.sql`
    UPDATE inventory SET stock_on_hand = stock_on_hand + ${delta}
     WHERE variant_id = ${variantId}::uuid
       AND stock_on_hand + ${delta} >= reserved
       AND stock_on_hand + ${delta} >= 0
  `);
  return count === 1;
}

/** Locks the inventory rows (ascending variant id) and returns their levels. */
export function lockInventoryRows(tx: Tx, variantIds: readonly string[]) {
  if (variantIds.length === 0) return Promise.resolve([]);
  return tx.$queryRaw<
    Array<{ variant_id: string; stock_on_hand: number; reserved: number }>
  >(Prisma.sql`
    SELECT variant_id, stock_on_hand, reserved FROM inventory
     WHERE variant_id = ANY(${[...variantIds]}::uuid[])
     ORDER BY variant_id
       FOR UPDATE
  `);
}

/** Variant facts needed to decide a placement, in lock order. */
export function findInventoryLevels(tx: Tx, variantIds: readonly string[]) {
  return tx.inventory.findMany({
    where: { variantId: { in: [...variantIds] } },
    select: { variantId: true, stockOnHand: true, reserved: true },
    orderBy: { variantId: "asc" },
  });
}
