import "server-only";

import { cache } from "react";

import { findProductSummariesByIds } from "@/features/catalog/data";
import { toProductSummary } from "@/features/catalog/service";
import type { ProductSummary } from "@/features/catalog/types";
import type { CurrentUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";

import * as data from "./data";

/** Product ids saved by the signed-in customer, memoised per request for card hearts. */
export const getSavedProductIds = cache(
  async (user: CurrentUser | null): Promise<Set<string>> => {
    if (!user) return new Set();
    return data.findWishlistProductIds(user.id);
  },
);

export async function listWishlist(
  user: CurrentUser,
): Promise<ProductSummary[]> {
  const ids = (await data.findWishlistProductIdsOrdered(user.id)).map(
    (row) => row.productId,
  );
  const rows = await findProductSummariesByIds(ids);
  return rows.map(toProductSummary);
}

/** Adds when absent, removes when present. Only active products can be saved. */
export async function toggleWishlist(
  user: CurrentUser,
  productId: string,
): Promise<"added" | "removed"> {
  const saved = await data.findWishlistProductIds(user.id);
  if (saved.has(productId)) {
    await data.removeWishlistItem(user.id, productId);
    return "removed";
  }
  if (!(await data.isActiveProduct(productId)))
    throw new NotFoundError("Product");
  await data.addWishlistItem(user.id, productId);
  return "added";
}
