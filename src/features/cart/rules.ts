/**
 * Pure cart rules (C1, C5, C6). No I/O: shared by services and tests.
 */

export const MAX_LINE_QUANTITY = 10;

export interface QuantityContext {
  readonly available: number;
  readonly isOneOfAKind: boolean;
}

export type QuantityLimit = "max" | "one_of_a_kind" | "stock" | null;

export interface ClampedQuantity {
  readonly quantity: number;
  /** Which rule reduced the request, if any. */
  readonly limitedBy: QuantityLimit;
}

/** C1: at most 10, at most 1 for a one-of-a-kind piece, never above available stock. */
export function clampQuantity(
  requested: number,
  context: QuantityContext,
): ClampedQuantity {
  const wanted = Math.max(0, Math.floor(requested));
  let quantity = wanted;
  let limitedBy: QuantityLimit = null;

  if (context.isOneOfAKind && quantity > 1) {
    quantity = 1;
    limitedBy = "one_of_a_kind";
  }
  if (quantity > MAX_LINE_QUANTITY) {
    quantity = MAX_LINE_QUANTITY;
    limitedBy = "max";
  }
  if (quantity > context.available) {
    quantity = Math.max(0, context.available);
    limitedBy = "stock";
  }
  return { quantity, limitedBy };
}

export type LineAvailability =
  | "ok"
  /** Product archived/draft or variant inactive: cannot be bought at all. */
  | "unavailable"
  /** No stock left for this variant. */
  | "sold_out"
  /** Some stock, but fewer than the quantity in the cart. */
  | "limited";

export interface LineState {
  readonly productActive: boolean;
  readonly variantActive: boolean;
  readonly available: number;
  readonly quantity: number;
}

export function lineAvailability(state: LineState): LineAvailability {
  if (!state.productActive || !state.variantActive) return "unavailable";
  if (state.available <= 0) return "sold_out";
  if (state.available < state.quantity) return "limited";
  return "ok";
}

export interface PricedLine {
  readonly quantity: number;
  readonly unitPriceInPaise: number;
  readonly availability: LineAvailability;
}

/** Subtotal over lines that can actually be bought, in paise. */
export function cartSubtotal(lines: ReadonlyArray<PricedLine>): number {
  return lines
    .filter((line) => line.availability === "ok")
    .reduce((total, line) => total + line.unitPriceInPaise * line.quantity, 0);
}

/** Units across every line, for the header badge. */
export function cartItemCount(
  lines: ReadonlyArray<{ readonly quantity: number }>,
): number {
  return lines.reduce((count, line) => count + line.quantity, 0);
}

/** Checkout is blocked while any line cannot be bought as it stands (requirement 1). */
export function canCheckout(lines: ReadonlyArray<PricedLine>): boolean {
  return lines.length > 0 && lines.every((line) => line.availability === "ok");
}

/** C5: a line whose price moved since it was added shows a notice until acknowledged. */
export function priceChanged(
  seenInPaise: number,
  currentInPaise: number,
): boolean {
  return seenInPaise !== currentInPaise;
}

/** C6: merged quantity for one variant present in both carts, then clamped. */
export function mergedQuantity(
  existing: number,
  incoming: number,
  context: QuantityContext,
): ClampedQuantity {
  return clampQuantity(existing + incoming, context);
}

export const GUEST_CART_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** C2: expiry is 30 days after the latest activity. */
export function guestCartExpiry(activityAt: Date): Date {
  return new Date(activityAt.getTime() + GUEST_CART_LIFETIME_MS);
}
