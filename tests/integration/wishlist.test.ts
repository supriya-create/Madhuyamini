import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  getSavedProductIds,
  listWishlist,
  toggleWishlist,
} from "@/features/wishlist/service";
import type { CurrentUser } from "@/server/auth/current-user";
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

/** Wishlists belong to accounts (C3): ownership, uniqueness and active-only. */

beforeEach(resetDatabase);
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

function asCurrentUser(id: string, email: string): CurrentUser {
  return {
    id,
    email,
    emailVerified: true,
    name: "Test Customer",
    phone: null,
    role: "CUSTOMER",
    session: {
      id: "session",
      token: "token",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    },
  };
}

async function twoProducts() {
  const category = await createCategory();
  const saree = await createProduct(category.id, "saree");
  const print = await createProduct(category.id, "print");
  await createVariant(saree.id, "SAR-1", 500_000);
  await createVariant(print.id, "PRI-1", 150_000);
  return { saree, print };
}

describe("wishlist", () => {
  it("toggles a product on and off and lists newest first", async () => {
    const { saree, print } = await twoProducts();
    const row = await createUser("asha@example.com");
    const asha = asCurrentUser(row.id, "asha@example.com");

    expect(await toggleWishlist(asha, saree.id)).toBe("added");
    expect(await toggleWishlist(asha, print.id)).toBe("added");
    expect((await listWishlist(asha)).map((p) => p.slug)).toEqual([
      "print",
      "saree",
    ]);

    expect(await toggleWishlist(asha, saree.id)).toBe("removed");
    expect((await listWishlist(asha)).map((p) => p.slug)).toEqual(["print"]);
    expect(await testDb.wishlistItem.count()).toBe(1);
  });

  it("stores each product once per customer even under a race", async () => {
    const { saree } = await twoProducts();
    const row = await createUser("asha@example.com");
    const asha = asCurrentUser(row.id, "asha@example.com");
    await Promise.all([
      toggleWishlist(asha, saree.id).catch(() => undefined),
      toggleWishlist(asha, saree.id).catch(() => undefined),
    ]);
    expect(
      await testDb.wishlistItem.count({ where: { userId: row.id } }),
    ).toBeLessThanOrEqual(1);
    await expect(
      testDb.wishlistItem.create({
        data: { userId: row.id, productId: saree.id },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps wishlists private to their owner", async () => {
    const { saree } = await twoProducts();
    const a = await createUser("asha@example.com");
    const r = await createUser("ravi@example.com");
    const asha = asCurrentUser(a.id, "asha@example.com");
    const ravi = asCurrentUser(r.id, "ravi@example.com");

    await toggleWishlist(asha, saree.id);
    expect(await listWishlist(ravi)).toEqual([]);
    expect((await getSavedProductIds(ravi)).size).toBe(0);
    expect(await getSavedProductIds(null)).toEqual(new Set());
    // Ravi "removing" Asha's item only toggles his own list.
    expect(await toggleWishlist(ravi, saree.id)).toBe("added");
    expect((await listWishlist(asha)).map((p) => p.slug)).toEqual(["saree"]);
  });

  it("only active products can be saved, and hidden ones drop out of the list", async () => {
    const { saree, print } = await twoProducts();
    const row = await createUser("asha@example.com");
    const asha = asCurrentUser(row.id, "asha@example.com");
    await toggleWishlist(asha, saree.id);
    await toggleWishlist(asha, print.id);

    await testDb.product.update({
      where: { id: print.id },
      data: { status: "ARCHIVED" },
    });
    expect((await listWishlist(asha)).map((p) => p.slug)).toEqual(["saree"]);

    const draft = await createProduct((await createCategory("d")).id, "draft");
    await testDb.product.update({
      where: { id: draft.id },
      data: { status: "DRAFT" },
    });
    await expect(toggleWishlist(asha, draft.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      toggleWishlist(asha, "00000000-0000-7000-8000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
