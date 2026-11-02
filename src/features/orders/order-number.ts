import { randomInt } from "node:crypto";

/**
 * Customer-facing order numbers (P7): `MY-` plus eight characters from an
 * alphabet without 0/O, 1/I/L, drawn from the CSPRNG. Not sequential, so
 * they reveal nothing about volume; unique in the database (a collision
 * simply retries). Invoice numbering, if ever needed, is a separate series.
 */

const PREFIX = "MY-";
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LENGTH = 8;

/** `prefix` plus eight characters of the alphabet; other series (returns) reuse it. */
export function generateReference(prefix: string): string {
  let body = "";
  for (let i = 0; i < LENGTH; i += 1) {
    body += ALPHABET[randomInt(ALPHABET.length)];
  }
  return prefix + body;
}

export function generateOrderNumber(): string {
  return generateReference(PREFIX);
}

/** The pattern a reference with `prefix` must match (upper case, no ambiguous letters). */
export function referencePattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}[${ALPHABET}]{${LENGTH}}$`);
}

const ORDER_NUMBER_PATTERN = new RegExp(`^${PREFIX}[${ALPHABET}]{${LENGTH}}$`);

/** Upper-cases and trims what a customer typed; returns null when it cannot be an order number. */
export function normalizeOrderNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^MY(?!-)/, "MY-");
  return ORDER_NUMBER_PATTERN.test(candidate) ? candidate : null;
}
