import { z } from "zod";

import { returnPathSchema } from "@/features/auth/schemas";

export const totpCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the six-digit code"));

export const recoveryCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase().replace(/[^0-9A-Z]/g, ""))
  .pipe(
    z
      .string()
      .regex(
        /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/,
        "Enter a recovery code",
      ),
  );

export const confirmEnrolmentSchema = z
  .object({
    code: totpCodeSchema,
    next: returnPathSchema.optional().or(z.literal("")),
  })
  .strict();

export const verifySecondFactorSchema = z
  .object({
    method: z.enum(["totp", "recovery"]),
    code: z.string().trim().min(1, "Enter the code").max(40),
    next: returnPathSchema.optional().or(z.literal("")),
  })
  .strict();
