import type { Prisma } from "@/generated/prisma/client";

/**
 * Audit snapshots carry only what a reviewer needs (docs/admin.md §6):
 * an allow-list of keys per target type, with contact details masked and
 * secrets never copied. Unknown target types keep nothing.
 */

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  order: [
    "id",
    "orderNumber",
    "status",
    "paymentMethod",
    "totalInPaise",
    "cancellationReason",
    "pendingExpiresAt",
    "email",
  ],
  order_item: ["id", "sku", "quantity", "restockQty", "writeOffQty"],
  shipment: [
    "id",
    "carrier",
    "trackingNumber",
    "shippedAt",
    "deliveredAt",
    "deliveryFailureReason",
    "returnedAt",
    "inspectedAt",
    "carrierClaimReference",
  ],
  payment: [
    "id",
    "attemptNo",
    "method",
    "status",
    "amountInPaise",
    "providerOrderId",
    "providerPaymentId",
    "failureCode",
  ],
  refund: [
    "id",
    "status",
    "amountInPaise",
    "reason",
    "reference",
    "providerRefundId",
  ],
  inventory: [
    "variantId",
    "kind",
    "delta",
    "stockBefore",
    "stockAfter",
    "reservedAtTime",
    "lowStockThreshold",
  ],
  product: [
    "id",
    "slug",
    "title",
    "status",
    "categoryId",
    "isFeatured",
    "isOneOfAKind",
  ],
  variant: ["id", "sku", "priceInPaise", "compareAtPriceInPaise", "isActive"],
  category: ["id", "slug", "name", "parentId", "isActive", "position"],
  image: ["id", "publicId", "position", "variantId", "width", "height"],
  upload: ["id", "publicId", "status"],
  user: ["id", "role", "email", "phone", "emailVerified"],
  grant: ["id", "granteeId", "customerId", "fields", "expiresAt", "revokedAt"],
  reveal: ["id", "grantId", "customerId", "fields", "expiresAt"],
  outbox: ["id", "kind", "status", "attempts", "recipient"],
  webhook_event: ["id", "eventType", "status", "attempts"],
  job: ["name", "summary"],
  two_factor: ["userId", "enabled", "method", "recoveryCodesRemaining"],
};

const MASKED_KEYS = new Set(["email", "phone", "recipient"]);

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 2))}@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${"*".repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}

function maskValue(key: string, value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (key === "phone") return maskPhone(value);
  return value.includes("@") ? maskEmail(value) : maskPhone(value);
}

function scalar(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (Array.isArray(value)) return value.map((item) => scalar(item) ?? null);
  if (typeof value === "object") {
    const nested: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, inner] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (MASKED_KEYS.has(key)) {
        nested[key] = scalar(maskValue(key, inner));
      } else if (
        typeof inner !== "object" ||
        inner === null ||
        inner instanceof Date
      ) {
        nested[key] = scalar(inner);
      }
      // Nested objects are dropped: snapshots are shallow by design.
    }
    return nested;
  }
  return null;
}

/** Keeps only allow-listed keys of a snapshot for the given target type. */
export function redactForAudit(
  targetType: string,
  value: unknown,
): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  const allowed = ALLOWED[targetType];
  if (!allowed) return {};
  if (typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Prisma.InputJsonValue | null> = {};
  for (const key of allowed) {
    if (!(key in (value as Record<string, unknown>))) continue;
    const inner = (value as Record<string, unknown>)[key];
    out[key] = MASKED_KEYS.has(key)
      ? scalar(maskValue(key, inner))
      : scalar(inner);
  }
  return out;
}
