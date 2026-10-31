import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay signatures (docs/checkout.md §6), kept pure so they can be
 * unit-tested with known vectors. Both are HMAC-SHA256 hex digests:
 * - checkout callback: key secret over `${order_id}|${payment_id}`
 * - webhook: webhook secret over the raw request body
 */

export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/** Constant-time comparison of two hex digests; false on any shape mismatch. */
export function digestsMatch(expected: string, provided: unknown): boolean {
  if (typeof provided !== "string") return false;
  if (!/^[0-9a-f]+$/i.test(provided) || provided.length !== expected.length)
    return false;
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(provided.toLowerCase(), "hex"),
  );
}

export function checkoutSignatureMessage(
  providerOrderId: string,
  providerPaymentId: string,
): string {
  return `${providerOrderId}|${providerPaymentId}`;
}

export function verifyCheckoutSignature(input: {
  readonly keySecret: string;
  readonly providerOrderId: string;
  readonly providerPaymentId: string;
  readonly signature: unknown;
}): boolean {
  const expected = hmacSha256Hex(
    input.keySecret,
    checkoutSignatureMessage(input.providerOrderId, input.providerPaymentId),
  );
  return digestsMatch(expected, input.signature);
}

/** Accepts the current secret or, during rotation, the previous one. */
export function verifyWebhookSignature(input: {
  readonly secrets: readonly string[];
  readonly rawBody: string;
  readonly signature: unknown;
}): boolean {
  return input.secrets.some((secret) =>
    digestsMatch(hmacSha256Hex(secret, input.rawBody), input.signature),
  );
}
