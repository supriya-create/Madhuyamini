import { z } from "zod";

import { returnReasonValues } from "@/config/returns-policy";

/**
 * Server-boundary validation for the customer return forms
 * (docs/phase-8-returns-custom-artwork.md §8). Lengths are policy values
 * applied by the service; these schemas bound the shape and the types.
 */

export const uuid = z.uuid();

export const requestNumberSchema = z
  .string()
  .trim()
  .regex(/^RT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/i, "Not a return number");

export const orderNumberSchema = z
  .string()
  .trim()
  .regex(/^MY-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/i, "Not an order number");

const quantity = z.coerce.number().int().min(1).max(10); // policy-literal-ok: clampQuantity ceiling

export const returnLineSchema = z
  .object({
    orderItemId: uuid,
    quantity,
    reason: z.enum(returnReasonValues),
    description: z.string().trim().max(1000).optional().or(z.literal("")), // policy-literal-ok: field length
    resolution: z.enum(["REFUND", "EXCHANGE"]).default("REFUND"),
    exchangeVariantId: uuid.optional().or(z.literal("")),
  })
  .strict();

export const submitReturnSchema = z
  .object({
    orderNumber: orderNumberSchema,
    operationKey: uuid,
    lines: z.array(returnLineSchema).min(1, "Choose at least one item"),
    evidenceIds: z.array(uuid).max(12), // policy-literal-ok: evidence.maxPerRequest mirror
  })
  .strict();

export type SubmitReturnInput = z.infer<typeof submitReturnSchema>;

export const withdrawReturnSchema = z
  .object({ requestNumber: requestNumberSchema })
  .strict();

export const replyReturnSchema = z
  .object({
    requestNumber: requestNumberSchema,
    body: z.string().trim().min(2, "Write a message").max(2000), // policy-literal-ok: field length
  })
  .strict();

export const recordShipmentSchema = z
  .object({
    requestNumber: requestNumberSchema,
    carrier: z.string().trim().min(2, "Name the carrier").max(80),
    trackingNumber: z.string().trim().max(80).optional().or(z.literal("")),
    trackingUrl: z
      .string()
      .trim()
      .max(500)
      .refine(
        (value) => value === "" || /^https:\/\/[^\s]+$/.test(value),
        "Tracking links must start with https://",
      )
      .optional()
      .or(z.literal("")),
  })
  .strict();

export const addEvidenceSchema = z
  .object({
    requestNumber: requestNumberSchema,
    evidenceIds: z.array(uuid).min(1).max(12), // policy-literal-ok: evidence.maxPerRequest mirror
  })
  .strict();

/** What the browser reports back after a Cloudinary upload; nothing is trusted until verified. */
export const uploadFactsSchema = z
  .object({
    uploadId: uuid,
    publicId: z.string().min(1).max(300),
    version: z.string().regex(/^\d+$/),
    signature: z.string().regex(/^[a-f0-9]{40}$/),
    format: z.string().trim().min(1).max(10),
    bytes: z.coerce.number().int().nonnegative(),
    width: z.coerce.number().int().nonnegative(),
    height: z.coerce.number().int().nonnegative(),
    resourceType: z.string().trim().min(1).max(20),
    etag: z.string().trim().max(64).optional().or(z.literal("")),
  })
  .strict();

export type UploadFacts = z.infer<typeof uploadFactsSchema>;
