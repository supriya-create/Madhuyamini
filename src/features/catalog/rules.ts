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

/** Escapes `%`, `_` and `\` so user text can be used literally inside a LIKE pattern. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface VariantSelection {
  readonly id: string;
  readonly optionValueIds: readonly string[];
}

/**
 * Finds the variant whose option values match a complete selection (one value
 * per option). Returns null while the selection is incomplete or has no match.
 */
export function findVariantForSelection<T extends VariantSelection>(
  variants: readonly T[],
  selectedValueIds: readonly string[],
  optionCount: number,
): T | null {
  if (selectedValueIds.length !== optionCount) return null;
  const wanted = new Set(selectedValueIds);
  return (
    variants.find(
      (variant) =>
        variant.optionValueIds.length === wanted.size &&
        variant.optionValueIds.every((id) => wanted.has(id)),
    ) ?? null
  );
}

/** Page numbers to show around the current page: always first and last, with gaps as null. */
export function paginationWindow(
  page: number,
  totalPages: number,
  radius = 1,
): (number | null)[] {
  if (totalPages <= 1) return [];
  const pages = new Set<number>([1, totalPages]);
  for (
    let candidate = page - radius;
    candidate <= page + radius;
    candidate += 1
  ) {
    if (candidate >= 1 && candidate <= totalPages) pages.add(candidate);
  }
  const ordered = [...pages].sort((a, b) => a - b);
  const result: (number | null)[] = [];
  for (const [index, value] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (previous !== undefined && value - previous > 1) result.push(null);
    result.push(value);
  }
  return result;
}
