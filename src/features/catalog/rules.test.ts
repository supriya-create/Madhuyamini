import { describe, expect, it } from "vitest";

import {
  availableStock,
  isPurchasable,
  normaliseEmail,
  priceRange,
  stockStatus,
  variantTitle,
} from "./rules";

describe("availableStock", () => {
  it("subtracts reservations from stock on hand", () => {
    expect(availableStock({ stockOnHand: 10, reserved: 3 })).toBe(7);
  });

  it("treats missing inventory as nothing to sell", () => {
    expect(availableStock(null)).toBe(0);
    expect(availableStock(undefined)).toBe(0);
  });

  it("never goes negative even if the data is inconsistent", () => {
    expect(availableStock({ stockOnHand: 1, reserved: 5 })).toBe(0);
  });
});

describe("stockStatus", () => {
  it.each([
    [0, 2, "out_of_stock"],
    [1, 2, "low_stock"],
    [2, 2, "low_stock"],
    [3, 2, "in_stock"],
    [1, 0, "in_stock"],
  ])(
    "available %i with threshold %i is %s",
    (available, threshold, expected) => {
      expect(stockStatus(available, threshold)).toBe(expected);
    },
  );
});

describe("isPurchasable", () => {
  it("requires an active variant with stock", () => {
    expect(isPurchasable({ isActive: true }, 1)).toBe(true);
    expect(isPurchasable({ isActive: true }, 0)).toBe(false);
    expect(isPurchasable({ isActive: false }, 5)).toBe(false);
  });
});

describe("priceRange", () => {
  it("spans only active variants", () => {
    expect(
      priceRange([
        { priceInPaise: 249_900, isActive: true },
        { priceInPaise: 199_900, isActive: true },
        { priceInPaise: 99_900, isActive: false },
      ]),
    ).toEqual({ fromInPaise: 199_900, toInPaise: 249_900 });
  });

  it("is null when nothing is active", () => {
    expect(priceRange([])).toBeNull();
    expect(priceRange([{ priceInPaise: 100, isActive: false }])).toBeNull();
  });

  it("collapses to a single price for one variant", () => {
    expect(priceRange([{ priceInPaise: 149_900, isActive: true }])).toEqual({
      fromInPaise: 149_900,
      toInPaise: 149_900,
    });
  });
});

describe("variantTitle", () => {
  it("joins option values in order", () => {
    expect(variantTitle([{ value: "M" }, { value: "Indigo" }])).toBe(
      "M / Indigo",
    );
  });

  it("is null for single-variant products", () => {
    expect(variantTitle([])).toBeNull();
  });
});

describe("normaliseEmail", () => {
  it("lower-cases and trims", () => {
    expect(normaliseEmail("  Asha.Devi@Example.COM ")).toBe(
      "asha.devi@example.com",
    );
  });
});
