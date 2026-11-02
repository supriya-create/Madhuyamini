import {
  generateReference,
  referencePattern,
} from "@/features/orders/order-number";

/** Customer-facing return references: `RT-` plus eight characters of the order-number alphabet. */
const PREFIX = "RT-";
const PATTERN = referencePattern(PREFIX);

export function generateReturnNumber(): string {
  return generateReference(PREFIX);
}

/** Upper-cases and trims what a customer typed; null when it cannot be a return number. */
export function normalizeReturnNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^RT(?!-)/, "RT-");
  return PATTERN.test(candidate) ? candidate : null;
}
