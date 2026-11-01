import { z } from "zod";

/**
 * Every knob of the admin area, second-factor sign-in, customer-data
 * reveals, uploads and the sweeps around them (docs/admin.md). Nothing else
 * declares a duration, a limit or a size; the literal scan in
 * checkout-policy.test.ts covers the admin modules too.
 */

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const rateLimitRule = z
  .object({ windowSeconds: positiveInt, max: positiveInt })
  .strict();

export const adminPolicySchema = z
  .object({
    totp: z
      .object({
        digits: z.union([z.literal(6), z.literal(8)]),
        periodSeconds: positiveInt,
        /** Steps of tolerance either side of "now" for clock drift. */
        windowSteps: nonNegativeInt,
        secretBytes: positiveInt,
        issuer: z.string().min(1),
      })
      .strict(),
    recovery: z
      .object({ codeCount: positiveInt, codeLength: positiveInt })
      .strict(),
    sessions: z
      .object({
        /** Sensitive operations need a second-factor check this recent. */
        reauthWindowMinutes: positiveInt,
        /** An enrolment that is not confirmed within this time is discarded. */
        enrolmentMinutes: positiveInt,
      })
      .strict(),
    pii: z
      .object({
        revealMinutes: positiveInt,
        grantMaxHours: positiveInt,
        grantDefaultHours: positiveInt,
        /** Fields a grant may name. */
        fields: z.array(z.enum(["email", "phone", "address"])).nonempty(),
      })
      .strict(),
    uploads: z
      .object({
        folder: z.string().regex(/^[a-z0-9/_-]+$/),
        formats: z.array(z.string().min(1)).nonempty(),
        maxBytes: positiveInt,
        minDimension: positiveInt,
        maxDimension: positiveInt,
        /** Issued-but-never-attached assets are deleted after this. */
        orphanGraceHours: positiveInt,
      })
      .strict(),
    review: z.object({ allowUnderpaymentAccept: z.boolean() }).strict(),
    lists: z
      .object({ pageSize: positiveInt, maxPageSize: positiveInt })
      .strict(),
    limits: z
      .object({
        totpPerUser: rateLimitRule,
        totpPerIp: rateLimitRule,
        recoveryPerUser: rateLimitRule,
        enrolmentPerUser: rateLimitRule,
        roleChangePerActor: rateLimitRule,
        refundPerActor: rateLimitRule,
        grantPerActor: rateLimitRule,
        revealPerActor: rateLimitRule,
      })
      .strict(),
  })
  .strict();

export type AdminPolicy = z.infer<typeof adminPolicySchema>;

export const adminPolicy: AdminPolicy = adminPolicySchema.parse({
  totp: {
    digits: 6,
    periodSeconds: 30,
    windowSteps: 1,
    secretBytes: 20,
    issuer: "Madhuyamini",
  },
  recovery: { codeCount: 10, codeLength: 10 },
  sessions: { reauthWindowMinutes: 10, enrolmentMinutes: 15 },
  pii: {
    revealMinutes: 10,
    grantMaxHours: 24,
    grantDefaultHours: 2,
    fields: ["email", "phone", "address"],
  },
  uploads: {
    folder: "madhuyamini/products",
    formats: ["jpg", "png", "webp", "avif"],
    maxBytes: 8 * 1024 * 1024,
    minDimension: 800,
    maxDimension: 6000,
    orphanGraceHours: 24,
  },
  review: { allowUnderpaymentAccept: false },
  lists: { pageSize: 25, maxPageSize: 100 },
  limits: {
    totpPerUser: { windowSeconds: 15 * 60, max: 5 },
    totpPerIp: { windowSeconds: 15 * 60, max: 20 },
    recoveryPerUser: { windowSeconds: 60 * 60, max: 3 },
    enrolmentPerUser: { windowSeconds: 60 * 60, max: 3 },
    roleChangePerActor: { windowSeconds: 60 * 60, max: 10 },
    refundPerActor: { windowSeconds: 60 * 60, max: 20 },
    grantPerActor: { windowSeconds: 60 * 60, max: 20 },
    revealPerActor: { windowSeconds: 15 * 60, max: 30 },
  },
} satisfies AdminPolicy);

export function getAdminPolicy(): AdminPolicy {
  return adminPolicy;
}

/** The only place hours become milliseconds for the admin modules. */
export const hoursToMs = (hours: number): number => hours * 60 * 60 * 1000;
