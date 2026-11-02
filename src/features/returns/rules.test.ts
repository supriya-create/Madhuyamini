import { describe, expect, it } from "vitest";

import { getReturnsPolicy } from "@/config/returns-policy";

import {
  evaluateReturnRequest,
  lineEligibility,
  reasonsForLine,
  returnWindow,
} from "./rules";
import type { EligibilityLine, EligibilityOrder, RequestedLine } from "./rules";

const policy = getReturnsPolicy();
const delivered = new Date("2026-11-01T10:00:00Z");
const day = 24 * 60 * 60 * 1000;

const line = (overrides: Partial<EligibilityLine> = {}): EligibilityLine => ({
  orderItemId: "00000000-0000-7000-8000-000000000001",
  variantId: "00000000-0000-7000-8000-0000000000a1",
  quantity: 2,
  categorySlug: "clothing",
  isOneOfAKind: false,
  productKind: "CATALOGUE",
  usedQty: 0,
  ...overrides,
});

const order = (
  overrides: Partial<EligibilityOrder> = {},
): EligibilityOrder => ({
  status: "DELIVERED",
  deliveredAt: delivered,
  hasOpenRequest: false,
  lines: [line()],
  ...overrides,
});

const requested = (overrides: Partial<RequestedLine> = {}): RequestedLine => ({
  orderItemId: "00000000-0000-7000-8000-000000000001",
  quantity: 1,
  reason: "SIZE_OR_FIT",
  resolution: "REFUND",
  exchangeVariantId: null,
  ...overrides,
});

const facts = { evidenceCount: 0, exchangeVariantOk: () => true };

describe("returnWindow", () => {
  it("closes windowDays after delivery and damage reports after damageReportHours", () => {
    const window = returnWindow(delivered, policy);
    expect(window.closesAt).toEqual(
      new Date(delivered.getTime() + policy.windowDays * day),
    );
    expect(window.damageClosesAt).toEqual(
      new Date(delivered.getTime() + policy.damageReportHours * 60 * 60 * 1000),
    );
  });
});

describe("lineEligibility", () => {
  it("needs a delivered order", () => {
    expect(
      lineEligibility(
        line(),
        order({ status: "SHIPPED", deliveredAt: null }),
        policy,
        delivered,
      ),
    ).toMatchObject({ ineligible: "ORDER_NOT_DELIVERED", availableQty: 0 });
  });

  it("is eligible inside the window and closed exactly after it", () => {
    const lastMoment = new Date(delivered.getTime() + policy.windowDays * day);
    expect(
      lineEligibility(line(), order(), policy, lastMoment).ineligible,
    ).toBeNull();
    expect(
      lineEligibility(
        line(),
        order(),
        policy,
        new Date(lastMoment.getTime() + 1),
      ).ineligible,
    ).toBe("WINDOW_CLOSED");
  });

  it("drops damage on arrival once the damage report window has passed", () => {
    const later = new Date(
      delivered.getTime() + policy.damageReportHours * 60 * 60 * 1000 + 1,
    );
    const reasons = reasonsForLine(
      line(),
      returnWindow(delivered, policy),
      policy,
      later,
    );
    expect(reasons).not.toContain("DAMAGED_ON_ARRIVAL");
    expect(reasons).toContain("SIZE_OR_FIT");
  });

  it("restricts one-of-a-kind originals to fault reasons (D8.2)", () => {
    const result = lineEligibility(
      line({ isOneOfAKind: true }),
      order(),
      policy,
      delivered,
    );
    expect(result.ineligible).toBeNull();
    expect([...result.reasons].sort()).toEqual(
      [...policy.oneOfAKindReasons].sort(),
    );
  });

  it("restricts a non-returnable category to fault reasons", () => {
    const strict = { ...policy, nonReturnableCategorySlugs: ["clothing"] };
    const result = lineEligibility(line(), order(), strict, delivered);
    expect(
      result.reasons.every((reason) => strict.faultReasons.includes(reason)),
    ).toBe(true);
    expect(result.reasons).not.toContain("CHANGED_MIND");
  });

  it("never offers commission products", () => {
    expect(
      lineEligibility(
        line({ productKind: "COMMISSION" }),
        order(),
        policy,
        delivered,
      ).ineligible,
    ).toBe("COMMISSION_PRODUCT");
  });

  it("subtracts units already in other returns and flags an open request", () => {
    expect(
      lineEligibility(line({ usedQty: 2 }), order(), policy, delivered),
    ).toMatchObject({
      availableQty: 0,
      ineligible: "QUANTITY_EXCEEDED",
    });
    expect(
      lineEligibility(
        line({ usedQty: 1 }),
        order({ hasOpenRequest: true }),
        policy,
        delivered,
      ),
    ).toMatchObject({ availableQty: 1, ineligible: "REQUEST_ALREADY_OPEN" });
  });
});

describe("evaluateReturnRequest", () => {
  it("accepts a partial quantity for an allowed reason", () => {
    expect(
      evaluateReturnRequest(order(), [requested()], policy, delivered, facts),
    ).toEqual([]);
  });

  it("refuses quantities above what is available, unknown lines and disallowed reasons", () => {
    expect(
      evaluateReturnRequest(
        order(),
        [requested({ quantity: 3 })],
        policy,
        delivered,
        facts,
      ),
    ).toEqual([
      { orderItemId: requested().orderItemId, reason: "QUANTITY_EXCEEDED" },
    ]);
    expect(
      evaluateReturnRequest(
        order(),
        [requested({ orderItemId: "00000000-0000-7000-8000-0000000000ff" })],
        policy,
        delivered,
        facts,
      ),
    ).toEqual([
      {
        orderItemId: "00000000-0000-7000-8000-0000000000ff",
        reason: "QUANTITY_EXCEEDED",
      },
    ]);
    expect(
      evaluateReturnRequest(
        order({ lines: [line({ isOneOfAKind: true })] }),
        [requested({ reason: "CHANGED_MIND" })],
        policy,
        delivered,
        facts,
      ),
    ).toEqual([
      { orderItemId: requested().orderItemId, reason: "REASON_NOT_ALLOWED" },
    ]);
  });

  it("names the damage window when damage is reported too late", () => {
    const later = new Date(
      delivered.getTime() + policy.damageReportHours * 60 * 60 * 1000 + 1,
    );
    expect(
      evaluateReturnRequest(
        order(),
        [requested({ reason: "DAMAGED_ON_ARRIVAL" })],
        policy,
        later,
        { ...facts, evidenceCount: 1 },
      ),
    ).toEqual([
      { orderItemId: requested().orderItemId, reason: "DAMAGE_WINDOW_CLOSED" },
    ]);
  });

  it("requires evidence for the reasons the policy names", () => {
    expect(
      evaluateReturnRequest(
        order(),
        [requested({ reason: "DAMAGED_ON_ARRIVAL" })],
        policy,
        delivered,
        facts,
      ),
    ).toEqual([{ orderItemId: null, reason: "EVIDENCE_REQUIRED" }]);
    expect(
      evaluateReturnRequest(
        order(),
        [requested({ reason: "DAMAGED_ON_ARRIVAL" })],
        policy,
        delivered,
        { ...facts, evidenceCount: 1 },
      ),
    ).toEqual([]);
  });

  it("refuses a second request while one is open, and an unavailable exchange", () => {
    expect(
      evaluateReturnRequest(
        order({ hasOpenRequest: true }),
        [requested()],
        policy,
        delivered,
        facts,
      ),
    ).toEqual([{ orderItemId: null, reason: "REQUEST_ALREADY_OPEN" }]);
    expect(
      evaluateReturnRequest(
        order(),
        [requested({ resolution: "EXCHANGE", exchangeVariantId: "x" })],
        policy,
        delivered,
        { ...facts, exchangeVariantOk: () => false },
      ),
    ).toEqual([
      {
        orderItemId: requested().orderItemId,
        reason: "EXCHANGE_NOT_AVAILABLE",
      },
    ]);
  });
});
