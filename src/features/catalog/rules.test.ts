import { describe, expect, it } from "vitest";

import {
  availableStock,
  escapeLikePattern,
  findVariantForSelection,
  isPurchasable,
  normaliseEmail,
  paginationWindow,
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

describe("escapeLikePattern", () => {
  it("escapes LIKE metacharacters so user text matches literally", () => {
    expect(escapeLikePattern("100% silk_blend \\ saree")).toBe(
      "100\\% silk\\_blend \\\\ saree",
    );
    expect(escapeLikePattern("plain")).toBe("plain");
  });
});

describe("findVariantForSelection", () => {
  const variants = [
    { id: "v1", optionValueIds: ["size-m", "frame-no"] },
    { id: "v2", optionValueIds: ["size-m", "frame-yes"] },
    { id: "v3", optionValueIds: ["size-l", "frame-yes"] },
  ];

  it("matches a complete selection regardless of order", () => {
    expect(
      findVariantForSelection(variants, ["frame-yes", "size-m"], 2)?.id,
    ).toBe("v2");
  });

  it("returns null while the selection is incomplete or impossible", () => {
    expect(findVariantForSelection(variants, ["size-m"], 2)).toBeNull();
    expect(
      findVariantForSelection(variants, ["size-l", "frame-no"], 2),
    ).toBeNull();
  });

  it("matches the single variant of a product without options", () => {
    expect(
      findVariantForSelection([{ id: "only", optionValueIds: [] }], [], 0)?.id,
    ).toBe("only");
  });
});

describe("paginationWindow", () => {
  it("is empty for a single page", () => {
    expect(paginationWindow(1, 1)).toEqual([]);
  });

  it("keeps first, last and neighbours with gaps", () => {
    expect(paginationWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(paginationWindow(1, 4)).toEqual([1, 2, null, 4]);
    expect(paginationWindow(3, 3)).toEqual([1, 2, 3]);
  });
});
