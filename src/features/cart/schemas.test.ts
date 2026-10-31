import { describe, expect, it } from "vitest";

import { addToCartSchema, updateLineSchema } from "./schemas";

const variantId = "01a19191-8666-76ec-9817-ad6d18c5dc41";

describe("cart schemas", () => {
  it("coerces quantities from form strings and bounds them", () => {
    expect(addToCartSchema.parse({ variantId, quantity: "3" })).toEqual({
      variantId,
      quantity: 3,
    });
    expect(addToCartSchema.parse({ variantId })).toEqual({
      variantId,
      quantity: 1,
    });
    expect(
      addToCartSchema.safeParse({ variantId, quantity: "11" }).success,
    ).toBe(false);
    expect(
      addToCartSchema.safeParse({ variantId, quantity: "0" }).success,
    ).toBe(false);
    expect(
      addToCartSchema.safeParse({ variantId, quantity: "1.5" }).success,
    ).toBe(false);
  });

  it("rejects non-UUID ids and any price-looking extra fields", () => {
    expect(
      addToCartSchema.safeParse({ variantId: "sarees", quantity: 1 }).success,
    ).toBe(false);
    expect(
      addToCartSchema.safeParse({ variantId, quantity: 1, priceInPaise: 1 })
        .success,
    ).toBe(false);
    expect(
      updateLineSchema.safeParse({ lineId: variantId, quantity: 0 }).success,
    ).toBe(true);
    expect(
      updateLineSchema.safeParse({ lineId: variantId, quantity: -1 }).success,
    ).toBe(false);
  });
});
