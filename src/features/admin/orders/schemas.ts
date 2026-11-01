import { z } from "zod";

import { DELIVERY_FAILURE_REASONS } from "./types";

/** Server-boundary validation for every admin order form (docs/admin.md §7). */

export const orderIdSchema = z.uuid();

const reason = z
  .string()
  .trim()
  .min(3, "Give a reason (at least 3 characters)")
  .max(500);
const note = z.string().trim().max(1000); // policy-literal-ok: field length

export const shipSchema = z
  .object({
    orderId: orderIdSchema,
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

export const deliveryFailedSchema = z
  .object({
    orderId: orderIdSchema,
    reason: z.enum(DELIVERY_FAILURE_REASONS),
    note: note.optional().or(z.literal("")),
  })
  .strict();

export const parcelReturnedSchema = z
  .object({ orderId: orderIdSchema, note: reason })
  .strict();

export const carrierLossSchema = z
  .object({
    orderId: orderIdSchema,
    claimReference: z
      .string()
      .trim()
      .min(2, "Enter the carrier's claim reference")
      .max(120),
    reason,
  })
  .strict();

export const cancelOrderSchema = z
  .object({
    orderId: orderIdSchema,
    reason,
    confirmOrderNumber: z
      .string()
      .trim()
      .min(1, "Type the order number to confirm"),
  })
  .strict();

export const codReverseSchema = z
  .object({ orderId: orderIdSchema, reason })
  .strict();

export const staffNoteSchema = z
  .object({
    orderId: orderIdSchema,
    note: z.string().trim().min(1, "Write a note").max(1000), // policy-literal-ok: field length
  })
  .strict();

/** Rupees typed by a person ("1,299" or "1299.50") to integer paise. */
export function rupeesToPaise(value: string): number | null {
  const clean = value.replace(/[,\s₹]/g, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(clean)) return null;
  const [whole = "0", fraction = ""] = clean.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0")); // policy-literal-ok: paise
}

export const codCollectSchema = z
  .object({
    orderId: orderIdSchema,
    amount: z
      .string()
      .trim()
      .transform((value, ctx) => {
        const paise = rupeesToPaise(value);
        if (paise === null) {
          ctx.addIssue({
            code: "custom",
            message: "Enter the amount collected in rupees",
          });
          return z.NEVER;
        }
        return paise;
      }),
    reason: note.optional().or(z.literal("")),
  })
  .strict();

export const inspectionItemSchema = z
  .object({
    orderItemId: orderIdSchema,
    restockQty: z.coerce.number().int().min(0).max(1000), // policy-literal-ok: quantity bound
    writeOffQty: z.coerce.number().int().min(0).max(1000), // policy-literal-ok: quantity bound
  })
  .strict();

export const inspectionSchema = z
  .object({
    orderId: orderIdSchema,
    note: reason,
    items: z.array(inspectionItemSchema).min(1),
  })
  .strict();

export type InspectionInput = z.infer<typeof inspectionSchema>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => new Date(`${value}T00:00:00+05:30`))
  .refine((value) => !Number.isNaN(value.getTime()), "Invalid date");

export const orderListQuerySchema = z.object({
  status: z
    .enum([
      "PENDING_PAYMENT",
      "CONFIRMED",
      "CANCELLED",
      "NEEDS_REVIEW",
      "PROCESSING",
      "SHIPPED",
      "DELIVERED",
      "DELIVERY_FAILED",
      "RETURNED",
    ])
    .optional()
    .catch(undefined),
  method: z.enum(["RAZORPAY", "COD"]).optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000) // policy-literal-ok: page bound
    .optional()
    .catch(undefined),
});
