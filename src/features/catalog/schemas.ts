import { z } from "zod";

import { techniqueValues } from "./labels";

/** Public identifiers: lower-case words joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required")
  .max(120, "Slug is too long")
  .regex(
    SLUG_PATTERN,
    "Slug may contain only lower-case letters, numbers and hyphens",
  );

export const productSortValues = [
  "relevance",
  "newest",
  "price-asc",
  "price-desc",
  "title",
] as const;
export const productSortSchema = z.enum(productSortValues);
export type ProductSort = z.infer<typeof productSortSchema>;

export const PRODUCT_PAGE_SIZE_DEFAULT = 24;
export const PRODUCT_PAGE_SIZE_MAX = 48;
export const SEARCH_QUERY_MAX_LENGTH = 100;

/** Search terms: trimmed, length-capped, control characters removed. */
export const searchTermSchema = z
  .string()
  .trim()
  .max(SEARCH_QUERY_MAX_LENGTH, "Search is too long")
  .transform((value) => value.replace(/[\p{Cc}]/gu, "").replace(/\s+/g, " "));

const techniqueSchema = z.enum(techniqueValues);

/** Accepts `a`, `a,b` or `["a","b"]` (repeated query keys) and de-duplicates. */
const techniqueListSchema = z
  .union([techniqueSchema, z.array(techniqueSchema), z.string()])
  .transform((value, ctx) => {
    const raw = Array.isArray(value) ? value : value.split(",");
    const parsed = raw.map((entry) => techniqueSchema.safeParse(entry.trim()));
    const invalid = parsed.find((result) => !result.success);
    if (invalid) {
      ctx.addIssue({ code: "custom", message: "Unknown technique" });
      return z.NEVER;
    }
    return [
      ...new Set(
        parsed.flatMap((result) => (result.success ? [result.data] : [])),
      ),
    ];
  });

/** Whole rupees from the URL; converted to paise so the query never sees rupees. */
const rupeesSchema = z.coerce.number().int().min(0).max(100_000_000);

const booleanFlagSchema = z
  .union([z.boolean(), z.enum(["1", "true", "0", "false"])])
  .transform((value) => value === true || value === "1" || value === "true");

/**
 * Query for a product listing or search. Strict: unknown keys are rejected,
 * so a mistyped parameter can never silently widen a result set.
 */
export const productListQuerySchema = z
  .object({
    category: slugSchema.optional(),
    q: searchTermSchema.optional(),
    technique: techniqueListSchema.optional(),
    minPrice: rupeesSchema.optional(),
    maxPrice: rupeesSchema.optional(),
    inStock: booleanFlagSchema.optional(),
    sort: productSortSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(PRODUCT_PAGE_SIZE_MAX)
      .default(PRODUCT_PAGE_SIZE_DEFAULT),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.minPrice !== undefined &&
      value.maxPrice !== undefined &&
      value.minPrice > value.maxPrice
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["minPrice"],
        message: "Minimum exceeds maximum",
      });
    }
  })
  .transform((value) => {
    const q = value.q && value.q.length > 0 ? value.q : undefined;
    return {
      category: value.category,
      q,
      techniques: value.technique ?? [],
      minPriceInPaise:
        value.minPrice === undefined ? undefined : value.minPrice * 100,
      maxPriceInPaise:
        value.maxPrice === undefined ? undefined : value.maxPrice * 100,
      inStock: value.inStock ?? false,
      // Relevance only means something with a search term.
      sort: value.sort ?? (q ? "relevance" : "newest"),
      page: value.page,
      pageSize: value.pageSize,
    };
  });

export type ProductListQuery = z.output<typeof productListQuerySchema>;

export const featuredLimitSchema = z.number().int().min(1).max(24);
export const relatedLimitSchema = z.number().int().min(1).max(12);
