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
    expect(
      productListQuerySchema.safeParse({ sort: "price-asc" }).success,
    ).toBe(false);
  });

  it("rejects unknown keys so typos cannot silently widen a query", () => {
    expect(
      productListQuerySchema.safeParse({ categroy: "sarees" }).success,
    ).toBe(false);
  });
});
