import { z } from "zod";

/** Customer-area forms (docs/admin.md §5.7). */

export const userIdSchema = z.uuid();

const reason = z
  .string()
  .trim()
  .min(3, "Give a reason (at least 3 characters)")
  .max(500);

export const PII_FIELDS = ["email", "phone", "address"] as const;
export type PiiField = (typeof PII_FIELDS)[number];

const fieldList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(PII_FIELDS)).min(1, "Choose at least one field"));

export const customerSearchSchema = z.object({
  q: z.string().trim().max(160).optional().catch(undefined),
  role: z.enum(["CUSTOMER", "STAFF", "ADMIN"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(undefined), // policy-literal-ok: page bound
});

export const grantSchema = z
  .object({
    granteeId: userIdSchema,
    /** Empty = any customer during a support shift. */
    customerId: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .pipe(userIdSchema.nullable()),
    fields: fieldList,
    hours: z.coerce.number().int().min(1).max(24), // policy-literal-ok: grant ceiling is also enforced by SQL
    reason,
  })
  .strict();

export const grantIdSchema = z.object({ grantId: userIdSchema }).strict();

export const revealSchema = z
  .object({ customerId: userIdSchema, fields: fieldList, reason })
  .strict();

export const setRoleSchema = z
  .object({
    userId: userIdSchema,
    role: z.enum(["CUSTOMER", "STAFF", "ADMIN"]),
    reason,
    confirmEmail: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Type the email to confirm"),
  })
  .strict();

export const resetTwoFactorSchema = z
  .object({ userId: userIdSchema, reason })
  .strict();

export const userIdOnlySchema = z.object({ userId: userIdSchema }).strict();
