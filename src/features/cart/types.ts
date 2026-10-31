import type { CatalogImage } from "@/features/catalog/types";

import type { LineAvailability, QuantityLimit } from "./rules";

export interface CartLineView {
  readonly id: string;
  readonly quantity: number;
  readonly product: {
    readonly slug: string;
    readonly title: string;
    readonly isOneOfAKind: boolean;
    readonly image: CatalogImage | null;
  };
  readonly variant: {
    readonly id: string;
    readonly sku: string;
    readonly title: string | null;
  };
  /** Live price from the database (C5). */
  readonly unitPriceInPaise: number;
  /** Price when the line was added; shown when it differs from the live price. */
  readonly priceSeenInPaise: number;
  readonly priceChanged: boolean;
  readonly lineTotalInPaise: number;
  readonly available: number;
  readonly availability: LineAvailability;
  /** Highest quantity the customer may choose right now (0 when unavailable). */
  readonly maxQuantity: number;
}

export interface CartView {
  readonly id: string | null;
  readonly lines: readonly CartLineView[];
  readonly itemCount: number;
  readonly subtotalInPaise: number;
  readonly canCheckout: boolean;
  readonly hasAvailabilityIssues: boolean;
  readonly hasPriceChanges: boolean;
}

export interface AddToCartResult {
  readonly quantityAdded: number;
  readonly quantityInCart: number;
  readonly limitedBy: QuantityLimit;
  readonly itemCount: number;
}
