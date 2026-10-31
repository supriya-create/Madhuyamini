/**
 * Single source of truth for internal URLs.
 *
 * Several routes belong to later phases (catalog, content pages). Links to them
 * are tracked by e2e/pending-routes.ts and must all resolve before launch.
 */
export const routes = {
  home: "/",
  heritage: "/#heritage",
  collections: "/collections",
  collection: (slug: string) => `/collections/${slug}`,
  product: (slug: string) => `/products/${slug}`,
  search: "/search",
  customArtwork: "/custom-artwork",
  contact: "/contact",
  careGuide: "/care-guide",
  policy: (slug: "shipping" | "returns" | "privacy" | "terms") =>
    `/policies/${slug}`,
} as const;
