import { describe, expect, it } from "vitest";

import { listingHref, listingSearchParams, pickListingParams } from "./urls";

describe("listingSearchParams", () => {
  it("omits defaults so canonical URLs stay clean", () => {
    expect(
      listingHref("/collections/sarees", { sort: "newest", inStock: false }, 1),
    ).toBe("/collections/sarees");
    expect(listingHref("/search", { q: "fish", sort: "relevance" })).toBe(
      "/search?q=fish",
    );
  });

  it("writes every non-default filter and converts paise back to rupees", () => {
    const href = listingHref(
      "/collections/clothing",
      {
        q: "peacock",
        techniques: ["HAND_PAINTED", "EMBROIDERED"],
        minPriceInPaise: 50_000,
        maxPriceInPaise: 249_999,
        inStock: true,
        sort: "price-asc",
      },
      3,
    );
    expect(href).toBe(
      "/collections/clothing?q=peacock&technique=HAND_PAINTED%2CEMBROIDERED&minPrice=500&maxPrice=2499&inStock=1&sort=price-asc&page=3",
    );
  });

  it("treats newest as the default without a query and relevance as the default with one", () => {
    expect(listingSearchParams({ q: "x", sort: "newest" }).get("sort")).toBe(
      "newest",
    );
    expect(listingSearchParams({ sort: "relevance" }).get("sort")).toBe(
      "relevance",
    );
  });
});

describe("listingHref page size", () => {
  it("carries a non-default page size so pagination stays consistent", () => {
    expect(listingHref("/search", { q: "sample", sort: "title" }, 2, 3)).toBe(
      "/search?q=sample&sort=title&page=2&pageSize=3",
    );
    expect(listingHref("/search", { q: "sample" }, 1, 24)).toBe(
      "/search?q=sample",
    );
  });
});

describe("pickListingParams", () => {
  it("keeps only known keys and drops empty values", () => {
    expect(
      pickListingParams({
        q: "fish",
        technique: ["A", "B"],
        utm_source: "newsletter",
        fbclid: "abc",
        page: "",
        sort: "title",
        pageSize: "12",
      }),
    ).toEqual({
      q: "fish",
      technique: ["A", "B"],
      sort: "title",
      pageSize: "12",
    });
  });
});
