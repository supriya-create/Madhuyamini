import { maskEmail, maskPhone } from "../redact";

/**
 * Masks personal data inside free-form JSON (webhook payloads, outbox
 * payloads) for STAFF viewers (docs/admin.md §5.6, §7). Keys are matched
 * by name; values under them are shortened to a recognisable stub. ADMIN
 * sees the stored payload.
 */

const SENSITIVE_KEY =
  /(^|[_.-])(email|contact|phone|mobile|vpa|card|name|address|line1|line2|landmark|token|secret|signature|password|recipient)([_.-]|$)/i;

const MAX_DEPTH = 8;

function maskString(key: string, value: string): string {
  if (value.length === 0) return value;
  if (value.includes("@") && /email|recipient|vpa/i.test(key))
    return maskEmail(value);
  if (/phone|contact|mobile/i.test(key)) return maskPhone(value);
  if (value.length <= 4) return "*".repeat(value.length);
  return `${"*".repeat(Math.max(value.length - 4, 2))}${value.slice(-4)}`;
}

export function maskPayload(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[…]";
  if (Array.isArray(value))
    return value.map((item) => maskPayload(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] =
          typeof inner === "string"
            ? maskString(key, inner)
            : inner && typeof inner === "object"
              ? maskPayload(inner, depth + 1)
              : inner === null || inner === undefined
                ? inner
                : "***";
      } else {
        out[key] = maskPayload(inner, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function maskForRole(value: unknown, role: "STAFF" | "ADMIN"): unknown {
  return role === "ADMIN" ? value : maskPayload(value);
}
