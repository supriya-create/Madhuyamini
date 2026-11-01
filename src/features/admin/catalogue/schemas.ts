import { z } from "zod";

import { SLUG_PATTERN } from "@/features/catalog/schemas";
import { rupeesToPaise } from "../orders/schemas";

/** Server-boundary validation for the catalogue forms (docs/admin.md §5.2). */

export const idSchema = z.uuid();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value));

const TECHNIQUES = [
  "HAND_PAINTED",
  "HAND_BLOCK_PRINTED",
  "SCREEN_PRINTED",
  "DIGITAL_PRINT",
  "EMBROIDERED",
  "APPLIQUE",
] as const;

const CONSTRUCTION = [
  "HANDWOVEN",
  "MILL_WOVEN",
  "HAND_STITCHED",
  "MACHINE_STITCHED",
  "HANDMADE_PAPER",
  "STRETCHED_CANVAS",
  "FRAMED",
] as const;

/** Comma-separated enum list from a multi-select rendered as checkboxes. */
function enumList<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)));
}

export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80); // policy-literal-ok: slug length
}

export const productSchema = z
  .object({
    title: z.string().trim().min(2, "Give the piece a title").max(160),
    slug: z
      .string()
      .trim()
      .max(80)
      .transform((value) => value.toLowerCase())
      .refine(
        (value) => value === "" || SLUG_PATTERN.test(value),
        "Lower-case letters, digits and hyphens only",
      ),
    subtitle: optionalText(200),
    description: z
      .string()
      .trim()
      .min(20, "Describe the piece (at least 20 characters)")
      .max(5000), // policy-literal-ok: field length
    techniques: enumList(TECHNIQUES).refine(
      (list) => list.length > 0,
      "Choose at least one technique",
    ),
    constructionMethods: enumList(CONSTRUCTION),
    material: optionalText(200),
    careInstructions: optionalText(1000), // policy-literal-ok: field length
    categoryId: idSchema,
    isFeatured: z.enum(["on", ""]).transform((value) => value === "on"),
    isOneOfAKind: z.enum(["on", ""]).transform((value) => value === "on"),
    metaTitle: optionalText(160),
    metaDescription: optionalText(320),
    hsnCode: optionalText(16),
    taxRateBp: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : Number(value)))
      .refine(
        (value) =>
          value === null ||
          (Number.isInteger(value) && value >= 0 && value <= 10_000), // policy-literal-ok: basis points
        "Tax rate in basis points (0 to 10000)",
      ), // policy-literal-ok: bound
  })
  .strict();

export type ProductInput = z.output<typeof productSchema>;

/**
 * Options arrive as lines "Size: XS, S, M". Names and values are trimmed,
 * duplicates dropped, order kept.
 */
export function parseOptionLines(
  text: string,
): Array<{ name: string; values: string[] }> {
  const options: Array<{ name: string; values: string[] }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [name, rest] = line.split(":", 2);
    const cleanName = name?.trim() ?? "";
    if (!cleanName || rest === undefined)
      throw new Error(`Each line needs "Name: value, value" (got "${line}")`);
    const values = [
      ...new Set(
        rest
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ];
    if (values.length === 0)
      throw new Error(`Option "${cleanName}" needs at least one value`);
    if (options.some((o) => o.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(`Option "${cleanName}" is listed twice`);
    }
    options.push({ name: cleanName, values });
  }
  return options;
}

export const optionsSchema = z
  .object({
    productId: idSchema,
    options: z
      .string()
      .max(2000) // policy-literal-ok: field length
      .transform((value, ctx) => {
        try {
          return parseOptionLines(value);
        } catch (error) {
          ctx.addIssue({
            code: "custom",
            message: error instanceof Error ? error.message : "Invalid options",
          });
          return z.NEVER;
        }
      }),
  })
  .strict();

const rupees = (message: string) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      const paise = rupeesToPaise(value);
      if (paise === null || paise <= 0) {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return paise;
    });

const optionalRupees = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    const paise = rupeesToPaise(value);
    if (paise === null || paise <= 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in rupees" });
      return z.NEVER;
    }
    return paise;
  });

const variantCore = {
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9-]{2,39}$/,
      "SKU: 3 to 40 letters, digits and hyphens",
    ),
  price: rupees("Enter the price in rupees"),
  compareAt: optionalRupees,
  weightGrams: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : Number(value)))
    .refine(
      (value) =>
        value === null ||
        (Number.isInteger(value) && value >= 0 && value <= 100_000), // policy-literal-ok: grams bound
      "Weight in whole grams",
    ), // policy-literal-ok: bound
  isActive: z.enum(["on", ""]).transform((value) => value === "on"),
  optionValueIds: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(idSchema)),
};

export const createVariantSchema = z
  .object({
    productId: idSchema,
    ...variantCore,
    initialStock: z.coerce.number().int().min(0).max(100_000), // policy-literal-ok: bound
    lowStockThreshold: z.coerce.number().int().min(0).max(10_000), // policy-literal-ok: bound
  })
  .strict();

export const updateVariantSchema = z
  .object({ variantId: idSchema, ...variantCore })
  .strict();

export const variantIdOnlySchema = z.object({ variantId: idSchema }).strict();
export const productIdOnlySchema = z.object({ productId: idSchema }).strict();

export const deleteProductSchema = z
  .object({
    productId: idSchema,
    confirmSlug: z.string().trim().min(1, "Type the slug to confirm"),
  })
  .strict();

const alt = z
  .string()
  .trim()
  .min(3, "Describe the image for people who cannot see it")
  .max(300);

export const attachUploadSchema = z
  .object({
    productId: idSchema,
    publicId: z.string().trim().min(1).max(300),
    version: z
      .string()
      .trim()
      .regex(/^\d{1,20}$/),
    signature: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{40}$/),
    format: z.string().trim().toLowerCase().max(10),
    bytes: z.coerce.number().int().min(1),
    width: z.coerce.number().int().min(1),
    height: z.coerce.number().int().min(1),
    resourceType: z.string().trim().max(20),
    alt,
  })
  .strict();

export const imageUrlSchema = z
  .object({
    productId: idSchema,
    url: z
      .string()
      .trim()
      .max(1000) // policy-literal-ok: field length
      .refine(
        (value) => /^https:\/\/[^\s]+$/.test(value),
        "An https:// image address",
      ),
    alt,
    width: z.coerce.number().int().min(1).max(20_000), // policy-literal-ok: bound
    height: z.coerce.number().int().min(1).max(20_000), // policy-literal-ok: bound
  })
  .strict();

export const updateImageSchema = z
  .object({
    imageId: idSchema,
    alt,
    variantId: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .pipe(idSchema.nullable()),
  })
  .strict();

export const moveImageSchema = z
  .object({ imageId: idSchema, direction: z.enum(["up", "down"]) })
  .strict();

export const imageIdOnlySchema = z.object({ imageId: idSchema }).strict();

export const categorySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    slug: z
      .string()
      .trim()
      .max(80)
      .transform((value) => value.toLowerCase())
      .refine(
        (value) => value === "" || SLUG_PATTERN.test(value),
        "Lower-case letters, digits and hyphens only",
      ),
    description: optionalText(500),
    parentId: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .pipe(idSchema.nullable()),
    position: z.coerce.number().int().min(0).max(1000), // policy-literal-ok: bound
    isActive: z.enum(["on", ""]).transform((value) => value === "on"),
  })
  .strict();

export const categoryIdSchema = z.object({ categoryId: idSchema }).strict();

export const productListQuerySchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional().catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined), // policy-literal-ok: page bound
});
