import type {
  InstalmentKind,
  OrderKind,
  PaymentMethod,
} from "@/generated/prisma/enums";
import { includedTax } from "@/features/checkout/rules";
import { AppError } from "@/server/errors";

/**
 * Pure rules for creating an order from lines (Phase 8 step 8.0,
 * docs/phase-8-returns-custom-artwork.md §5.5). Checkout, exchange
 * settlement and commission acceptance all pass through them, so an order
 * row can only ever be written with consistent amounts, links and stock
 * handling. The database CHECKs repeat the same rules.
 */

export interface PlacementLine {
  readonly variantId: string;
  readonly productSlug: string;
  readonly productTitle: string;
  readonly variantTitle: string | null;
  readonly sku: string;
  readonly quantity: number;
  readonly unitPriceInPaise: number;
  readonly taxRateBp: number | null;
  readonly hsnCode: string | null;
  readonly imageUrl: string | null;
  readonly imageAlt: string | null;
}

export interface PlacementAmounts {
  readonly subtotalInPaise: number;
  readonly shippingInPaise: number;
  readonly codFeeInPaise: number;
  readonly discountInPaise: number;
  readonly totalInPaise: number;
}

/** Parent references; exactly those the kind requires, nothing else. */
export interface PlacementLinks {
  readonly exchangeOfOrderId: string | null;
  readonly commissionRequestId: string | null;
  readonly instalment: InstalmentKind | null;
}

/**
 * "manage": reserve (online) or commit (COD, store credit) the lines' stock.
 * "none": the lines carry no stock (commission instalments only).
 */
export type StockHandling = "manage" | "none";

export interface PlacementRules {
  readonly kind: OrderKind;
  readonly paymentMethod: PaymentMethod;
  readonly lines: readonly PlacementLine[];
  readonly amounts: PlacementAmounts;
  readonly links: PlacementLinks;
  readonly stock: StockHandling;
}

export class PlacementInputError extends AppError {
  constructor(message: string) {
    super(message, { code: "PLACEMENT_INVALID", status: 400 });
  }
}

const isWholeNonNegative = (value: number) =>
  Number.isInteger(value) && value >= 0;

export function assertPlacementInput(input: PlacementRules): void {
  if (input.lines.length === 0) {
    throw new PlacementInputError("An order needs at least one line.");
  }
  for (const line of input.lines) {
    if (!line.variantId || !line.sku) {
      throw new PlacementInputError("Every line needs a variant and a SKU.");
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new PlacementInputError(
        `Quantity must be a whole number above zero (${line.sku}).`,
      );
    }
    if (!isWholeNonNegative(line.unitPriceInPaise)) {
      throw new PlacementInputError(
        `Unit price must be whole paise (${line.sku}).`,
      );
    }
  }

  const { amounts } = input;
  for (const value of Object.values(amounts)) {
    if (!isWholeNonNegative(value)) {
      throw new PlacementInputError(
        "Amounts must be whole, non-negative paise.",
      );
    }
  }
  const subtotal = input.lines.reduce(
    (sum, line) => sum + line.unitPriceInPaise * line.quantity,
    0,
  );
  if (subtotal !== amounts.subtotalInPaise) {
    throw new PlacementInputError("The subtotal does not match the lines.");
  }
  const total =
    amounts.subtotalInPaise +
    amounts.shippingInPaise +
    amounts.codFeeInPaise -
    amounts.discountInPaise;
  if (total !== amounts.totalInPaise) {
    throw new PlacementInputError("The total does not add up.");
  }
  if (input.paymentMethod !== "COD" && amounts.codFeeInPaise !== 0) {
    throw new PlacementInputError("Only cash on delivery carries a COD fee.");
  }
  if (input.paymentMethod === "STORE_CREDIT" && amounts.totalInPaise !== 0) {
    throw new PlacementInputError("Store credit settles only a zero total.");
  }

  const { links } = input;
  switch (input.kind) {
    case "STANDARD":
      if (
        links.exchangeOfOrderId ||
        links.commissionRequestId ||
        links.instalment
      ) {
        throw new PlacementInputError(
          "A standard order carries no parent links.",
        );
      }
      break;
    case "EXCHANGE_REPLACEMENT":
      if (
        !links.exchangeOfOrderId ||
        links.commissionRequestId ||
        links.instalment
      ) {
        throw new PlacementInputError(
          "A replacement order links to exactly its original order.",
        );
      }
      break;
    case "COMMISSION_INSTALMENT":
      if (
        !links.commissionRequestId ||
        !links.instalment ||
        links.exchangeOfOrderId
      ) {
        throw new PlacementInputError(
          "An instalment order links to its commission and names the instalment.",
        );
      }
      break;
  }

  if (input.stock === "none" && input.kind !== "COMMISSION_INSTALMENT") {
    throw new PlacementInputError(
      "Only commission instalments carry no stock.",
    );
  }
}

/** Included tax over the lines, or null unless every line carries a rate (docs/checkout.md §4). */
export function orderTaxInPaise(
  lines: readonly PlacementLine[],
): number | null {
  if (!lines.every((line) => line.taxRateBp !== null)) return null;
  return lines.reduce(
    (sum, line) =>
      sum +
      includedTax(line.unitPriceInPaise * line.quantity, line.taxRateBp ?? 0),
    0,
  );
}

/** Online payment waits; cash on delivery and store credit confirm at once. */
export function initialOrderStatus(
  paymentMethod: PaymentMethod,
): "PENDING_PAYMENT" | "CONFIRMED" {
  return paymentMethod === "RAZORPAY" ? "PENDING_PAYMENT" : "CONFIRMED";
}
