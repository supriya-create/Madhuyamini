import { createHash, randomBytes } from "node:crypto";

/**
 * Guest order access tokens (docs/checkout.md §10.1): 256 bits from the
 * CSPRNG, carried only in an HttpOnly cookie; the database stores the SHA-256
 * digest. Same construction as the guest cart token.
 */

export const ORDER_ACCESS_COOKIE = "my_order";

export function generateOrderAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOrderAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Shape check before hashing: 43 base64url characters for 32 bytes. */
export function isPlausibleOrderAccessToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
