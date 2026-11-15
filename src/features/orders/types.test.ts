import { describe, expect, it } from "vitest";

import type { OrderSummaryRow } from "./data";
import { toOrderSummaryView } from "./types";

function row(items: OrderSummaryRow["items"]): OrderSummaryRow {
  return {
    id: "01a1daf7-ca9c-737b-ac7e-b2054dd50aa4",
    orderNumber: "MY-4TAKEJJE",
    status: "CONFIRMED",
    paymentMethod: "COD",
    totalInPaise: 209_700,
    createdAt: new Date("2026-11-14T16:50:00Z"),
    pendingExpiresAt: null,
    items,
  };
}

describe("toOrderSummaryView", () => {
  it("counts units and lines separately", () => {
    const view = toOrderSummaryView(
      row([
        {
          productTitle: "Sun and moon cushion cover",
          quantity: 2,
          imageUrl: null,
          imageAlt: null,
        },
      ]),
    );
    expect(view.itemCount).toBe(2);
    expect(view.lineCount).toBe(1);
    expect(view.firstItem?.title).toBe("Sun and moon cushion cover");
  });

  it("reports more lines when there are more products", () => {
    const view = toOrderSummaryView(
      row([
        {
          productTitle: "Fish tote bag",
          quantity: 1,
          imageUrl: null,
          imageAlt: null,
        },
        {
          productTitle: "Lotus dupatta",
          quantity: 1,
          imageUrl: null,
          imageAlt: null,
        },
      ]),
    );
    expect(view.itemCount).toBe(2);
    expect(view.lineCount).toBe(2);
  });
});
