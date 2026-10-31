import type { ConstructionMethod, Technique } from "@/generated/prisma/enums";

import type { PriceRange, StockStatus } from "./rules";

/**
 * Plain, serialisable shapes returned by the catalog services. UI code depends
 * on these, never on Prisma result types, so the database can change shape
 * without touching components.
 */

export interface CatalogImage {
  readonly url: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  /** Set when the image belongs to one variant (for example a colourway). */
  readonly variantId: string | null;
}

export interface CategorySummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
}

export interface CategoryNode extends CategorySummary {
  readonly children: readonly CategorySummary[];
}

export interface CategoryDetail extends CategoryNode {
  readonly parent: CategorySummary | null;
}

export interface ProductSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly subtitle: string | null;
  /** At least one; the first is the headline technique. */
  readonly techniques: readonly Technique[];
  readonly constructionMethods: readonly ConstructionMethod[];
  readonly isOneOfAKind: boolean;
  readonly category: { readonly slug: string; readonly name: string };
  readonly image: CatalogImage | null;
  /** Null when no variant is active. */
  readonly price: PriceRange | null;
  readonly inStock: boolean;
}

export interface ProductOptionDto {
  readonly id: string;
  readonly name: string;
  readonly values: ReadonlyArray<{
    readonly id: string;
    readonly value: string;
  }>;
}

export interface ProductVariantDto {
  readonly id: string;
  readonly sku: string;
  readonly title: string | null;
  readonly priceInPaise: number;
  readonly compareAtPriceInPaise: number | null;
  readonly isActive: boolean;
  /** One option value per option, in option order. */
  readonly optionValueIds: readonly string[];
  readonly available: number;
  readonly stockStatus: StockStatus;
  readonly isPurchasable: boolean;
}

export interface ProductDetail extends ProductSummary {
  readonly description: string;
  readonly material: string | null;
  readonly careInstructions: string | null;
  readonly images: readonly CatalogImage[];
  readonly options: readonly ProductOptionDto[];
  readonly variants: readonly ProductVariantDto[];
  readonly seo: { readonly title: string; readonly description: string | null };
}

export interface ProductListFilters {
  readonly q: string | null;
  readonly techniques: readonly Technique[];
  readonly minPriceInPaise: number | null;
  readonly maxPriceInPaise: number | null;
  readonly inStock: boolean;
  readonly sort: "relevance" | "newest" | "price-asc" | "price-desc" | "title";
}

export interface ProductPage {
  readonly items: readonly ProductSummary[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly category: CategoryDetail | null;
  /** The validated, normalised filters the page was built from (for controls and links). */
  readonly filters: ProductListFilters;
  /** Filter choices that would return at least one product in this scope. */
  readonly availableTechniques: readonly Technique[];
}
