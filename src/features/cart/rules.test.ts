import { describe, expect, it } from "vitest";

import {
  canCheckout,
  cartItemCount,
  cartSubtotal,
  clampQuantity,
  guestCartExpiry,
  lineAvailability,
  mergedQuantity,
  priceChanged,
} from "./rules";

describe("clampQuantity (C1)", () => {
  it("caps at 10 and reports the rule that applied", () => {
    expect(clampQuantity(12, { available: 50, isOneOfAKind: false })).toEqual({
      quantity: 10,
      limitedBy: "max",
    });
    expect(clampQuantity(3, { available: 50, isOneOfAKind: false })).toEqual({
      quantity: 3,
      limitedBy: null,
    });
  });

  it("limits one-of-a-kind pieces to a single unit", () => {
    expect(clampQuantity(4, { available: 1, isOneOfAKind: true })).toEqual({
      quantity: 1,
      limitedBy: "one_of_a_kind",
    });
  });

  it("never exceeds available stock, including zero", () => {
    expect(clampQuantity(5, { available: 2, isOneOfAKind: false })).toEqual({
      quantity: 2,
      limitedBy: "stock",
    });
    expect(clampQuantity(5, { available: 0, isOneOfAKind: false })).toEqual({
      quantity: 0,
      limitedBy: "stock",
    });
  });

  it("ignores fractional or negative requests", () => {
    expect(
      clampQuantity(2.9, { available: 9, isOneOfAKind: false }).quantity,
    ).toBe(2);
    expect(
      clampQuantity(-1, { available: 9, isOneOfAKind: false }).quantity,
    ).toBe(0);
  });
});

describe("lineAvailability", () => {
  it("classifies lines in priority order", () => {
    expect(
      lineAvailability({
        productActive: false,
        variantActive: true,
        available: 5,
        quantity: 1,
      }),
    ).toBe("unavailable");
    expect(
      lineAvailability({
        productActive: true,
        variantActive: false,
        available: 5,
        quantity: 1,
      }),
    ).toBe("unavailable");
    expect(
      lineAvailability({
        productActive: true,
        variantActive: true,
        available: 0,
        quantity: 1,
      }),
    ).toBe("sold_out");
    expect(
      lineAvailability({
        productActive: true,
        variantActive: true,
        available: 2,
        quantity: 3,
      }),
    ).toBe("limited");
    expect(
      lineAvailability({
        productActive: true,
        variantActive: true,
        available: 3,
        quantity: 3,
      }),
    ).toBe("ok");
  });
});

describe("totals and checkout", () => {
  const lines = [
    { quantity: 2, unitPriceInPaise: 149_900, availability: "ok" as const },
    {
      quantity: 1,
      unitPriceInPaise: 999_900,
      availability: "sold_out" as const,
    },
    { quantity: 3, unitPriceInPaise: 89_900, availability: "ok" as const },
  ];

  it("sums only purchasable lines and counts every unit", () => {
    expect(cartSubtotal(lines)).toBe(2 * 149_900 + 3 * 89_900);
    expect(cartItemCount(lines)).toBe(6);
  });

  it("blocks checkout while any line has a problem, and for empty carts", () => {
    expect(canCheckout(lines)).toBe(false);
    expect(
      canCheckout(lines.filter((line) => line.availability === "ok")),
    ).toBe(true);
    expect(canCheckout([])).toBe(false);
  });
});

describe("price change and merging", () => {
  it("flags a changed price in either direction", () => {
    expect(priceChanged(149_900, 149_900)).toBe(false);
    expect(priceChanged(149_900, 139_900)).toBe(true);
    expect(priceChanged(149_900, 159_900)).toBe(true);
  });

  it("merges by summing, then applies the caps (C6)", () => {
    expect(
      mergedQuantity(6, 7, { available: 50, isOneOfAKind: false }),
    ).toEqual({ quantity: 10, limitedBy: "max" });
    expect(mergedQuantity(1, 1, { available: 1, isOneOfAKind: true })).toEqual({
      quantity: 1,
      limitedBy: "one_of_a_kind",
    });
    expect(mergedQuantity(2, 2, { available: 3, isOneOfAKind: false })).toEqual(
      { quantity: 3, limitedBy: "stock" },
    );
  });

  it("sets guest expiry 30 days after the latest activity (C2)", () => {
    const at = new Date("2026-10-31T00:00:00Z");
    expect(guestCartExpiry(at).toISOString()).toBe("2026-11-30T00:00:00.000Z");
  });
});
