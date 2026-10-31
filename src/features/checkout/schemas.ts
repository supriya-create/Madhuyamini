import { z } from "zod";

import { emailSchema, nameSchema, phoneSchema } from "@/features/auth/schemas";

import type { AddressSnapshot } from "./types";

/**
 * Checkout inputs. The client sends identities and choices only; every
 * amount is recomputed on the server and compared through `quoteHash`.
 */

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .optional()
    .or(z.literal(""));

const requiredLine = (label: string, max: number) =>
  z.string().trim().min(1, `Enter ${label}`).max(max, `${label} is too long`);

export const paymentMethodSchema = z.enum(["RAZORPAY", "COD"]);

export const placeOrderFormSchema = z
  .object({
    cartId: z.string().uuid("Your cart could not be found"),
    email: emailSchema,
    phone: phoneSchema,
    paymentMethod: paymentMethodSchema,
    quoteHash: z.string().min(16).max(128),
    customerNote: optionalText("Your note", 500),
    /** A saved address (signed-in customers) instead of the fields below. */
    addressId: z.string().uuid().optional().or(z.literal("")),
    recipientName: optionalText("The recipient's name", 80),
    line1: optionalText("The address", 120),
    line2: optionalText("Address line", 120),
    landmark: optionalText("Landmark", 120),
    city: optionalText("The city", 80),
    state: optionalText("The state", 80),
    postalCode: optionalText("PIN code", 10),
    saveAddress: z.union([z.literal("on"), z.literal("")]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.addressId) return;
    const required = [
      ["recipientName", requiredLine("the recipient's name", 80)],
      ["line1", requiredLine("the address", 120)],
      ["city", requiredLine("the city", 80)],
      ["state", requiredLine("the state", 80)],
      [
        "postalCode",
        z
          .string()
          .trim()
          .regex(/^[1-9][0-9]{5}$/, "Enter a six-digit PIN code"),
      ],
    ] as const;
    for (const [field, schema] of required) {
      const result = schema.safeParse(value[field] ?? "");
      if (!result.success) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: result.error.issues[0]?.message ?? `Enter ${field}`,
        });
      }
    }
    if (
      value.recipientName &&
      !nameSchema.safeParse(value.recipientName).success
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["recipientName"],
        message: "Enter the recipient's name",
      });
    }
  })
  .transform((value) => ({
    cartId: value.cartId,
    email: value.email,
    phone: value.phone,
    paymentMethod: value.paymentMethod,
    quoteHash: value.quoteHash,
    customerNote: value.customerNote ? value.customerNote : null,
    addressId: value.addressId ? value.addressId : null,
    address: value.addressId
      ? null
      : ({
          recipientName: value.recipientName ?? "",
          line1: value.line1 ?? "",
          line2: value.line2 ? value.line2 : null,
          landmark: value.landmark ? value.landmark : null,
          city: value.city ?? "",
          state: value.state ?? "",
          postalCode: value.postalCode ?? "",
          country: "IN",
        } satisfies AddressSnapshot),
    saveAddress: value.saveAddress === "on",
  }));

export type PlaceOrderForm = z.output<typeof placeOrderFormSchema>;

export const orderIdSchema = z
  .object({ orderId: z.string().uuid("Order not found") })
  .strict();

export const trackOrderSchema = z
  .object({
    orderNumber: z.string().trim().min(1, "Enter your order number").max(20),
    email: emailSchema,
  })
  .strict();

/** What Razorpay's checkout hands back on success, as posted by the pay page. */
export const confirmPaymentSchema = z
  .object({
    orderId: z.string().uuid("Order not found"),
    razorpay_order_id: z.string().trim().min(1).max(64),
    razorpay_payment_id: z.string().trim().min(1).max(64),
    razorpay_signature: z.string().trim().min(1).max(256),
  })
  .strict();

export const paymentFailureSchema = z
  .object({
    orderId: z.string().uuid("Order not found"),
    razorpay_order_id: z.string().trim().max(64).optional().or(z.literal("")),
    razorpay_payment_id: z.string().trim().max(64).optional().or(z.literal("")),
    code: z.string().trim().max(64).optional().or(z.literal("")),
    description: z.string().trim().max(256).optional().or(z.literal("")),
  })
  .strict();
