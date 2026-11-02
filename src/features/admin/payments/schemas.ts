import { z } from "zod";

import { orderIdSchema, rupeesToPaise } from "../orders/schemas";

const reason = z
  .string()
  .trim()
  .min(3, "Give a reason (at least 3 characters)")
  .max(500);

export const recheckSchema = z.object({ orderId: orderIdSchema }).strict();

export const attachPaymentSchema = z
  .object({
    orderId: orderIdSchema,
    providerPaymentId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{6,64}$/, "Paste the provider's payment id"),
    reason,
  })
  .strict();

export const acceptMismatchSchema = z
  .object({
    orderId: orderIdSchema,
    reason,
    confirmOrderNumber: z
      .string()
      .trim()
      .min(1, "Type the order number to confirm"),
  })
  .strict();

export const createRefundSchema = z
  .object({
    orderId: orderIdSchema,
    amount: z
      .string()
      .trim()
      .transform((value, ctx) => {
        const paise = rupeesToPaise(value);
        if (paise === null || paise <= 0) {
          ctx.addIssue({
            code: "custom",
            message: "Enter the amount in rupees",
          });
          return z.NEVER;
        }
        return paise;
      }),
    reason,
    /** Rendered into the form; one refund per form (docs/admin.md §5.5). */
    operationKey: z.uuid(),
  })
  .strict();

export const refundIdSchema = z.uuid();

export const retryRefundSchema = z
  .object({ refundId: refundIdSchema, reason })
  .strict();

export const externalRefundSchema = z
  .object({
    refundId: refundIdSchema,
    providerRefundId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{6,64}$/, "Paste the provider's refund id"),
    reason,
  })
  .strict();
