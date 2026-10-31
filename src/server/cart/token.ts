import { createHash, randomBytes } from "node:crypto";

/**
 * Guest cart tokens: 256 bits from the CSPRNG, carried only in an HttpOnly
 * cookie; the database stores the SHA-256 digest (requirement 2).
 */

export const GUEST_CART_COOKIE = "my_cart";

export function generateCartToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashCartToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Shape check before hashing: 43 base64url characters for 32 bytes. */
export function isPlausibleCartToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
