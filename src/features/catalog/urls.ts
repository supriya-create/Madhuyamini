import type { ProductListFilters } from "./types";

/**
 * Builds listing URLs from validated filters. Only non-default values are
 * written, so canonical pages keep clean URLs and links never carry noise.
 * Safe to import on the client (no server dependencies).
 */
export const DEFAULT_PAGE_SIZE = 24;

export function listingSearchParams(
  filters: Partial<ProductListFilters>,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): URLSearchParams {
  const params = new URLSearchParams();
  const q = filters.q?.trim();
  if (q) params.set("q", q);
  if (filters.techniques && filters.techniques.length > 0) {
    params.set("technique", [...filters.techniques].join(","));
  }
  if (
    filters.minPriceInPaise !== null &&
    filters.minPriceInPaise !== undefined
  ) {
    params.set("minPrice", String(Math.floor(filters.minPriceInPaise / 100)));
  }
  if (
    filters.maxPriceInPaise !== null &&
    filters.maxPriceInPaise !== undefined
  ) {
    params.set("maxPrice", String(Math.floor(filters.maxPriceInPaise / 100)));
  }
  if (filters.inStock) params.set("inStock", "1");
  const defaultSort = q ? "relevance" : "newest";
  if (filters.sort && filters.sort !== defaultSort)
    params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  if (pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(pageSize));
  return params;
}

export function listingHref(
  pathname: string,
  filters: Partial<ProductListFilters>,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): string {
  const query = listingSearchParams(filters, page, pageSize).toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Keys the listing pages accept from the URL; everything else (utm_*, fbclid…) is ignored. */
const LISTING_KEYS = [
  "q",
  "technique",
  "minPrice",
  "maxPrice",
  "inStock",
  "sort",
  "page",
  "pageSize",
] as const;

type RawSearchParams = Record<string, string | string[] | undefined>;

export function pickListingParams(
  searchParams: RawSearchParams,
): Partial<RawSearchParams> {
  const picked: Partial<RawSearchParams> = {};
  for (const key of LISTING_KEYS) {
    const value = searchParams[key];
    if (value !== undefined && value !== "") picked[key] = value;
  }
  return picked;
}
