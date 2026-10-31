import "server-only";

import { cache } from "react";

import { Prisma } from "@/generated/prisma/client";
import { availableStock } from "@/features/catalog/rules";
import { AppError, NotFoundError } from "@/server/errors";
import { hashCartToken } from "@/server/cart/token";
import type { CartContext } from "@/server/cart/context";
import { db } from "@/server/db";

import * as data from "./data";
import type { CartLineRow, CartRow } from "./data";
import {
  MAX_LINE_QUANTITY,
  canCheckout,
  cartItemCount,
  cartSubtotal,
  clampQuantity,
  guestCartExpiry,
  lineAvailability,
  priceChanged,
} from "./rules";
import type { AddToCartResult, CartLineView, CartView } from "./types";

/**
 * Cart services. Every operation re-reads product status, variant status,
 * live price and availability from the database (requirement 6) and never
 * accepts a price or stock figure from the caller.
 */

export class CartItemUnavailableError extends AppError {
  constructor(reason: "unavailable" | "sold_out") {
    super(
      reason === "sold_out"
        ? "This piece is sold out."
        : "This piece is no longer available.",
      { code: `CART_ITEM_${reason.toUpperCase()}`, status: 409 },
    );
  }
}

const EMPTY_CART: CartView = {
  id: null,
  lines: [],
  itemCount: 0,
  subtotalInPaise: 0,
  canCheckout: false,
  hasAvailabilityIssues: false,
  hasPriceChanges: false,
};

function toLineView(row: CartLineRow): CartLineView {
  const available = availableStock(row.variant.inventory);
  const availability = lineAvailability({
    productActive: row.variant.product.status === "ACTIVE",
    variantActive: row.variant.isActive,
    available,
    quantity: row.quantity,
  });
  const unitPriceInPaise = row.variant.priceInPaise;
  const maxQuantity =
    availability === "unavailable"
      ? 0
      : clampQuantity(Number.MAX_SAFE_INTEGER, {
          available,
          isOneOfAKind: row.variant.product.isOneOfAKind,
        }).quantity;
  return {
    id: row.id,
    quantity: row.quantity,
    product: {
      id: row.variant.product.id,
      slug: row.variant.product.slug,
      title: row.variant.product.title,
      isOneOfAKind: row.variant.product.isOneOfAKind,
      image: row.variant.product.images[0] ?? null,
    },
    variant: {
      id: row.variant.id,
      sku: row.variant.sku,
      title: row.variant.title,
    },
    unitPriceInPaise,
    priceSeenInPaise: row.priceSeenInPaise,
    priceChanged: priceChanged(row.priceSeenInPaise, unitPriceInPaise),
    lineTotalInPaise: unitPriceInPaise * row.quantity,
    available,
    availability,
    maxQuantity,
  };
}

export function toCartView(cart: CartRow | null): CartView {
  if (!cart) return EMPTY_CART;
  const lines = cart.items.map(toLineView);
  return {
    id: cart.id,
    lines,
    itemCount: cartItemCount(lines),
    subtotalInPaise: cartSubtotal(lines),
    canCheckout: canCheckout(lines),
    hasAvailabilityIssues: lines.some((line) => line.availability !== "ok"),
    hasPriceChanges: lines.some((line) => line.priceChanged),
  };
}

/**
 * The cart for this request, or null. Never creates anything. Memoised per
 * request so the header count and the cart page share one query.
 */
export const findCart = cache(
  async (context: CartContext): Promise<CartRow | null> => {
    switch (context.kind) {
      case "user":
        return data.findActiveUserCart(context.userId);
      case "guest":
        return data.findActiveGuestCart(hashCartToken(context.token));
      case "anonymous":
        return null;
    }
  },
);

export async function getCartView(context: CartContext): Promise<CartView> {
  return toCartView(await findCart(context));
}

export async function getCartItemCount(context: CartContext): Promise<number> {
  const cart = await findCart(context);
  return cart ? cartItemCount(cart.items) : 0;
}

/** Finds or creates the cart for a context that is able to own one. */
async function ensureCart(
  context: Exclude<CartContext, { kind: "anonymous" }>,
  now: Date,
) {
  if (context.kind === "user") {
    const existing = await data.findActiveUserCart(context.userId);
    if (existing) return existing;
    try {
      return await data.createUserCart(context.userId);
    } catch (error) {
      // Two concurrent first adds: the partial unique index lets exactly one win.
      if (isUniqueViolation(error)) {
        const winner = await data.findActiveUserCart(context.userId);
        if (winner) return winner;
      }
      throw error;
    }
  }
  const tokenHash = hashCartToken(context.token);
  const existing = await data.findActiveGuestCart(tokenHash, now);
  if (existing) return existing;
  // The cookie may outlive its cart (expired, merged); free the hash first.
  await data.releaseGuestToken(tokenHash, now);
  return data.createGuestCart(tokenHash, guestCartExpiry(now));
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function touch(cart: CartRow, now: Date) {
  await data.touchCart(cart.id, now, cart.userId ? null : guestCartExpiry(now));
}

export async function addToCart(
  context: Exclude<CartContext, { kind: "anonymous" }>,
  input: { variantId: string; quantity: number },
  now = new Date(),
): Promise<AddToCartResult> {
  const variant = await data.findVariantForCart(input.variantId);
  if (!variant || !variant.isActive || variant.product.status !== "ACTIVE") {
    throw new CartItemUnavailableError("unavailable");
  }
  const available = availableStock(variant.inventory);
  if (available <= 0) throw new CartItemUnavailableError("sold_out");

  const cart = await ensureCart(context, now);

  // Read-modify-write under a row lock, so two quick taps add twice rather
  // than losing one.
  return db.$transaction(async (tx) => {
    await data.lockCart(cart.id, tx);
    const existing = await data.findLineByVariant(cart.id, variant.id, tx);
    const existingQuantity = existing?.quantity ?? 0;
    const clamped = clampQuantity(existingQuantity + input.quantity, {
      available,
      isOneOfAKind: variant.product.isOneOfAKind,
    });
    const quantityAdded = Math.max(0, clamped.quantity - existingQuantity);

    if (clamped.quantity > 0 && clamped.quantity !== existingQuantity) {
      await data.upsertLine(
        cart.id,
        variant.id,
        clamped.quantity,
        variant.priceInPaise,
        tx,
      );
    }
    await data.touchCart(
      cart.id,
      now,
      cart.userId ? null : guestCartExpiry(now),
      tx,
    );
    return {
      quantityAdded,
      quantityInCart: clamped.quantity,
      limitedBy: clamped.limitedBy,
      itemCount: await data.countUnits(cart.id, tx),
    };
  });
}

export async function updateLine(
  context: CartContext,
  input: { lineId: string; quantity: number },
  now = new Date(),
): Promise<void> {
  const cart = await findCart(context);
  if (!cart) throw new NotFoundError("Cart line");
  const line = await data.findLine(cart.id, input.lineId);
  if (!line) throw new NotFoundError("Cart line");

  if (input.quantity === 0) {
    await data.deleteLine(cart.id, line.id);
  } else {
    const view = toLineView(line);
    const quantity = Math.min(input.quantity, Math.max(view.maxQuantity, 0));
    if (quantity === 0)
      throw new CartItemUnavailableError(
        view.availability === "unavailable" ? "unavailable" : "sold_out",
      );
    await data.updateLineQuantity(cart.id, line.id, quantity);
  }
  await touch(cart, now);
}

export async function removeLine(
  context: CartContext,
  lineId: string,
  now = new Date(),
): Promise<void> {
  const cart = await findCart(context);
  if (!cart) throw new NotFoundError("Cart line");
  const result = await data.deleteLine(cart.id, lineId);
  if (result.count === 0) throw new NotFoundError("Cart line");
  await touch(cart, now);
}

/** C5: the customer has seen the new price; stop showing the notice. */
export async function acknowledgePrice(
  context: CartContext,
  lineId: string,
): Promise<void> {
  const cart = await findCart(context);
  if (!cart) throw new NotFoundError("Cart line");
  const line = await data.findLine(cart.id, lineId);
  if (!line) throw new NotFoundError("Cart line");
  await data.updateLinePriceSeen(cart.id, line.id, line.variant.priceInPaise);
}

/**
 * C6 / requirement 5: moves a guest cart into the customer's cart. Runs in
 * one transaction and is idempotent: the guest cart is claimed with an
 * atomic status change, so a repeated or concurrent call does nothing.
 * Lines are never discarded; quantities are capped by the rules.
 */
export interface MergeResult {
  readonly merged: boolean;
  readonly lines: number;
  /** Lines whose quantity had to be reduced to fit the limits or stock. */
  readonly adjusted: number;
}

export async function mergeGuestCartIntoUser(
  userId: string,
  guestToken: string,
  now = new Date(),
): Promise<MergeResult> {
  const tokenHash = hashCartToken(guestToken);

  return db.$transaction(async (tx) => {
    const guest = await data.findActiveGuestCart(tokenHash, now, tx);
    if (!guest) return { merged: false, lines: 0, adjusted: 0 };
    // A cart with an order awaiting payment is the order's; leave it alone
    // (docs/checkout.md §5.7). The pending order shows up under the account.
    if (await hasLiveOrder(guest.id, tx))
      return { merged: false, lines: 0, adjusted: 0 };

    const claimed = await data.claimGuestCartForMerge(guest.id, tx);
    if (claimed.count === 0) return { merged: false, lines: 0, adjusted: 0 };

    const target =
      (await data.findActiveUserCart(userId, tx)) ??
      (await data.createUserCart(userId, tx));
    await data.lockCart(target.id, tx);
    if (await hasLiveOrder(target.id, tx))
      return { merged: false, lines: 0, adjusted: 0 };

    let adjusted = 0;
    for (const line of guest.items) {
      const existing = target.items.find(
        (candidate) => candidate.variant.id === line.variant.id,
      );
      const existingQuantity = existing?.quantity ?? 0;
      const purchasable =
        line.variant.isActive && line.variant.product.status === "ACTIVE";
      const available = availableStock(line.variant.inventory);
      const hardCap = line.variant.product.isOneOfAKind ? 1 : MAX_LINE_QUANTITY;

      // C6: sum, then apply the limits and current availability. A line is
      // never dropped: at least one unit stays so the cart can flag it.
      const wanted = Math.min(existingQuantity + line.quantity, hardCap);
      const quantity =
        purchasable && available > 0
          ? Math.max(1, Math.min(wanted, available))
          : Math.max(1, wanted);
      if (quantity < existingQuantity + line.quantity) adjusted += 1;

      await data.upsertLine(
        target.id,
        line.variant.id,
        quantity,
        existing?.priceSeenInPaise ?? line.priceSeenInPaise,
        tx,
      );
    }

    await data.touchCart(target.id, now, null, tx);
    return { merged: true, lines: guest.items.length, adjusted };
  });
}

async function hasLiveOrder(
  cartId: string,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const count = await tx.order.count({
    where: { cartId, status: { not: "CANCELLED" } },
  });
  return count > 0;
}

export const cleanupCarts = data.expireGuestCarts;
