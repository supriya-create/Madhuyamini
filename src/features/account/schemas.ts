import { z } from "zod";

import { nameSchema, phoneSchema } from "@/features/auth/schemas";

export const profileSchema = z
  .object({
    name: nameSchema,
    phone: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .pipe(phoneSchema.nullable()),
  })
  .strict();

const line = (label: string, max: number) =>
  z.string().trim().min(1, `Enter ${label}`).max(max, `${label} is too long`);

export const addressSchema = z
  .object({
    label: z
      .string()
      .trim()
      .max(40, "Label is too long")
      .optional()
      .or(z.literal("")),
    recipientName: nameSchema,
    phone: phoneSchema,
    line1: line("the address", 120),
    line2: z
      .string()
      .trim()
      .max(120, "Address line is too long")
      .optional()
      .or(z.literal("")),
    landmark: z
      .string()
      .trim()
      .max(120, "Landmark is too long")
      .optional()
      .or(z.literal("")),
    city: line("the city", 80),
    state: line("the state", 80),
    postalCode: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/, "Enter a six-digit PIN code"),
    isDefault: z
      .union([z.literal("on"), z.literal(""), z.boolean()])
      .optional()
      .transform((value) => value === "on" || value === true),
  })
  .strict()
  .transform((value) => ({
    label: value.label ? value.label : null,
    recipientName: value.recipientName,
    phone: value.phone,
    line1: value.line1,
    line2: value.line2 ? value.line2 : null,
    landmark: value.landmark ? value.landmark : null,
    city: value.city,
    state: value.state,
    postalCode: value.postalCode,
    country: "IN" as const,
    isDefault: value.isDefault,
  }));

export type AddressInput = z.output<typeof addressSchema>;

export const addressIdSchema = z.string().uuid("Invalid address");
export const sessionTokenSchema = z.string().min(16).max(256);
