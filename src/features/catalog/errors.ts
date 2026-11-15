import type { ProductListFilters } from "./types";

/**
 * Raised by `listProducts` when the requested page lies past the last page
 * of a non-empty result. Pages catch it in `resolveCatalog` and redirect to
 * the last page with the same filters, so a stale or mistyped `page` never
 * reads as an empty catalogue. An empty result never raises it (nothing to
 * redirect to, and no loop).
 */
export class PageOutOfRangeError extends Error {
  readonly lastPage: number;
  readonly pageSize: number;
  readonly filters: ProductListFilters;

  constructor(input: {
    lastPage: number;
    pageSize: number;
    filters: ProductListFilters;
  }) {
    super(`page is past the last page (${input.lastPage})`);
    this.name = "PageOutOfRangeError";
    this.lastPage = input.lastPage;
    this.pageSize = input.pageSize;
    this.filters = input.filters;
  }
}
