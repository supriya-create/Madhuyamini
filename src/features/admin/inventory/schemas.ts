import { z } from "zod";

export const variantIdSchema = z.uuid();

const reason = z
  .string()
  .trim()
  .min(3, "Give a reason (at least 3 characters)")
  .max(500);

/** Signed, whole, non-zero; the sign must suit the kind. */
export const adjustInventorySchema = z
  .object({
    variantId: variantIdSchema,
    kind: z.enum(["RECEIVED", "CORRECTION", "WRITE_OFF"]),
    delta: z.coerce
      .number()
      .int("Whole units only")
      .refine((value) => value !== 0, "The change cannot be zero")
      .refine((value) => Math.abs(value) <= 100_000, "That is too many units"), // policy-literal-ok: sanity bound
    reason,
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.kind === "RECEIVED" && input.delta < 0) {
      ctx.addIssue({
        code: "custom",
        path: ["delta"],
        message: "Received stock adds units",
      });
    }
    if (input.kind === "WRITE_OFF" && input.delta > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["delta"],
        message: "A write-off removes units",
      });
    }
  });

export const thresholdSchema = z
  .object({
    variantId: variantIdSchema,
    threshold: z.coerce.number().int().min(0).max(10_000), // policy-literal-ok: sanity bound
  })
  .strict();

export const levelsQuerySchema = z.object({
  low: z.enum(["1"]).optional().catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined), // policy-literal-ok: page bound
});
