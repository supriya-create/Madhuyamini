/**
 * Pure catalog rules. No I/O, so they are cheap to test exhaustively and safe
 * to import anywhere.
 */

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

export interface StockLevels {
  readonly stockOnHand: number;
  readonly reserved: number;
}

/** Units that can still be sold: stock on hand minus units held for pending payments. */
export function availableStock(
  inventory: StockLevels | null | undefined,
): number {
  if (!inventory) return 0;
  return Math.max(0, inventory.stockOnHand - inventory.reserved);
}

export function stockStatus(
  available: number,
  lowStockThreshold: number,
): StockStatus {
  if (available <= 0) return "out_of_stock";
  if (available <= lowStockThreshold) return "low_stock";
  return "in_stock";
}

export function isPurchasable(
  variant: { readonly isActive: boolean },
  available: number,
): boolean {
  return variant.isActive && available > 0;
}

export interface PriceRange {
  readonly fromInPaise: number;
  readonly toInPaise: number;
}

/** Price span across a product's active variants, or null when none are active. */
export function priceRange(
  variants: ReadonlyArray<{
    readonly priceInPaise: number;
    readonly isActive: boolean;
  }>,
): PriceRange | null {
  const prices = variants
    .filter((variant) => variant.isActive)
    .map((v) => v.priceInPaise);
  if (prices.length === 0) return null;
  return { fromInPaise: Math.min(...prices), toInPaise: Math.max(...prices) };
}

/** "M / Indigo" from a variant's option values in option order; null when there are none. */
export function variantTitle(
  values: ReadonlyArray<{ readonly value: string }>,
): string | null {
  if (values.length === 0) return null;
  return values.map((entry) => entry.value).join(" / ");
}

/** Emails are compared and stored in this form so the unique index is effectively case-insensitive. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
