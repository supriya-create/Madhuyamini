import { z } from "zod";

/**
 * Every business and operational knob for checkout, payments and the jobs
 * around them, in one validated object (docs/checkout.md §4.1). Nothing else
 * declares an amount or a duration. Orders snapshot the values they apply,
 * so changing this file never alters an existing order.
 *
 * Values approved by the owner on 1 Nov 2026 (decisions D6, D7a–c, P6–P12).
 */

const paise = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();

const rateLimitRule = z
  .object({ windowSeconds: positiveInt, max: positiveInt })
  .strict();

export const checkoutPolicySchema = z
  .object({
    shipping: z
      .object({
        /** Charge per order below the free-shipping subtotal. */
        flatInPaise: paise,
        /** Subtotal at or above which shipping is free; null means never. */
        freeAtSubtotalInPaise: positiveInt.nullable(),
        serviceableCountries: z.array(z.literal("IN")).nonempty(),
      })
      .strict(),
    cod: z
      .object({
        enabled: z.boolean(),
        feeInPaise: paise,
        /** Highest order total (before the COD fee) that may be paid on delivery. */
        maxOrderInPaise: positiveInt,
      })
      .strict(),
    payment: z
      .object({
        /** Razorpay refuses amounts below ₹1.00. */
        minOrderInPaise: positiveInt,
        currency: z.literal("INR"),
        /** How often the "confirming your payment" page asks again. */
        confirmingPollSeconds: positiveInt,
        /** Pending attempts older than this are reconciled with the provider. */
        reconcileAfterMinutes: positiveInt,
        /**
         * How long after cancellation an online order's uncaptured attempts
         * keep being checked with the provider (a capture nobody told us
         * about is refunded, never revived). Checks follow `jobs.backoffMinutes`.
         * Razorpay polls a bank for a late authorisation for 3 days, so the
         * window must reach at least that far.
         */
        reconcileCancelledWithinHours: positiveInt,
      })
      .strict(),
    reservation: z
      .object({
        /** D6: stock is held this long after an online order is placed. */
        ttlMinutes: positiveInt,
        /** Added once per new payment attempt, at most `maxExtensions` times. */
        extensionMinutes: paise,
        maxExtensions: paise,
      })
      .strict(),
    guestAccess: z
      .object({
        tokenTtlDays: positiveInt,
        /** Guests see the full address and contact details this long after placing; reduced after. */
        fullDetailMinutes: positiveInt,
      })
      .strict(),
    jobs: z
      .object({
        /** A claimed queue row is reclaimable after this long. */
        leaseMinutes: positiveInt,
        /** Wait before retry number n is `backoffMinutes[min(n, length) - 1]`. */
        backoffMinutes: z.array(positiveInt).nonempty(),
        /** Database CHECKs bound attempts at 10. */
        maxAttempts: z.number().int().min(1).max(10),
      })
      .strict(),
    rateLimits: z
      .object({
        placeOrder: rateLimitRule,
        placeOrderByIp: rateLimitRule,
        startAttempt: rateLimitRule,
        confirmPayment: rateLimitRule,
        trackOrderByIp: rateLimitRule,
        trackOrderByEmail: rateLimitRule,
      })
      .strict(),
  })
  .strict();

export type CheckoutPolicy = z.infer<typeof checkoutPolicySchema>;

export const checkoutPolicy: CheckoutPolicy = checkoutPolicySchema.parse({
  // D7a: ₹99 per order, free from ₹1,999.
  shipping: {
    flatInPaise: 9_900,
    freeAtSubtotalInPaise: 199_900,
    serviceableCountries: ["IN"],
  },
  // D7b: cash on delivery up to ₹5,000, no fee.
  cod: { enabled: true, feeInPaise: 0, maxOrderInPaise: 500_000 },
  payment: {
    minOrderInPaise: 100,
    currency: "INR",
    confirmingPollSeconds: 3,
    reconcileAfterMinutes: 2,
    // Approved 14 Nov 2026: Razorpay's late-authorisation horizon (3 days).
    reconcileCancelledWithinHours: 72,
  },
  // D6: 15 minutes, extended once by 15 minutes when a new attempt starts.
  reservation: { ttlMinutes: 15, extensionMinutes: 15, maxExtensions: 1 },
  guestAccess: { tokenTtlDays: 7, fullDetailMinutes: 60 },
  jobs: {
    leaseMinutes: 5,
    backoffMinutes: [1, 5, 15, 60, 180, 360, 720, 1440],
    maxAttempts: 8,
  },
  rateLimits: {
    placeOrder: { windowSeconds: 10 * 60, max: 5 },
    placeOrderByIp: { windowSeconds: 10 * 60, max: 20 },
    startAttempt: { windowSeconds: 15 * 60, max: 5 },
    confirmPayment: { windowSeconds: 10 * 60, max: 20 },
    trackOrderByIp: { windowSeconds: 15 * 60, max: 10 },
    trackOrderByEmail: { windowSeconds: 60 * 60, max: 5 },
  },
} satisfies CheckoutPolicy);

/**
 * The single accessor. Phase 7 can back it with a settings table without
 * touching callers; until then it returns the validated constants above.
 */
export function getCheckoutPolicy(): CheckoutPolicy {
  return checkoutPolicy;
}

/** Minutes to wait before the retry numbered `attempt` (1-based). */
export function backoffMinutesFor(
  policy: CheckoutPolicy["jobs"],
  attempt: number,
): number {
  const index = Math.min(Math.max(attempt, 1), policy.backoffMinutes.length);
  const minutes = policy.backoffMinutes[index - 1];
  // The schema guarantees a non-empty schedule; this only satisfies the type.
  if (minutes === undefined) throw new Error("Backoff schedule is empty");
  return minutes;
}

/** The only place minutes and days become milliseconds (keeps literals out of the jobs). */
export const minutesToMs = (minutes: number): number => minutes * 60 * 1000;
export const daysToMs = (days: number): number => days * 24 * 60 * 60 * 1000;
export const hoursToMs = (hours: number): number => hours * 60 * 60 * 1000;
