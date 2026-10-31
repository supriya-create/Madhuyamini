import { z } from "zod";

import { MAX_LINE_QUANTITY } from "./rules";

const uuid = z.string().uuid();

export const addToCartSchema = z
  .object({
    variantId: uuid,
    quantity: z.coerce.number().int().min(1).max(MAX_LINE_QUANTITY).default(1),
  })
  .strict();

export const updateLineSchema = z
  .object({
    lineId: uuid,
    /** 0 removes the line. */
    quantity: z.coerce.number().int().min(0).max(MAX_LINE_QUANTITY),
  })
  .strict();

export const lineIdSchema = z.object({ lineId: uuid }).strict();

export const wishlistToggleSchema = z
  .object({
    productId: uuid,
    /** Where to return to after the toggle (validated as a same-site path). */
    returnTo: z
      .string()
      .max(512)
      .regex(/^\/(?!\/)/)
      .optional(),
  })
  .strict();
