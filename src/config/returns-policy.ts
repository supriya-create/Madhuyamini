import { z } from "zod";

/**
 * Every knob of customer returns (docs/phase-8-returns-custom-artwork.md
 * §3.1, decision register D8.1–D8.9 as approved on 2 November 2026).
 * Nothing else declares a window, a limit or a size; the literal scan in
 * checkout-policy.test.ts covers the returns modules too. Each request
 * snapshots the values it was evaluated against.
 *
 * Values marked "engineering default" were not named by a business decision
 * and may be changed by the owner without a design change.
 */

const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();
const rateLimitRule = z
  .object({ windowSeconds: positiveInt, max: positiveInt })
  .strict();

export const returnReasonValues = [
  "DAMAGED_ON_ARRIVAL",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "SIZE_OR_FIT",
  "CHANGED_MIND",
  "QUALITY",
  "OTHER",
] as const;

const returnReason = z.enum(returnReasonValues);

export const returnsPolicySchema = z
  .object({
    /** D8.1: days after delivery during which a return may be requested. */
    windowDays: positiveInt,
    /** D8.1: hours after delivery during which damage on arrival may be reported. */
    damageReportHours: positiveInt,
    /** D8.2: category slugs whose products are not returnable (none approved). */
    nonReturnableCategorySlugs: z.array(z.string().min(1)),
    /** D8.2: a one-of-a-kind original is returnable only for these reasons. */
    oneOfAKindReasons: z.array(returnReason).nonempty(),
    /** Reasons that override the category rule (damage, wrong item). */
    faultReasons: z.array(returnReason).nonempty(),
    evidence: z
      .object({
        /** Reasons that need at least one photograph at submission. */
        requiredForReasons: z.array(returnReason),
        maxPerRequest: positiveInt,
        formats: z.array(z.string().min(1)).nonempty(),
        maxBytes: positiveInt,
        minDimension: positiveInt,
        maxDimension: positiveInt,
      })
      .strict(),
    clocks: z
      .object({
        /** Engineering default: staff decision target after a request. */
        staffDecisionDays: positiveInt,
        /** Engineering default: days the customer has to ship after approval. */
        customerShipByDays: positiveInt,
        /** Engineering default: days after shipping before a parcel is overdue. */
        receiveByDays: positiveInt,
      })
      .strict(),
    maxOpenRequestsPerOrder: positiveInt,
    exchanges: z
      .object({
        /** D8.4: exchanges offered as a resolution preference. */
        enabled: z.boolean(),
        /** D8.4: only variants of the same product. */
        sameProductOnly: z.boolean(),
      })
      .strict(),
    files: z
      .object({
        folder: z.string().regex(/^[a-z0-9/_-]+$/),
        deliveryType: z.literal("authenticated"),
        /** Issued-but-never-attached evidence is deleted after this. */
        orphanGraceHours: positiveInt,
        /** Engineering default: evidence kept this long after a request closes. */
        retentionDaysAfterClose: positiveInt,
        /** Widths the private file route may render; anything else is refused. */
        deliveryWidths: z.array(positiveInt).nonempty(),
      })
      .strict(),
    limits: z
      .object({
        requestPerUser: rateLimitRule,
        requestPerIp: rateLimitRule,
        uploadPerUser: rateLimitRule,
        messagePerRequest: rateLimitRule,
        withdrawPerUser: rateLimitRule,
        shipmentPerRequest: rateLimitRule,
      })
      .strict(),
    lists: z.object({ pageSize: positiveInt }).strict(),
    descriptionMaxLength: positiveInt,
    messageMaxLength: positiveInt,
    instructionsMaxLength: positiveInt,
    minQuantity: nonNegativeInt,
  })
  .strict();

export type ReturnsPolicy = z.infer<typeof returnsPolicySchema>;

export const returnsPolicy: ReturnsPolicy = returnsPolicySchema.parse({
  windowDays: 7,
  damageReportHours: 48,
  nonReturnableCategorySlugs: [],
  oneOfAKindReasons: ["DAMAGED_ON_ARRIVAL", "WRONG_ITEM"],
  faultReasons: ["DAMAGED_ON_ARRIVAL", "WRONG_ITEM", "NOT_AS_DESCRIBED"],
  evidence: {
    requiredForReasons: ["DAMAGED_ON_ARRIVAL", "WRONG_ITEM"],
    maxPerRequest: 12,
    formats: ["jpg", "png", "webp", "avif"],
    maxBytes: 8 * 1024 * 1024,
    minDimension: 320,
    maxDimension: 6000,
  },
  clocks: { staffDecisionDays: 3, customerShipByDays: 7, receiveByDays: 14 },
  maxOpenRequestsPerOrder: 1,
  exchanges: { enabled: true, sameProductOnly: true },
  files: {
    folder: "madhuyamini/returns",
    deliveryType: "authenticated",
    orphanGraceHours: 24,
    retentionDaysAfterClose: 180,
    deliveryWidths: [320, 640, 1280],
  },
  limits: {
    requestPerUser: { windowSeconds: 24 * 60 * 60, max: 5 },
    requestPerIp: { windowSeconds: 24 * 60 * 60, max: 20 },
    uploadPerUser: { windowSeconds: 24 * 60 * 60, max: 40 },
    messagePerRequest: { windowSeconds: 60 * 60, max: 10 },
    withdrawPerUser: { windowSeconds: 24 * 60 * 60, max: 5 },
    shipmentPerRequest: { windowSeconds: 60 * 60, max: 5 },
  },
  lists: { pageSize: 25 },
  descriptionMaxLength: 1000,
  messageMaxLength: 2000,
  instructionsMaxLength: 2000,
  minQuantity: 1,
} satisfies ReturnsPolicy);

export function getReturnsPolicy(): ReturnsPolicy {
  return returnsPolicy;
}

/** The only place days and hours become milliseconds for the returns modules. */
export const daysToMs = (days: number): number => days * 24 * 60 * 60 * 1000;
export const hoursToMs = (hours: number): number => hours * 60 * 60 * 1000;
