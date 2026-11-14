import type { ServerEnv } from "@/server/env-schema";

import { razorpayKeyMode } from "@/server/env-schema";

/**
 * Production payment readiness (docs/environments.md). The environment
 * schema lets a build succeed without Razorpay credentials, so previews and
 * builds never need secrets; a production *server*, however, must not start
 * without a complete, live, verifiable Razorpay configuration, because the
 * alternative is silently refusing every payment or every webhook. Called
 * once at startup from `src/instrumentation.ts`. Pure, so it is unit-tested;
 * messages name variables, never values.
 */

export type PaymentReadinessInput = Pick<ServerEnv, "siteEnv" | "payments">;

export function checkPaymentReadiness(env: PaymentReadinessInput): string[] {
  if (env.siteEnv !== "production") return [];
  const problems: string[] = [];
  if (env.payments.gateway !== "razorpay") {
    problems.push("PAYMENT_GATEWAY must be razorpay in production");
  }
  const razorpay = env.payments.razorpay;
  if (!razorpay) {
    problems.push(
      "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required in production",
    );
    return problems;
  }
  if (razorpayKeyMode(razorpay.keyId) !== "live") {
    problems.push(
      "RAZORPAY_KEY_ID must be a live key (rzp_live_…) in production",
    );
  }
  if (razorpay.webhookSecrets.length === 0) {
    problems.push(
      "RAZORPAY_WEBHOOK_SECRET is required in production (every webhook would be rejected without it)",
    );
  }
  return problems;
}

/** Throws with the list of problems; the server must not start. */
export function assertPaymentReadiness(env: PaymentReadinessInput): void {
  const problems = checkPaymentReadiness(env);
  if (problems.length === 0) return;
  throw new Error(
    `Payment configuration is not ready for production:\n- ${problems.join("\n- ")}`,
  );
}
