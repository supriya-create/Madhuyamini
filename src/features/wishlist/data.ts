import "server-only";

import { db } from "@/server/db";

export async function findWishlistProductIds(
  userId: string,
): Promise<Set<string>> {
  const rows = await db.wishlistItem.findMany({
    where: { userId },
    select: { productId: true },
  });
  return new Set(rows.map((row) => row.productId));
}

export function findWishlistProductIdsOrdered(userId: string) {
  return db.wishlistItem.findMany({
    where: { userId, product: { status: "ACTIVE", kind: "CATALOGUE" } },
    select: { productId: true },
    orderBy: { createdAt: "desc" },
  });
}

export function addWishlistItem(userId: string, productId: string) {
  return db.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId },
    update: {},
    select: { id: true },
  });
}

export function removeWishlistItem(userId: string, productId: string) {
  return db.wishlistItem.deleteMany({ where: { userId, productId } });
}

export function isActiveProduct(productId: string) {
  return db.product.findFirst({
    where: { id: productId, status: "ACTIVE", kind: "CATALOGUE" },
    select: { id: true },
  });
}
