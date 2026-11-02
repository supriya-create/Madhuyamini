import { z } from "zod";

/** Server-boundary validation for every admin return form (docs/phase-8-returns-custom-artwork.md §8). */

export const returnIdSchema = z.uuid();
const returnItemIdSchema = z.uuid();

const note = z.string().trim().max(1000); // policy-literal-ok: field length
const reason = z
  .string()
  .trim()
  .min(3, "Give a reason (at least 3 characters)")
  .max(500); // policy-literal-ok: field length
const count = z.coerce.number().int().min(0).max(1000); // policy-literal-ok: form ceiling

export const requestInfoSchema = z
  .object({
    returnId: returnIdSchema,
    message: z
      .string()
      .trim()
      .min(3, "Write the question for the customer")
      .max(2000), // policy-literal-ok: field length
  })
  .strict();

export const approveReturnSchema = z
  .object({
    returnId: returnIdSchema,
    instructions: z
      .string()
      .trim()
      .min(10, "Give the customer return instructions")
      .max(2000), // policy-literal-ok: field length
    note: note.optional().or(z.literal("")),
    items: z
      .array(
        z
          .object({ returnItemId: returnItemIdSchema, approvedQty: count })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type ApproveReturnInput = z.infer<typeof approveReturnSchema>;

export const rejectReturnSchema = z
  .object({ returnId: returnIdSchema, reason })
  .strict();

export const staffShipmentSchema = z
  .object({
    returnId: returnIdSchema,
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

export const receiveReturnSchema = z
  .object({
    returnId: returnIdSchema,
    note: reason,
    items: z
      .array(
        z
          .object({ returnItemId: returnItemIdSchema, receivedQty: count })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type ReceiveReturnInput = z.infer<typeof receiveReturnSchema>;

export const RETURN_CONDITIONS = [
  "AS_NEW",
  "OPENED",
  "USED",
  "DAMAGED",
  "WRONG_ITEM",
  "NOT_RECEIVED",
] as const;

export const inspectReturnSchema = z
  .object({
    returnId: returnIdSchema,
    note: reason,
    items: z
      .array(
        z
          .object({
            returnItemId: returnItemIdSchema,
            condition: z.enum(RETURN_CONDITIONS),
            restockQty: count,
            repairQty: count,
            quarantineQty: count,
            writeOffQty: count,
            returnToCustomerQty: count,
            note: note.optional().or(z.literal("")),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type InspectReturnInput = z.infer<typeof inspectReturnSchema>;

export const returnListQuerySchema = z.object({
  status: z
    .enum([
      "open",
      "REQUESTED",
      "INFO_REQUESTED",
      "APPROVED",
      "IN_TRANSIT",
      "OVERDUE",
      "RECEIVED",
      "INSPECTED",
      "CLOSED",
      "REJECTED",
      "WITHDRAWN",
      "EXPIRED",
      "LOST",
    ])
    .optional(),
  q: z.string().trim().max(120).optional(), // policy-literal-ok: query length
  page: z.coerce.number().int().min(1).optional(),
});
