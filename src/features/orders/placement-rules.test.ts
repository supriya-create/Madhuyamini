import { describe, expect, it } from "vitest";

import {
  PlacementInputError,
  assertPlacementInput,
  initialOrderStatus,
  orderTaxInPaise,
} from "./placement-rules";
import type { PlacementLine, PlacementRules } from "./placement-rules";

const line = (overrides: Partial<PlacementLine> = {}): PlacementLine => ({
  variantId: "00000000-0000-7000-8000-000000000001",
  productSlug: "sample-tote",
  productTitle: "Sample tote",
  variantTitle: null,
  sku: "TOTE-1",
  quantity: 2,
  unitPriceInPaise: 129_900,
  taxRateBp: null,
  hsnCode: null,
  imageUrl: null,
  imageAlt: null,
  ...overrides,
});

const noLinks = {
  exchangeOfOrderId: null,
  commissionRequestId: null,
  instalment: null,
};

const standard = (overrides: Partial<PlacementRules> = {}): PlacementRules => ({
  kind: "STANDARD",
  paymentMethod: "RAZORPAY",
  lines: [line()],
  amounts: {
    subtotalInPaise: 259_800,
    shippingInPaise: 0,
    codFeeInPaise: 0,
    discountInPaise: 0,
    totalInPaise: 259_800,
  },
  links: noLinks,
  stock: "manage",
  ...overrides,
});

const refuses = (input: PlacementRules, message: RegExp) =>
  expect(() => assertPlacementInput(input)).toThrow(
    expect.objectContaining({ message: expect.stringMatching(message) }),
  );

describe("assertPlacementInput", () => {
  it("accepts a consistent standard order", () => {
    expect(() => assertPlacementInput(standard())).not.toThrow();
  });

  it("refuses empty, fractional or free-floating lines", () => {
    refuses(standard({ lines: [] }), /at least one line/);
    refuses(standard({ lines: [line({ quantity: 0 })] }), /Quantity/);
    refuses(standard({ lines: [line({ quantity: 1.5 })] }), /Quantity/);
    refuses(
      standard({ lines: [line({ unitPriceInPaise: 10.5 })] }),
      /whole paise/,
    );
    refuses(standard({ lines: [line({ sku: "" })] }), /variant and a SKU/);
  });

  it("refuses amounts that do not match the lines or do not add up", () => {
    refuses(
      standard({
        amounts: { ...standard().amounts, subtotalInPaise: 259_801 },
      }),
      /subtotal does not match/,
    );
    refuses(
      standard({
        amounts: { ...standard().amounts, totalInPaise: 259_801 },
      }),
      /total does not add up/,
    );
    refuses(
      standard({
        amounts: { ...standard().amounts, shippingInPaise: -1 },
      }),
      /non-negative/,
    );
  });

  it("allows a COD fee only for cash on delivery", () => {
    const withFee = {
      ...standard().amounts,
      codFeeInPaise: 5_000,
      totalInPaise: 264_800,
    };
    refuses(standard({ amounts: withFee }), /COD fee/);
    expect(() =>
      assertPlacementInput(
        standard({ paymentMethod: "COD", amounts: withFee }),
      ),
    ).not.toThrow();
  });

  it("lets store credit settle only a zero total", () => {
    refuses(standard({ paymentMethod: "STORE_CREDIT" }), /zero total/);
    expect(() =>
      assertPlacementInput(
        standard({
          paymentMethod: "STORE_CREDIT",
          amounts: {
            ...standard().amounts,
            discountInPaise: 259_800,
            totalInPaise: 0,
          },
        }),
      ),
    ).not.toThrow();
  });

  it("ties parent links to the order kind", () => {
    const parent = "00000000-0000-7000-8000-0000000000aa";
    refuses(
      standard({ links: { ...noLinks, exchangeOfOrderId: parent } }),
      /standard order carries no parent links/,
    );
    refuses(
      standard({ kind: "EXCHANGE_REPLACEMENT" }),
      /replacement order links to exactly its original/,
    );
    refuses(
      standard({
        kind: "EXCHANGE_REPLACEMENT",
        links: {
          exchangeOfOrderId: parent,
          commissionRequestId: parent,
          instalment: null,
        },
      }),
      /replacement order links to exactly its original/,
    );
    expect(() =>
      assertPlacementInput(
        standard({
          kind: "EXCHANGE_REPLACEMENT",
          links: { ...noLinks, exchangeOfOrderId: parent },
        }),
      ),
    ).not.toThrow();
    refuses(
      standard({
        kind: "COMMISSION_INSTALMENT",
        links: { ...noLinks, commissionRequestId: parent },
      }),
      /instalment order links to its commission/,
    );
    expect(() =>
      assertPlacementInput(
        standard({
          kind: "COMMISSION_INSTALMENT",
          links: {
            ...noLinks,
            commissionRequestId: parent,
            instalment: "DEPOSIT",
          },
        }),
      ),
    ).not.toThrow();
  });

  it("allows stock-free lines only for commission instalments", () => {
    refuses(standard({ stock: "none" }), /Only commission instalments/);
    expect(() =>
      assertPlacementInput(
        standard({
          kind: "COMMISSION_INSTALMENT",
          stock: "none",
          links: {
            ...noLinks,
            commissionRequestId: "00000000-0000-7000-8000-0000000000bb",
            instalment: "BALANCE",
          },
        }),
      ),
    ).not.toThrow();
  });

  it("reports its refusals as a typed error", () => {
    expect(() => assertPlacementInput(standard({ lines: [] }))).toThrow(
      PlacementInputError,
    );
  });
});

describe("orderTaxInPaise", () => {
  it("is null unless every line carries a rate, else the included tax over line totals", () => {
    expect(orderTaxInPaise([line(), line({ taxRateBp: 500 })])).toBeNull();
    // 259_800 at 5 %: 259_800 × 500 / 10_500 = 12_371.4… → 12_371
    expect(orderTaxInPaise([line({ taxRateBp: 500 })])).toBe(12_371);
  });
});

describe("initialOrderStatus", () => {
  it("waits only for online payment", () => {
    expect(initialOrderStatus("RAZORPAY")).toBe("PENDING_PAYMENT");
    expect(initialOrderStatus("COD")).toBe("CONFIRMED");
    expect(initialOrderStatus("STORE_CREDIT")).toBe("CONFIRMED");
  });
});
