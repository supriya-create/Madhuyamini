import "server-only";

import { env } from "@/server/env";

import { createFakeGateway } from "./fake";
import type { FakePaymentGateway } from "./fake";
import { PaymentGatewayError } from "./gateway";
import type { PaymentGateway } from "./gateway";
import { createRazorpayGateway } from "./razorpay";

declare global {
  // One fake gateway per process so its in-memory state survives dev-server
  // hot reloads and is shared between requests (the pay page's simulate panel,
  // the webhook route and the jobs all see the same orders).
  var madhuyaminiFakeGateway: FakePaymentGateway | undefined;
}

let razorpay: PaymentGateway | undefined;

/**
 * The configured gateway. Throws a `PaymentGatewayError` with code
 * `PAYMENT_NOT_CONFIGURED` when Razorpay is selected without credentials, so
 * a preview deployment builds and only the payment step reports the gap.
 */
export function getPaymentGateway(): PaymentGateway {
  if (env.payments.gateway === "fake") return getFakeGateway();
  if (!env.payments.razorpay) {
    throw new PaymentGatewayError(
      "Online payment is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).",
      { code: "PAYMENT_NOT_CONFIGURED", retryable: false },
    );
  }
  razorpay ??= createRazorpayGateway(env.payments.razorpay);
  return razorpay;
}

/** The fake gateway with its test controls; only meaningful when PAYMENT_GATEWAY=fake. */
export function getFakeGateway(): FakePaymentGateway {
  globalThis.madhuyaminiFakeGateway ??= createFakeGateway();
  return globalThis.madhuyaminiFakeGateway;
}

export function isFakeGateway(): boolean {
  return env.payments.gateway === "fake";
}
