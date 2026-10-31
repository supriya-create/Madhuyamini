import { z } from "zod";

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

export const productSortSchema = z.enum(["newest", "title"]);
export type ProductSort = z.infer<typeof productSortSchema>;

export const PRODUCT_PAGE_SIZE_DEFAULT = 24;
export const PRODUCT_PAGE_SIZE_MAX = 48;

/** Query for a product listing. Strict: unknown keys are rejected. */
export const productListQuerySchema = z
  .object({
    category: slugSchema.optional(),
    sort: productSortSchema.default("newest"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(PRODUCT_PAGE_SIZE_MAX)
      .default(PRODUCT_PAGE_SIZE_DEFAULT),
  })
  .strict();

export type ProductListQuery = z.output<typeof productListQuerySchema>;

export const featuredLimitSchema = z.number().int().min(1).max(24);
