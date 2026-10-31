import type {
  ConstructionMethod,
  ProductStatus,
  Technique,
} from "../../src/generated/prisma/enums";

/**
 * DEVELOPMENT FIXTURES — never real merchandise.
 *
 * Every product is prefixed "sample-" and describes itself as a development
 * sample, so it can never be mistaken for a live listing. No images are
 * seeded: the storefront must handle products without photography honestly.
 */

export interface VariantFixture {
  readonly sku: string;
  /** One value per product option, in option order. */
  readonly optionValues?: readonly string[];
  readonly priceInPaise: number;
  readonly compareAtPriceInPaise?: number;
  readonly stockOnHand: number;
  readonly lowStockThreshold?: number;
  readonly isActive?: boolean;
  readonly weightGrams?: number;
}

export interface ProductFixture {
  readonly slug: string;
  readonly title: string;
  readonly subtitle: string;
  readonly description: string;
  /** At least one; the first is the headline technique. */
  readonly techniques: readonly Technique[];
  readonly constructionMethods?: readonly ConstructionMethod[];
  readonly material?: string;
  readonly careInstructions?: string;
  readonly categorySlug: string;
  readonly status: ProductStatus;
  readonly isFeatured?: boolean;
  readonly isOneOfAKind?: boolean;
  readonly options?: ReadonlyArray<{
    readonly name: string;
    readonly values: readonly string[];
  }>;
  readonly variants: readonly VariantFixture[];
}

const SAMPLE_NOTE =
  "Development sample product used to build and test the storefront. Not a real listing.";

const SIZES = ["XS", "S", "M", "L", "XL"] as const;

export const productFixtures: readonly ProductFixture[] = [
  {
    slug: "sample-fish-motif-tussar-saree",
    title: "Fish motif tussar silk saree",
    subtitle: "Development sample",
    description: `${SAMPLE_NOTE} Hand-painted paired fish along the border and pallu, in sindoor red and ochre on natural tussar.`,
    techniques: ["HAND_PAINTED"],
    constructionMethods: ["HANDWOVEN"],
    material: "Tussar silk",
    careInstructions:
      "Dry clean only. Store folded in muslin away from direct sunlight.",
    categorySlug: "sarees",
    status: "ACTIVE",
    isFeatured: true,
    variants: [
      {
        sku: "MY-SAMPLE-0001",
        priceInPaise: 649_900,
        stockOnHand: 3,
        weightGrams: 480,
      },
    ],
  },
  {
    slug: "sample-peacock-kurta-set",
    title: "Peacock kurta set",
    subtitle: "Development sample",
    description: `${SAMPLE_NOTE} Hand-block-printed peacock repeat on a cotton kurta with a plain palazzo.`,
    techniques: ["HAND_BLOCK_PRINTED"],
    constructionMethods: ["MACHINE_STITCHED"],
    material: "Cotton",
    careInstructions: "Gentle machine wash cold, inside out. Do not bleach.",
    categorySlug: "kurta-sets",
    status: "ACTIVE",
    options: [{ name: "Size", values: SIZES }],
    variants: SIZES.map((size, index) => ({
      sku: `MY-SAMPLE-0002-${size}`,
      optionValues: [size],
      priceInPaise: 329_900,
      // One size sold out, one running low, so stock states can be exercised.
      stockOnHand: index === 0 ? 0 : index === 4 ? 1 : 8,
      weightGrams: 420,
    })),
  },
  {
    slug: "sample-lotus-dupatta",
    title: "Lotus dupatta",
    subtitle: "Development sample",
    description: `${SAMPLE_NOTE} A single lotus medallion painted at each end of a cotton-silk dupatta.`,
    techniques: ["HAND_PAINTED"],
    constructionMethods: ["HANDWOVEN"],
    material: "Cotton silk",
    careInstructions: "Dry clean only.",
    categorySlug: "dupattas",
    status: "ACTIVE",
    variants: [
      {
        sku: "MY-SAMPLE-0003",
        priceInPaise: 189_900,
        compareAtPriceInPaise: 229_900,
        stockOnHand: 5,
        weightGrams: 180,
      },
    ],
  },
  {
    slug: "sample-tree-of-life-canvas-print",
    title: "Tree of life canvas print",
    subtitle: "Development sample",
    description: `${SAMPLE_NOTE} Archival print of a tree-of-life composition, available in two sizes, framed or unframed.`,
    techniques: ["DIGITAL_PRINT"],
    constructionMethods: ["STRETCHED_CANVAS", "FRAMED"],
    material: "Cotton canvas, pine frame",
    careInstructions: "Dust with a dry cloth. Keep out of direct sunlight.",
    categorySlug: "canvas-prints",
    status: "ACTIVE",
    isFeatured: true,
    options: [
      { name: "Size", values: ["12 × 18 in", "18 × 24 in"] },
      { name: "Frame", values: ["Unframed", "Framed"] },
    ],
    variants: [
      {
        sku: "MY-SAMPLE-0004-S-U",
        optionValues: ["12 × 18 in", "Unframed"],
        priceInPaise: 249_900,
        stockOnHand: 10,
      },
      {
        sku: "MY-SAMPLE-0004-S-F",
        optionValues: ["12 × 18 in", "Framed"],
        priceInPaise: 399_900,
        stockOnHand: 4,
      },
      {
        sku: "MY-SAMPLE-0004-L-U",
        optionValues: ["18 × 24 in", "Unframed"],
        priceInPaise: 349_900,
        stockOnHand: 6,
      },
      {
        sku: "MY-SAMPLE-0004-L-F",
        optionValues: ["18 × 24 in", "Framed"],
        priceInPaise: 549_900,
        stockOnHand: 0,
      },
    ],
  },
  {
    slug: "sample-kohbar-original",
    title: "Kohbar, original painting",
    subtitle: "Development sample",
    description: `${SAMPLE_NOTE} A one-of-a-kind kohbar painting on handmade paper, framed. Sold once.`,
    techniques: ["HAND_PAINTED"],
    constructionMethods: ["HANDMADE_PAPER", "FRAMED"],
    material: "Natural pigments on handmade paper",
    careInstructions: "Keep away from moisture and direct sunlight.",
    categorySlug: "framed-paintings",
    status: "ACTIVE",
    isFeatured: true,
    isOneOfAKind: true,
    variants: [
      {
        sku: "MY-SAMPLE-0005",
        priceInPaise: 2_400_000,
        stockOnHand: 1,
        lowStockThreshold: 0,
      },
    ],
  },
  {
    slug: "sample-sun-and-moon-cushion-cover",
    title: "Sun and moon cushion cover",
    subtitle: "Development sample",
    description: `${SAMPLE_NOTE} Screen-printed sun and moon faces on heavy cotton, with a concealed zip.`,
    techniques: ["SCREEN_PRINTED"],
    constructionMethods: ["MACHINE_STITCHED"],
    material: "Cotton",
    careInstructions: "Machine wash cold. Iron on reverse.",
    categorySlug: "cushion-covers",
    status: "ACTIVE",
    options: [{ name: "Size", values: ["16 in", "18 in"] }],
    variants: [
      {
        sku: "MY-SAMPLE-0006-16",
        optionValues: ["16 in"],
        priceInPaise: 89_900,
        stockOnHand: 15,
      },
      {
        sku: "MY-SAMPLE-0006-18",
        optionValues: ["18 in"],
        priceInPaise: 99_900,
        stockOnHand: 2,
      },
    ],
  },
  {
    slug: "sample-fish-tote-bag",
    title: "Fish tote bag",
    subtitle: "Development sample",
    description: `${SAMPLE_NOTE} Hand-painted paired fish on a natural canvas tote.`,
    techniques: ["HAND_PAINTED"],
    constructionMethods: ["MACHINE_STITCHED"],
    material: "Canvas",
    categorySlug: "tote-bags",
    status: "ACTIVE",
    isFeatured: true,
    variants: [
      { sku: "MY-SAMPLE-0007", priceInPaise: 129_900, stockOnHand: 12 },
    ],
  },
  {
    slug: "sample-draft-wall-hanging",
    title: "Draft wall hanging",
    subtitle: "Development sample",
    description: `${SAMPLE_NOTE} Still a draft: must never appear on the storefront.`,
    techniques: ["HAND_PAINTED", "EMBROIDERED", "APPLIQUE"],
    constructionMethods: ["HAND_STITCHED"],
    categorySlug: "wall-hangings",
    status: "DRAFT",
    variants: [
      { sku: "MY-SAMPLE-0008", priceInPaise: 159_900, stockOnHand: 2 },
    ],
  },
  {
    slug: "sample-archived-notebook",
    title: "Archived notebook",
    subtitle: "Development sample",
    description: `${SAMPLE_NOTE} Archived: must never appear on the storefront.`,
    techniques: ["DIGITAL_PRINT"],
    constructionMethods: ["MACHINE_STITCHED"],
    categorySlug: "notebooks",
    status: "ARCHIVED",
    variants: [{ sku: "MY-SAMPLE-0009", priceInPaise: 49_900, stockOnHand: 0 }],
  },
];
