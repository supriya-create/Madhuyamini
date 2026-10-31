import { createHash } from "node:crypto";

import type { CheckoutPolicy } from "@/config/checkout-policy";
import type { PaymentMethod } from "@/generated/prisma/enums";

/**
 * Pure pricing rules (docs/checkout.md §4). Everything is integer paise and
 * every number comes from the policy or the database; the client supplies
 * nothing but a method and a hash of what it was shown (P12).
 */

export interface QuoteLine {
  readonly variantId: string;
  readonly quantity: number;
  readonly unitPriceInPaise: number;
  readonly isOneOfAKind: boolean;
}

export interface Quote {
  readonly lines: readonly QuoteLine[];
  readonly subtotalInPaise: number;
  readonly shippingInPaise: number;
  readonly codFeeInPaise: number;
  readonly discountInPaise: number;
  readonly totalInPaise: number;
  readonly paymentMethod: PaymentMethod;
  /** SHA-256 of the fields above: the page echoes it and the server recomputes it. */
  readonly hash: string;
}

export type CodRefusal = "disabled" | "over_limit";

/** D7a: flat charge below the free-shipping subtotal, nothing at or above it. */
export function shippingCharge(
  shipping: CheckoutPolicy["shipping"],
  subtotalInPaise: number,
): number {
  if (subtotalInPaise <= 0) return 0;
  if (
    shipping.freeAtSubtotalInPaise !== null &&
    subtotalInPaise >= shipping.freeAtSubtotalInPaise
  )
    return 0;
  return shipping.flatInPaise;
}

/** D7b: COD is offered when enabled and the amount to collect stays within the ceiling. */
export function codRefusal(
  cod: CheckoutPolicy["cod"],
  amountBeforeFeeInPaise: number,
): CodRefusal | null {
  if (!cod.enabled) return "disabled";
  if (amountBeforeFeeInPaise > cod.maxOrderInPaise) return "over_limit";
  return null;
}

export function subtotalOf(lines: readonly QuoteLine[]): number {
  return lines.reduce(
    (total, line) => total + line.unitPriceInPaise * line.quantity,
    0,
  );
}

/** Tax already included in a tax-inclusive amount, for an optional "Includes GST" line. */
export function includedTax(amountInPaise: number, rateBp: number): number {
  const scale = 10_000; // policy-literal-ok: basis points
  return Math.round((amountInPaise * rateBp) / (scale + rateBp));
}

export function buildQuote(
  policy: CheckoutPolicy,
  lines: readonly QuoteLine[],
  paymentMethod: PaymentMethod,
): Quote {
  const ordered = [...lines].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  );
  const subtotalInPaise = subtotalOf(ordered);
  const shippingInPaise = shippingCharge(policy.shipping, subtotalInPaise);
  const codFeeInPaise = paymentMethod === "COD" ? policy.cod.feeInPaise : 0;
  const discountInPaise = 0;
  const totalInPaise =
    subtotalInPaise + shippingInPaise + codFeeInPaise - discountInPaise;
  const unhashed = {
    lines: ordered,
    subtotalInPaise,
    shippingInPaise,
    codFeeInPaise,
    discountInPaise,
    totalInPaise,
    paymentMethod,
  };
  return { ...unhashed, hash: quoteHash(unhashed) };
}

export function quoteHash(quote: Omit<Quote, "hash">): string {
  const canonical = JSON.stringify({
    l: quote.lines.map((line) => [
      line.variantId,
      line.quantity,
      line.unitPriceInPaise,
    ]),
    s: quote.subtotalInPaise,
    sh: quote.shippingInPaise,
    c: quote.codFeeInPaise,
    d: quote.discountInPaise,
    t: quote.totalInPaise,
    m: quote.paymentMethod,
  });
  return createHash("sha256").update(canonical).digest("base64url");
}

export type QuoteProblem =
  "empty" | "below_minimum" | "cod_disabled" | "cod_over_limit";

/** Why a quote cannot be placed with its method, or null when it can. */
export function quoteProblem(
  policy: CheckoutPolicy,
  quote: Quote,
): QuoteProblem | null {
  if (quote.lines.length === 0) return "empty";
  if (quote.totalInPaise < policy.payment.minOrderInPaise)
    return "below_minimum";
  if (quote.paymentMethod === "COD") {
    const refusal = codRefusal(
      policy.cod,
      quote.subtotalInPaise + quote.shippingInPaise,
    );
    if (refusal === "disabled") return "cod_disabled";
    if (refusal === "over_limit") return "cod_over_limit";
  }
  return null;
}
