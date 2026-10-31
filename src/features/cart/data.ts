import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

/**
 * Cart data access. Carts are looked up only by the verified user id or by
 * the hashed guest token; lines are always addressed together with their
 * cart id, so one cart can never touch another's lines.
 */

export const cartLineSelect = {
  id: true,
  quantity: true,
  priceSeenInPaise: true,
  addedAt: true,
  variant: {
    select: {
      id: true,
      sku: true,
      title: true,
      priceInPaise: true,
      isActive: true,
      inventory: { select: { stockOnHand: true, reserved: true } },
      product: {
        select: {
          id: true,
          slug: true,
          title: true,
          status: true,
          isOneOfAKind: true,
          images: {
            select: {
              url: true,
              alt: true,
              width: true,
              height: true,
              variantId: true,
            },
            orderBy: { position: "asc" },
            take: 1,
          },
        },
      },
    },
  },
} satisfies Prisma.CartItemSelect;

export type CartLineRow = Prisma.CartItemGetPayload<{
  select: typeof cartLineSelect;
}>;

const cartSelect = {
  id: true,
  userId: true,
  status: true,
  expiresAt: true,
  items: { select: cartLineSelect, orderBy: { addedAt: "asc" } },
} satisfies Prisma.CartSelect;

export type CartRow = Prisma.CartGetPayload<{ select: typeof cartSelect }>;

type Tx = Prisma.TransactionClient;

export function findActiveUserCart(userId: string, tx: Tx = db) {
  return tx.cart.findFirst({
    where: { userId, status: "ACTIVE" },
    select: cartSelect,
  });
}

export function findActiveGuestCart(
  tokenHash: string,
  now = new Date(),
  tx: Tx = db,
) {
  return tx.cart.findFirst({
    where: { tokenHash, status: "ACTIVE", expiresAt: { gt: now } },
    select: cartSelect,
  });
}

export function createUserCart(userId: string, tx: Tx = db) {
  return tx.cart.create({ data: { userId }, select: cartSelect });
}

export function createGuestCart(
  tokenHash: string,
  expiresAt: Date,
  tx: Tx = db,
) {
  return tx.cart.create({ data: { tokenHash, expiresAt }, select: cartSelect });
}

/** C2: every valid activity pushes a guest cart's expiry forward. */
export function touchCart(
  cartId: string,
  activityAt: Date,
  expiresAt: Date | null,
  tx: Tx = db,
) {
  return tx.cart.update({
    where: { id: cartId },
    data: { lastActivityAt: activityAt, ...(expiresAt ? { expiresAt } : {}) },
    select: { id: true },
  });
}

/** Everything the server needs to decide whether and how much can be added. */
export function findVariantForCart(variantId: string, tx: Tx = db) {
  return tx.productVariant.findUnique({
    where: { id: variantId },
    select: {
      id: true,
      priceInPaise: true,
      isActive: true,
      inventory: { select: { stockOnHand: true, reserved: true } },
      product: { select: { status: true, isOneOfAKind: true } },
    },
  });
}

/** Row lock for read-modify-write on a cart's lines (transactions only). */
export async function lockCart(cartId: string, tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT id FROM carts WHERE id = ${cartId}::uuid FOR UPDATE`;
}

export function findLineByVariant(
  cartId: string,
  variantId: string,
  tx: Tx = db,
) {
  return tx.cartItem.findUnique({
    where: { cartId_variantId: { cartId, variantId } },
    select: { id: true, quantity: true },
  });
}

/** Units across every line, for the header badge. */
export async function countUnits(cartId: string, tx: Tx = db): Promise<number> {
  const result = await tx.cartItem.aggregate({
    where: { cartId },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

export function findLine(cartId: string, lineId: string, tx: Tx = db) {
  return tx.cartItem.findFirst({
    where: { id: lineId, cartId },
    select: cartLineSelect,
  });
}

export function upsertLine(
  cartId: string,
  variantId: string,
  quantity: number,
  priceSeenInPaise: number,
  tx: Tx = db,
) {
  return tx.cartItem.upsert({
    where: { cartId_variantId: { cartId, variantId } },
    create: { cartId, variantId, quantity, priceSeenInPaise },
    update: { quantity },
    select: { id: true, quantity: true },
  });
}

export function updateLineQuantity(
  cartId: string,
  lineId: string,
  quantity: number,
  tx: Tx = db,
) {
  return tx.cartItem.updateMany({
    where: { id: lineId, cartId },
    data: { quantity },
  });
}

export function updateLinePriceSeen(
  cartId: string,
  lineId: string,
  priceSeenInPaise: number,
  tx: Tx = db,
) {
  return tx.cartItem.updateMany({
    where: { id: lineId, cartId },
    data: { priceSeenInPaise },
  });
}

export function deleteLine(cartId: string, lineId: string, tx: Tx = db) {
  return tx.cartItem.deleteMany({ where: { id: lineId, cartId } });
}

/**
 * Frees a token hash still held by a cart that can no longer be used (expired,
 * merged or abandoned), so the same cookie can start a fresh cart.
 */
export async function releaseGuestToken(
  tokenHash: string,
  now: Date,
  tx: Tx = db,
) {
  await tx.cart.updateMany({
    where: { tokenHash, status: "ACTIVE", expiresAt: { lte: now } },
    data: { status: "ABANDONED", tokenHash: null },
  });
  await tx.cart.updateMany({
    where: { tokenHash, status: { not: "ACTIVE" } },
    data: { tokenHash: null },
  });
}

/** Atomically claims a guest cart for merging; 0 rows means it was already handled. */
export function claimGuestCartForMerge(cartId: string, tx: Tx) {
  return tx.cart.updateMany({
    where: { id: cartId, status: "ACTIVE" },
    data: { status: "MERGED" },
  });
}

/** Closes guest carts whose expiry has passed. */
export async function expireGuestCarts(now = new Date()) {
  const result = await db.cart.updateMany({
    where: { status: "ACTIVE", userId: null, expiresAt: { lt: now } },
    data: { status: "ABANDONED" },
  });
  return result.count;
}
