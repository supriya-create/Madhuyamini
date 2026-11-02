import type { ReturnsPolicy } from "@/config/returns-policy";
import { daysToMs, hoursToMs } from "@/config/returns-policy";
import type {
  OrderStatus,
  ProductKind,
  ReturnReason,
} from "@/generated/prisma/enums";

/**
 * Return eligibility (docs/phase-8-returns-custom-artwork.md §3.1): pure
 * over the order snapshot, the units already in other returns and the
 * policy. The service re-runs it under the order lock before writing.
 */

export type IneligibleReason =
  | "ORDER_NOT_DELIVERED"
  | "WINDOW_CLOSED"
  | "DAMAGE_WINDOW_CLOSED"
  | "CATEGORY_NOT_RETURNABLE"
  | "ONE_OF_A_KIND"
  | "COMMISSION_PRODUCT"
  | "QUANTITY_EXCEEDED"
  | "REQUEST_ALREADY_OPEN"
  | "REASON_NOT_ALLOWED"
  | "EVIDENCE_REQUIRED"
  | "EXCHANGE_NOT_AVAILABLE";

export interface EligibilityLine {
  readonly orderItemId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly categorySlug: string;
  readonly isOneOfAKind: boolean;
  readonly productKind: ProductKind;
  /** Units already accepted or in an open request for this line. */
  readonly usedQty: number;
}

export interface EligibilityOrder {
  readonly status: OrderStatus;
  readonly deliveredAt: Date | null;
  readonly hasOpenRequest: boolean;
  readonly lines: readonly EligibilityLine[];
}

export interface ReturnWindow {
  readonly closesAt: Date;
  readonly damageClosesAt: Date;
}

export function returnWindow(
  deliveredAt: Date,
  policy: ReturnsPolicy,
): ReturnWindow {
  return {
    closesAt: new Date(deliveredAt.getTime() + daysToMs(policy.windowDays)),
    damageClosesAt: new Date(
      deliveredAt.getTime() + hoursToMs(policy.damageReportHours),
    ),
  };
}

export interface LineEligibility {
  readonly orderItemId: string;
  readonly availableQty: number;
  /** Reasons the customer may choose for this line now. */
  readonly reasons: readonly ReturnReason[];
  /** Null when at least one unit may be returned for at least one reason. */
  readonly ineligible: IneligibleReason | null;
}

const ALL_REASONS: readonly ReturnReason[] = [
  "DAMAGED_ON_ARRIVAL",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "SIZE_OR_FIT",
  "CHANGED_MIND",
  "QUALITY",
  "OTHER",
];

/** Which reasons a line admits, ignoring quantity and the open-request rule. */
export function reasonsForLine(
  line: EligibilityLine,
  window: ReturnWindow,
  policy: ReturnsPolicy,
  now: Date,
): readonly ReturnReason[] {
  if (line.productKind !== "CATALOGUE") return [];
  if (now.getTime() > window.closesAt.getTime()) return [];
  const faultReasons = new Set<ReturnReason>(policy.faultReasons);
  let allowed = ALL_REASONS.filter((reason) =>
    reason === "DAMAGED_ON_ARRIVAL"
      ? now.getTime() <= window.damageClosesAt.getTime()
      : true,
  );
  if (policy.nonReturnableCategorySlugs.includes(line.categorySlug)) {
    allowed = allowed.filter((reason) => faultReasons.has(reason));
  }
  if (line.isOneOfAKind) {
    const oneOfAKind = new Set<ReturnReason>(policy.oneOfAKindReasons);
    allowed = allowed.filter((reason) => oneOfAKind.has(reason));
  }
  return allowed;
}

export function lineEligibility(
  line: EligibilityLine,
  order: EligibilityOrder,
  policy: ReturnsPolicy,
  now: Date,
): LineEligibility {
  const base = { orderItemId: line.orderItemId };
  if (order.status !== "DELIVERED" || !order.deliveredAt) {
    return {
      ...base,
      availableQty: 0,
      reasons: [],
      ineligible: "ORDER_NOT_DELIVERED",
    };
  }
  const window = returnWindow(order.deliveredAt, policy);
  const availableQty = Math.max(0, line.quantity - line.usedQty);
  if (line.productKind !== "CATALOGUE") {
    return {
      ...base,
      availableQty,
      reasons: [],
      ineligible: "COMMISSION_PRODUCT",
    };
  }
  if (now.getTime() > window.closesAt.getTime()) {
    return { ...base, availableQty, reasons: [], ineligible: "WINDOW_CLOSED" };
  }
  const reasons = reasonsForLine(line, window, policy, now);
  if (reasons.length === 0) {
    const ineligible: IneligibleReason = line.isOneOfAKind
      ? "ONE_OF_A_KIND"
      : "CATEGORY_NOT_RETURNABLE";
    return { ...base, availableQty, reasons, ineligible };
  }
  if (availableQty === 0) {
    return { ...base, availableQty, reasons, ineligible: "QUANTITY_EXCEEDED" };
  }
  if (order.hasOpenRequest) {
    return {
      ...base,
      availableQty,
      reasons,
      ineligible: "REQUEST_ALREADY_OPEN",
    };
  }
  return { ...base, availableQty, reasons, ineligible: null };
}

export interface RequestedLine {
  readonly orderItemId: string;
  readonly quantity: number;
  readonly reason: ReturnReason;
  readonly resolution: "REFUND" | "EXCHANGE";
  readonly exchangeVariantId: string | null;
}

export interface RequestProblem {
  readonly orderItemId: string | null;
  readonly reason: IneligibleReason;
}

/**
 * Validates a whole submission. Evidence is counted by the caller (verified
 * uploads owned by the customer); exchange availability (same product,
 * active, in stock) is checked by the caller against live data and passed
 * in as `exchangeVariantOk`.
 */
export function evaluateReturnRequest(
  order: EligibilityOrder,
  requested: readonly RequestedLine[],
  policy: ReturnsPolicy,
  now: Date,
  facts: {
    readonly evidenceCount: number;
    readonly exchangeVariantOk: (line: RequestedLine) => boolean;
  },
): readonly RequestProblem[] {
  const problems: RequestProblem[] = [];
  if (order.hasOpenRequest) {
    problems.push({ orderItemId: null, reason: "REQUEST_ALREADY_OPEN" });
  }
  const byId = new Map(order.lines.map((line) => [line.orderItemId, line]));
  const evidenceRequired = new Set<ReturnReason>(
    policy.evidence.requiredForReasons,
  );
  let needsEvidence = false;
  for (const line of requested) {
    const known = byId.get(line.orderItemId);
    if (!known) {
      problems.push({
        orderItemId: line.orderItemId,
        reason: "QUANTITY_EXCEEDED",
      });
      continue;
    }
    const eligibility = lineEligibility(known, order, policy, now);
    if (
      eligibility.ineligible &&
      eligibility.ineligible !== "REQUEST_ALREADY_OPEN"
    ) {
      problems.push({
        orderItemId: line.orderItemId,
        reason: eligibility.ineligible,
      });
      continue;
    }
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < policy.minQuantity ||
      line.quantity > eligibility.availableQty
    ) {
      problems.push({
        orderItemId: line.orderItemId,
        reason: "QUANTITY_EXCEEDED",
      });
    }
    if (!eligibility.reasons.includes(line.reason)) {
      problems.push({
        orderItemId: line.orderItemId,
        reason:
          line.reason === "DAMAGED_ON_ARRIVAL" &&
          order.deliveredAt &&
          now.getTime() >
            returnWindow(order.deliveredAt, policy).damageClosesAt.getTime()
            ? "DAMAGE_WINDOW_CLOSED"
            : "REASON_NOT_ALLOWED",
      });
    }
    if (evidenceRequired.has(line.reason)) needsEvidence = true;
    if (line.resolution === "EXCHANGE") {
      if (!policy.exchanges.enabled || !facts.exchangeVariantOk(line)) {
        problems.push({
          orderItemId: line.orderItemId,
          reason: "EXCHANGE_NOT_AVAILABLE",
        });
      }
    }
  }
  if (needsEvidence && facts.evidenceCount === 0) {
    problems.push({ orderItemId: null, reason: "EVIDENCE_REQUIRED" });
  }
  return problems;
}

/** Plain-words copy for a refusal, shared by the form and the e-mails. */
export const ineligibleMessages: Readonly<Record<IneligibleReason, string>> = {
  ORDER_NOT_DELIVERED:
    "Items can be returned once the order has been delivered.",
  WINDOW_CLOSED: "The return window for this order has closed.",
  DAMAGE_WINDOW_CLOSED:
    "Damage on arrival has to be reported within the first days after delivery; choose another reason or contact us.",
  CATEGORY_NOT_RETURNABLE:
    "This kind of piece cannot be returned unless it arrived damaged or was not what you ordered.",
  ONE_OF_A_KIND:
    "An original piece can be returned only if it arrived damaged or was not what you ordered.",
  COMMISSION_PRODUCT: "Commissioned pieces follow their own terms.",
  QUANTITY_EXCEEDED:
    "That is more units than can still be returned on this line.",
  REQUEST_ALREADY_OPEN:
    "A return request for this order is already open; wait for it to close before starting another.",
  REASON_NOT_ALLOWED: "That reason is not available for this piece.",
  EVIDENCE_REQUIRED:
    "Add at least one photograph of the damage or the wrong item before sending the request.",
  EXCHANGE_NOT_AVAILABLE:
    "That replacement is not available right now; choose a refund or another size.",
};
