import { describe, expect, it } from "vitest";

import { checkoutPolicy } from "@/config/checkout-policy";

import {
  buildQuote,
  codRefusal,
  includedTax,
  quoteHash,
  quoteProblem,
  shippingCharge,
} from "./rules";
import type { QuoteLine } from "./rules";

const policy = checkoutPolicy;
const line = (
  variantId: string,
  quantity: number,
  unitPriceInPaise: number,
): QuoteLine => ({
  variantId,
  quantity,
  unitPriceInPaise,
  isOneOfAKind: false,
});

describe("shipping (D7a)", () => {
  it("charges ₹99 below ₹1,999 and nothing from ₹1,999", () => {
    expect(shippingCharge(policy.shipping, 189_900)).toBe(9_900);
    expect(shippingCharge(policy.shipping, 199_899)).toBe(9_900);
    expect(shippingCharge(policy.shipping, 199_900)).toBe(0);
    expect(shippingCharge(policy.shipping, 1_500_000)).toBe(0);
    expect(shippingCharge(policy.shipping, 0)).toBe(0);
  });

  it("never waives the charge when the policy has no free threshold", () => {
    expect(
      shippingCharge(
        { ...policy.shipping, freeAtSubtotalInPaise: null },
        5_000_000,
      ),
    ).toBe(9_900);
  });
});

describe("cash on delivery (D7b)", () => {
  it("is offered up to ₹5,000 and refused above or when disabled", () => {
    expect(codRefusal(policy.cod, 500_000)).toBeNull();
    expect(codRefusal(policy.cod, 500_001)).toBe("over_limit");
    expect(codRefusal({ ...policy.cod, enabled: false }, 100)).toBe("disabled");
  });
});

describe("quotes", () => {
  it("totals integer paise from the policy and the lines only", () => {
    const quote = buildQuote(
      policy,
      [line("b", 2, 189_900), line("a", 1, 99_900)],
      "RAZORPAY",
    );
    expect(quote).toMatchObject({
      subtotalInPaise: 479_700,
      shippingInPaise: 0,
      codFeeInPaise: 0,
      discountInPaise: 0,
      totalInPaise: 479_700,
      paymentMethod: "RAZORPAY",
    });
    // Lines are ordered canonically so the hash does not depend on input order.
    expect(quote.lines.map((l) => l.variantId)).toEqual(["a", "b"]);
    const small = buildQuote(policy, [line("a", 1, 99_900)], "COD");
    expect(small).toMatchObject({
      subtotalInPaise: 99_900,
      shippingInPaise: 9_900,
      codFeeInPaise: 0,
      totalInPaise: 109_800,
    });
  });

  it("hashes stably and changes with any price, quantity, charge or method", () => {
    const lines = [line("a", 1, 99_900), line("b", 2, 189_900)];
    const base = buildQuote(policy, lines, "RAZORPAY");
    expect(buildQuote(policy, [...lines].reverse(), "RAZORPAY").hash).toBe(
      base.hash,
    );
    expect(quoteHash(base)).toBe(base.hash);
    expect(
      buildQuote(policy, [line("a", 1, 99_901), lines[1]!], "RAZORPAY").hash,
    ).not.toBe(base.hash);
    expect(
      buildQuote(policy, [line("a", 2, 99_900), lines[1]!], "RAZORPAY").hash,
    ).not.toBe(base.hash);
    expect(buildQuote(policy, lines, "COD").hash).not.toBe(base.hash);
    expect(
      buildQuote(
        { ...policy, shipping: { ...policy.shipping, flatInPaise: 1 } },
        [line("a", 1, 99_900)],
        "RAZORPAY",
      ).hash,
    ).not.toBe(buildQuote(policy, [line("a", 1, 99_900)], "RAZORPAY").hash);
  });

  it("names why a quote cannot be placed", () => {
    expect(quoteProblem(policy, buildQuote(policy, [], "RAZORPAY"))).toBe(
      "empty",
    );
    // Shipping lifts every real order past ₹1; only a free-shipping policy can go under.
    const freeShipping = {
      ...policy,
      shipping: { ...policy.shipping, flatInPaise: 0 },
    };
    expect(
      quoteProblem(
        freeShipping,
        buildQuote(freeShipping, [line("a", 1, 50)], "RAZORPAY"),
      ),
    ).toBe("below_minimum");
    expect(
      quoteProblem(policy, buildQuote(policy, [line("a", 1, 600_000)], "COD")),
    ).toBe("cod_over_limit");
    expect(
      quoteProblem(
        { ...policy, cod: { ...policy.cod, enabled: false } },
        buildQuote(policy, [line("a", 1, 1_000)], "COD"),
      ),
    ).toBe("cod_disabled");
    expect(
      quoteProblem(
        policy,
        buildQuote(policy, [line("a", 1, 1_000)], "RAZORPAY"),
      ),
    ).toBeNull();
    // The ceiling applies to what is collected: subtotal plus shipping.
    expect(
      quoteProblem(policy, buildQuote(policy, [line("a", 1, 495_000)], "COD")),
    ).toBeNull();
    expect(
      quoteProblem(policy, buildQuote(policy, [line("a", 1, 500_000)], "COD")),
    ).toBeNull();
  });
});

describe("included tax", () => {
  it("splits a tax-inclusive amount without changing it", () => {
    expect(includedTax(105_000, 500)).toBe(5_000);
    expect(includedTax(112_000, 1_200)).toBe(12_000);
    expect(includedTax(189_900, 500)).toBe(9_043);
    expect(includedTax(0, 500)).toBe(0);
    expect(includedTax(100, 0)).toBe(0);
  });
});
