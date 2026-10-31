import { z } from "zod";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/server/auth/password-policy";

/**
 * Form input schemas. Password *policy* (predictability, breach check) is
 * enforced inside Better Auth hooks so it covers every path; these schemas
 * only shape and bound the input.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address")
  .max(254, "That email address is too long")
  .email("Enter a valid email address")
  .transform((value) => value.toLowerCase());

export const passwordInputSchema = z
  .string()
  .min(1, "Enter a password")
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const newPasswordSchema = passwordInputSchema.min(
  PASSWORD_MIN_LENGTH,
  `Use at least ${PASSWORD_MIN_LENGTH} characters`,
);

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Enter your name")
  .max(80, "That name is too long")
  .regex(/^[^<>{}]+$/, "Names cannot contain < > { or }");

/** E.164 with an optional leading +; India is the default market (P2). */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ""))
  .pipe(
    z
      .string()
      .regex(
        /^\+?[1-9]\d{7,14}$/,
        "Enter a valid phone number with country code, e.g. +91 98765 43210",
      ),
  )
  .transform((value) => (value.startsWith("+") ? value : `+91${value}`));

/** Where to go after sign-in: only same-site paths, never protocol-relative. */
export const returnPathSchema = z
  .string()
  .max(512)
  .regex(/^\/(?!\/)/, "Invalid return path")
  .refine((value) => !/[\u0000-\u001f\\]/.test(value), "Invalid return path");

export function safeReturnPath(value: unknown, fallback: string): string {
  const parsed = returnPathSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export const registerSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    password: newPasswordSchema,
    phone: z
      .string()
      .trim()
      .transform((value) => (value === "" ? undefined : value))
      .pipe(phoneSchema.optional()),
  })
  .strict();

export const signInSchema = z
  .object({
    email: emailSchema,
    password: passwordInputSchema,
    next: z.string().optional(),
  })
  .strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(16, "This reset link is not valid").max(512),
    password: newPasswordSchema,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: passwordInputSchema,
    newPassword: newPasswordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "Choose a password you have not used here before",
  });

export type FieldErrors = Readonly<Record<string, string>>;

/** Shape returned by every auth/account Server Action to `useActionState`. */
export interface FormState {
  readonly status: "idle" | "error" | "success";
  /** Message safe to show to the customer. */
  readonly message?: string;
  readonly fieldErrors?: FieldErrors;
}

export const idleFormState: FormState = { status: "idle" };

export function fieldErrorsFrom(error: z.ZodError): FieldErrors {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    errors[key] ??= issue.message;
  }
  return errors;
}
