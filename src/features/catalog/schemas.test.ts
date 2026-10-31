import { describe, expect, it } from "vitest";

import { productListQuerySchema, slugSchema } from "./schemas";

describe("slugSchema", () => {
  it.each(["sarees", "kurta-sets", "a1-b2", "x"])("accepts %s", (slug) => {
    expect(slugSchema.parse(slug)).toBe(slug);
  });

  it.each([
    "",
    "Sarees",
    "kurta sets",
    "-leading",
    "trailing-",
    "double--hyphen",
    "ünïcode",
    "a/b",
  ])("rejects %j", (slug) => {
    expect(slugSchema.safeParse(slug).success).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    expect(slugSchema.parse("  sarees  ")).toBe("sarees");
  });

  it("rejects slugs over 120 characters", () => {
    expect(slugSchema.safeParse("a".repeat(121)).success).toBe(false);
  });
});

describe("productListQuerySchema", () => {
  it("applies defaults", () => {
    expect(productListQuerySchema.parse({})).toEqual({
      category: undefined,
      q: undefined,
      techniques: [],
      minPriceInPaise: undefined,
      maxPriceInPaise: undefined,
      inStock: false,
      sort: "newest",
      page: 1,
      pageSize: 24,
    });
  });

  it("coerces page numbers from query strings", () => {
    expect(
      productListQuerySchema.parse({ page: "3", pageSize: "12" }),
    ).toMatchObject({
      page: 3,
      pageSize: 12,
    });
  });

  it("rejects out-of-range pagination and unknown sorts", () => {
    expect(productListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ pageSize: 49 }).success).toBe(
      false,
    );
    expect(productListQuerySchema.safeParse({ page: 1.5 }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ sort: "cheapest" }).success).toBe(
      false,
    );
  });

  it("rejects unknown keys so typos cannot silently widen a query", () => {
    expect(
      productListQuerySchema.safeParse({ categroy: "sarees" }).success,
    ).toBe(false);
  });

  it("defaults to relevance only when there is a search term", () => {
    expect(productListQuerySchema.parse({ q: "saree" }).sort).toBe("relevance");
    expect(productListQuerySchema.parse({ q: "   " }).sort).toBe("newest");
    expect(
      productListQuerySchema.parse({ q: "saree", sort: "title" }).sort,
    ).toBe("title");
  });

  it("normalises search terms and caps their length", () => {
    expect(
      productListQuerySchema.parse({ q: "  fish \u0000 motif   saree " }).q,
    ).toBe("fish motif saree");
    expect(
      productListQuerySchema.safeParse({ q: "x".repeat(101) }).success,
    ).toBe(false);
  });

  it("accepts techniques as a list, a comma string or repeated keys, de-duplicated", () => {
    expect(
      productListQuerySchema.parse({ technique: "HAND_PAINTED" }).techniques,
    ).toEqual(["HAND_PAINTED"]);
    expect(
      productListQuerySchema.parse({
        technique: "HAND_PAINTED,EMBROIDERED, HAND_PAINTED",
      }).techniques,
    ).toEqual(["HAND_PAINTED", "EMBROIDERED"]);
    expect(
      productListQuerySchema.parse({ technique: ["DIGITAL_PRINT", "APPLIQUE"] })
        .techniques,
    ).toEqual(["DIGITAL_PRINT", "APPLIQUE"]);
    expect(
      productListQuerySchema.safeParse({ technique: "LASER" }).success,
    ).toBe(false);
  });

  it("converts rupee bounds to paise and rejects inverted ranges", () => {
    expect(
      productListQuerySchema.parse({ minPrice: "500", maxPrice: "2000" }),
    ).toMatchObject({
      minPriceInPaise: 50_000,
      maxPriceInPaise: 200_000,
    });
    expect(
      productListQuerySchema.safeParse({ minPrice: 2000, maxPrice: 500 })
        .success,
    ).toBe(false);
    expect(productListQuerySchema.safeParse({ minPrice: -1 }).success).toBe(
      false,
    );
    expect(productListQuerySchema.safeParse({ minPrice: 12.5 }).success).toBe(
      false,
    );
  });

  it("reads the in-stock flag from query strings", () => {
    expect(productListQuerySchema.parse({ inStock: "1" }).inStock).toBe(true);
    expect(productListQuerySchema.parse({ inStock: "false" }).inStock).toBe(
      false,
    );
    expect(productListQuerySchema.safeParse({ inStock: "yes" }).success).toBe(
      false,
    );
  });
});
