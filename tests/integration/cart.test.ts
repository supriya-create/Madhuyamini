import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as cartData from "@/features/cart/data";
import { GUEST_CART_LIFETIME_MS } from "@/features/cart/rules";
import {
  CartItemUnavailableError,
  addToCart,
  acknowledgePrice,
  cleanupCarts,
  getCartItemCount,
  getCartView,
  mergeGuestCartIntoUser,
  removeLine,
  updateLine,
} from "@/features/cart/service";
import { generateCartToken, hashCartToken } from "@/server/cart/token";
import type { CartContext } from "@/server/cart/context";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";

import {
  createCategory,
  createProduct,
  createUser,
  createVariant,
  resetDatabase,
  testDb,
} from "./db";

/**
 * Cart service against the real database: the C1–C6 rules, ownership,
 * live prices (C5), flagged lines, the guest→account merge and cleanup.
 */

beforeEach(resetDatabase);
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

type OwnedContext = Exclude<CartContext, { kind: "anonymous" }>;
const guest = (token = generateCartToken()): OwnedContext => ({
  kind: "guest",
  token,
});
const asUser = (userId: string): OwnedContext => ({ kind: "user", userId });

async function catalog() {
  const category = await createCategory();
  const product = await createProduct(category.id, "dupatta");
  const variant = await createVariant(product.id, "DUP-1", 189_900);
  return { category, product, variant };
}

async function setStock(variantId: string, stockOnHand: number, reserved = 0) {
  await testDb.inventory.update({
    where: { variantId },
    data: { stockOnHand, reserved },
  });
}

describe("adding to a guest cart", () => {
  it("creates the cart under the hashed token only, with a 30-day expiry and the live price", async () => {
    const { variant } = await catalog();
    const token = generateCartToken();
    const now = new Date("2026-11-01T10:00:00Z");

    const result = await addToCart(
      guest(token),
      { variantId: variant.id, quantity: 2 },
      now,
    );
    expect(result).toEqual({
      quantityAdded: 2,
      quantityInCart: 2,
      limitedBy: null,
      itemCount: 2,
    });

    const cart = await testDb.cart.findFirstOrThrow({
      include: { items: true },
    });
    expect(cart.userId).toBeNull();
    expect(cart.tokenHash).toBe(hashCartToken(token));
    expect(cart.tokenHash).not.toBe(token);
    expect(cart.status).toBe("ACTIVE");
    expect(cart.expiresAt?.getTime()).toBe(
      now.getTime() + GUEST_CART_LIFETIME_MS,
    );
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      variantId: variant.id,
      quantity: 2,
      priceSeenInPaise: 189_900,
    });
  });

  it("merges repeated adds into one line and caps at 10 per variant (C1)", async () => {
    const { variant } = await catalog();
    await setStock(variant.id, 50);
    const context = guest();

    await addToCart(context, { variantId: variant.id, quantity: 6 });
    const second = await addToCart(context, {
      variantId: variant.id,
      quantity: 6,
    });
    expect(second).toMatchObject({
      quantityAdded: 4,
      quantityInCart: 10,
      limitedBy: "max",
      itemCount: 10,
    });

    const third = await addToCart(context, {
      variantId: variant.id,
      quantity: 1,
    });
    expect(third).toMatchObject({ quantityAdded: 0, quantityInCart: 10 });
    expect(await testDb.cartItem.count()).toBe(1);
  });

  it("never exceeds available stock, counting reservations (C1)", async () => {
    const { variant } = await catalog();
    await setStock(variant.id, 5, 2);
    const result = await addToCart(guest(), {
      variantId: variant.id,
      quantity: 8,
    });
    expect(result).toMatchObject({
      quantityAdded: 3,
      quantityInCart: 3,
      limitedBy: "stock",
    });
  });

  it("limits a one-of-a-kind piece to a single unit (C1)", async () => {
    const { product, variant } = await catalog();
    await testDb.product.update({
      where: { id: product.id },
      data: { isOneOfAKind: true },
    });
    const context = guest();
    const first = await addToCart(context, {
      variantId: variant.id,
      quantity: 3,
    });
    expect(first).toMatchObject({
      quantityAdded: 1,
      quantityInCart: 1,
      limitedBy: "one_of_a_kind",
    });
    const again = await addToCart(context, {
      variantId: variant.id,
      quantity: 1,
    });
    expect(again).toMatchObject({ quantityAdded: 0, quantityInCart: 1 });
  });

  it("refuses archived or draft products, inactive variants and sold-out stock", async () => {
    const { product, variant } = await catalog();

    await setStock(variant.id, 0);
    await expect(
      addToCart(guest(), { variantId: variant.id, quantity: 1 }),
    ).rejects.toMatchObject({ code: "CART_ITEM_SOLD_OUT" });

    await setStock(variant.id, 5);
    await testDb.productVariant.update({
      where: { id: variant.id },
      data: { isActive: false },
    });
    await expect(
      addToCart(guest(), { variantId: variant.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(CartItemUnavailableError);

    await testDb.productVariant.update({
      where: { id: variant.id },
      data: { isActive: true },
    });
    for (const status of ["DRAFT", "ARCHIVED"] as const) {
      await testDb.product.update({
        where: { id: product.id },
        data: { status },
      });
      await expect(
        addToCart(guest(), { variantId: variant.id, quantity: 1 }),
      ).rejects.toMatchObject({ code: "CART_ITEM_UNAVAILABLE" });
    }
    await expect(
      addToCart(guest(), {
        variantId: "00000000-0000-7000-8000-000000000000",
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(CartItemUnavailableError);
    expect(await testDb.cartItem.count()).toBe(0);
  });

  it("adds twice when two requests race, and keeps one active cart per user", async () => {
    const { variant } = await catalog();
    await setStock(variant.id, 10);
    const user = await createUser();
    const context = asUser(user.id);

    await Promise.all([
      addToCart(context, { variantId: variant.id, quantity: 1 }),
      addToCart(context, { variantId: variant.id, quantity: 1 }),
      addToCart(context, { variantId: variant.id, quantity: 1 }),
    ]);

    expect(await testDb.cart.count({ where: { userId: user.id } })).toBe(1);
    expect(await getCartItemCount(context)).toBe(3);
  });
});

describe("the cart view (C5 and flagged lines)", () => {
  it("always shows the live database price and flags a change until acknowledged", async () => {
    const { variant } = await catalog();
    const context = guest();
    await addToCart(context, { variantId: variant.id, quantity: 2 });

    await testDb.productVariant.update({
      where: { id: variant.id },
      data: { priceInPaise: 219_900 },
    });
    const view = await getCartView(context);
    expect(view.lines[0]).toMatchObject({
      unitPriceInPaise: 219_900,
      priceSeenInPaise: 189_900,
      priceChanged: true,
      lineTotalInPaise: 439_800,
    });
    expect(view.subtotalInPaise).toBe(439_800);
    expect(view.hasPriceChanges).toBe(true);

    await acknowledgePrice(context, view.lines[0]!.id);
    const after = await getCartView(context);
    expect(after.lines[0]?.priceChanged).toBe(false);
    expect(after.hasPriceChanges).toBe(false);
  });

  it("keeps lines that can no longer be bought, flags them and blocks checkout", async () => {
    const { product, variant } = await catalog();
    await setStock(variant.id, 5);
    const context = guest();
    await addToCart(context, { variantId: variant.id, quantity: 3 });
    expect(await getCartView(context)).toMatchObject({
      canCheckout: true,
      hasAvailabilityIssues: false,
    });

    await setStock(variant.id, 2);
    let view = await getCartView(context);
    expect(view.lines[0]).toMatchObject({
      availability: "limited",
      quantity: 3,
      available: 2,
      maxQuantity: 2,
    });
    expect(view.canCheckout).toBe(false);
    expect(view.subtotalInPaise).toBe(0);

    await setStock(variant.id, 0);
    view = await getCartView(context);
    expect(view.lines[0]?.availability).toBe("sold_out");
    expect(view.lines).toHaveLength(1);

    await setStock(variant.id, 5);
    await testDb.product.update({
      where: { id: product.id },
      data: { status: "ARCHIVED" },
    });
    view = await getCartView(context);
    expect(view.lines[0]).toMatchObject({
      availability: "unavailable",
      maxQuantity: 0,
    });
    expect(view.hasAvailabilityIssues).toBe(true);
    expect(view.itemCount).toBe(3);
  });

  it("reduces a limited line back to what is available and allows checkout again", async () => {
    const { variant } = await catalog();
    await setStock(variant.id, 5);
    const context = guest();
    await addToCart(context, { variantId: variant.id, quantity: 4 });
    await setStock(variant.id, 2);
    const line = (await getCartView(context)).lines[0]!;

    await updateLine(context, { lineId: line.id, quantity: 7 });
    const view = await getCartView(context);
    expect(view.lines[0]).toMatchObject({ quantity: 2, availability: "ok" });
    expect(view.canCheckout).toBe(true);
  });
});

describe("updating and removing lines", () => {
  it("changes quantity within the limits, and quantity 0 removes the line", async () => {
    const { variant } = await catalog();
    await setStock(variant.id, 20);
    const context = guest();
    await addToCart(context, { variantId: variant.id, quantity: 1 });
    const line = (await getCartView(context)).lines[0]!;

    await updateLine(context, { lineId: line.id, quantity: 10 });
    expect((await getCartView(context)).lines[0]?.quantity).toBe(10);

    await updateLine(context, { lineId: line.id, quantity: 0 });
    expect((await getCartView(context)).lines).toHaveLength(0);
  });

  it("refuses to change a sold-out line's quantity and reports why", async () => {
    const { variant } = await catalog();
    const context = guest();
    await addToCart(context, { variantId: variant.id, quantity: 1 });
    const line = (await getCartView(context)).lines[0]!;
    await setStock(variant.id, 0);
    await expect(
      updateLine(context, { lineId: line.id, quantity: 2 }),
    ).rejects.toMatchObject({ code: "CART_ITEM_SOLD_OUT" });
  });

  it("removes a line and refreshes activity", async () => {
    const { variant } = await catalog();
    const context = guest();
    const t0 = new Date("2026-11-01T10:00:00Z");
    const t1 = new Date("2026-11-10T10:00:00Z");
    await addToCart(context, { variantId: variant.id, quantity: 1 }, t0);
    const line = (await getCartView(context)).lines[0]!;

    await removeLine(context, line.id, t1);
    const cart = await testDb.cart.findFirstOrThrow();
    expect(cart.lastActivityAt).toEqual(t1);
    expect(cart.expiresAt?.getTime()).toBe(
      t1.getTime() + GUEST_CART_LIFETIME_MS,
    );
    expect(await getCartItemCount(context)).toBe(0);
  });
});

describe("ownership", () => {
  it("another guest token, a signed-in customer or an anonymous visitor cannot see or touch a guest's lines", async () => {
    const { variant } = await catalog();
    const owner = guest();
    await addToCart(owner, { variantId: variant.id, quantity: 2 });
    const line = (await getCartView(owner)).lines[0]!;
    const stranger = await createUser("stranger@example.com");

    const others: CartContext[] = [
      guest(),
      asUser(stranger.id),
      { kind: "anonymous" },
    ];
    for (const other of others) {
      expect((await getCartView(other)).lines).toHaveLength(0);
      await expect(
        updateLine(other, { lineId: line.id, quantity: 5 }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(removeLine(other, line.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(acknowledgePrice(other, line.id)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    expect((await getCartView(owner)).lines[0]?.quantity).toBe(2);
  });

  it("a line id from another customer's cart is not found even with a valid cart of one's own", async () => {
    const { variant } = await catalog();
    const asha = await createUser("asha@example.com");
    const ravi = await createUser("ravi@example.com");
    await addToCart(asUser(asha.id), { variantId: variant.id, quantity: 1 });
    await addToCart(asUser(ravi.id), { variantId: variant.id, quantity: 1 });
    const ashaLine = (await getCartView(asUser(asha.id))).lines[0]!;

    await expect(
      updateLine(asUser(ravi.id), { lineId: ashaLine.id, quantity: 0 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      removeLine(asUser(ravi.id), ashaLine.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect((await getCartView(asUser(asha.id))).lines).toHaveLength(1);
  });

  it("an anonymous visitor can never create a cart through a mutation", async () => {
    // The action layer issues a token first; the service refuses the anonymous kind at the type level.
    expect(await getCartView({ kind: "anonymous" })).toMatchObject({
      id: null,
      lines: [],
    });
    expect(await testDb.cart.count()).toBe(0);
  });
});

describe("guest cart lifetime (C2)", () => {
  it("pushes the expiry forward on every valid activity", async () => {
    const { variant } = await catalog();
    await setStock(variant.id, 10);
    const context = guest();
    const t0 = new Date("2026-11-01T10:00:00Z");
    const t1 = new Date("2026-11-20T10:00:00Z");
    await addToCart(context, { variantId: variant.id, quantity: 1 }, t0);
    await addToCart(context, { variantId: variant.id, quantity: 1 }, t1);
    const cart = await testDb.cart.findFirstOrThrow();
    expect(cart.expiresAt?.getTime()).toBe(
      t1.getTime() + GUEST_CART_LIFETIME_MS,
    );
  });

  it("ignores an expired cart and starts a fresh one for the same token", async () => {
    const { variant } = await catalog();
    const token = generateCartToken();
    const t0 = new Date("2026-11-01T10:00:00Z");
    const later = new Date(t0.getTime() + GUEST_CART_LIFETIME_MS + 1);
    await addToCart(guest(token), { variantId: variant.id, quantity: 3 }, t0);

    expect(
      await cartData.findActiveGuestCart(hashCartToken(token), later),
    ).toBeNull();

    await addToCart(
      guest(token),
      { variantId: variant.id, quantity: 1 },
      later,
    );
    const carts = await testDb.cart.findMany({ orderBy: { createdAt: "asc" } });
    expect(carts.map((c) => c.status)).toEqual(["ABANDONED", "ACTIVE"]);
    expect(carts[0]?.tokenHash).toBeNull();
    expect(carts[1]?.tokenHash).toBe(hashCartToken(token));
    const fresh = await cartData.findActiveGuestCart(
      hashCartToken(token),
      later,
    );
    expect(fresh?.items.map((i) => i.quantity)).toEqual([1]);
  });

  it("cleanupCarts abandons only expired guest carts", async () => {
    const { variant } = await catalog();
    const user = await createUser();
    const t0 = new Date("2026-11-01T10:00:00Z");
    const sweep = new Date(t0.getTime() + GUEST_CART_LIFETIME_MS + 1);
    await addToCart(guest(), { variantId: variant.id, quantity: 1 }, t0);
    await addToCart(guest(), { variantId: variant.id, quantity: 1 }, sweep);
    await addToCart(
      asUser(user.id),
      { variantId: variant.id, quantity: 1 },
      t0,
    );

    expect(await cleanupCarts(sweep)).toBe(1);
    const statuses = await testDb.cart.findMany({
      select: { userId: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    expect(statuses).toEqual([
      { userId: null, status: "ABANDONED" },
      { userId: null, status: "ACTIVE" },
      { userId: user.id, status: "ACTIVE" },
    ]);
  });
});

describe("merging a guest cart on sign-in (C6)", () => {
  it("sums quantities per variant, keeps other lines, closes the guest cart", async () => {
    const { product, variant: a } = await catalog();
    const b = await createVariant(product.id, "DUP-2", 99_900);
    await setStock(a.id, 20);
    const user = await createUser();
    const token = generateCartToken();
    await addToCart(asUser(user.id), { variantId: a.id, quantity: 3 });
    await addToCart(guest(token), { variantId: a.id, quantity: 2 });
    await addToCart(guest(token), { variantId: b.id, quantity: 1 });

    const result = await mergeGuestCartIntoUser(user.id, token);
    expect(result).toEqual({ merged: true, lines: 2, adjusted: 0 });

    const view = await getCartView(asUser(user.id));
    expect(view.lines.map((l) => [l.variant.sku, l.quantity]).sort()).toEqual([
      ["DUP-1", 5],
      ["DUP-2", 1],
    ]);
    const guestCart = await testDb.cart.findFirstOrThrow({
      where: { userId: null },
    });
    expect(guestCart.status).toBe("MERGED");
    expect((await getCartView(guest(token))).lines).toHaveLength(0);
  });

  it("applies the limits and stock and reports adjustments without discarding lines", async () => {
    const { product, variant: a } = await catalog();
    const b = await createVariant(product.id, "DUP-2", 99_900);
    const original = await createProduct(
      (await createCategory("originals")).id,
      "kohbar",
    );
    await testDb.product.update({
      where: { id: original.id },
      data: { isOneOfAKind: true },
    });
    const c = await createVariant(original.id, "KOH-1", 1_500_000);
    const gone = await createProduct(
      (await createCategory("gone")).id,
      "archived-later",
    );
    const d = await createVariant(gone.id, "GONE-1", 50_000);
    await setStock(a.id, 20);
    await setStock(b.id, 3);

    const user = await createUser();
    const token = generateCartToken();
    const mine = asUser(user.id);
    await addToCart(mine, { variantId: a.id, quantity: 8 });
    await addToCart(mine, { variantId: b.id, quantity: 2 });
    await addToCart(mine, { variantId: c.id, quantity: 1 });
    await addToCart(guest(token), { variantId: a.id, quantity: 5 }); // 13 → 10
    await addToCart(guest(token), { variantId: b.id, quantity: 3 }); // 5 → 3 (stock)
    await addToCart(guest(token), { variantId: c.id, quantity: 1 }); // 2 → 1
    await addToCart(guest(token), { variantId: d.id, quantity: 2 });
    await testDb.product.update({
      where: { id: gone.id },
      data: { status: "ARCHIVED" },
    });

    const result = await mergeGuestCartIntoUser(user.id, token);
    expect(result).toEqual({ merged: true, lines: 4, adjusted: 3 });

    const view = await getCartView(mine);
    const bySku = Object.fromEntries(view.lines.map((l) => [l.variant.sku, l]));
    expect(bySku["DUP-1"]).toMatchObject({ quantity: 10, availability: "ok" });
    expect(bySku["DUP-2"]).toMatchObject({ quantity: 3, availability: "ok" });
    expect(bySku["KOH-1"]).toMatchObject({ quantity: 1, availability: "ok" });
    // Never silently dropped: kept and flagged so the customer decides.
    expect(bySku["GONE-1"]).toMatchObject({
      quantity: 2,
      availability: "unavailable",
    });
    expect(view.canCheckout).toBe(false);
  });

  it("is idempotent and safe under concurrent sign-ins", async () => {
    const { variant } = await catalog();
    await setStock(variant.id, 20);
    const user = await createUser();
    const token = generateCartToken();
    await addToCart(guest(token), { variantId: variant.id, quantity: 2 });

    const results = await Promise.all([
      mergeGuestCartIntoUser(user.id, token),
      mergeGuestCartIntoUser(user.id, token),
      mergeGuestCartIntoUser(user.id, token),
    ]);
    expect(results.filter((r) => r.merged)).toHaveLength(1);
    expect((await getCartView(asUser(user.id))).lines[0]?.quantity).toBe(2);

    expect(await mergeGuestCartIntoUser(user.id, token)).toEqual({
      merged: false,
      lines: 0,
      adjusted: 0,
    });
    expect(await mergeGuestCartIntoUser(user.id, generateCartToken())).toEqual({
      merged: false,
      lines: 0,
      adjusted: 0,
    });
    expect(await testDb.cart.count({ where: { userId: user.id } })).toBe(1);
  });

  it("does not merge an expired guest cart", async () => {
    const { variant } = await catalog();
    const user = await createUser();
    const token = generateCartToken();
    const t0 = new Date("2026-11-01T10:00:00Z");
    await addToCart(guest(token), { variantId: variant.id, quantity: 1 }, t0);
    const later = new Date(t0.getTime() + GUEST_CART_LIFETIME_MS + 1);
    expect(await mergeGuestCartIntoUser(user.id, token, later)).toMatchObject({
      merged: false,
    });
    expect((await getCartView(asUser(user.id))).lines).toHaveLength(0);
  });
});
