import { describe, expect, it } from "vitest";

import { maskForRole, maskPayload } from "./mask";

describe("maskPayload", () => {
  const payload = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_123",
          amount: 129_900,
          email: "asha.devi@example.com",
          contact: "+919876543210",
          vpa: "asha@upi",
          card: { last4: "4242", network: "Visa" },
          notes: { orderId: "o1", customer_name: "Asha Devi" },
          acquirer_data: { rrn: "123456789012" },
        },
      },
    },
  };

  it("masks contact details by key name and keeps everything else", () => {
    const masked = maskPayload(payload) as typeof payload;
    const entity = masked.payload.payment.entity;
    expect(entity.id).toBe("pay_123");
    expect(entity.amount).toBe(129_900);
    expect(entity.email).toBe("a********@example.com");
    expect(entity.contact).toMatch(/^\*+3210$/);
    expect(entity.vpa).toBe("a***@upi");
    expect(entity.card).toEqual({ last4: "4242", network: "Visa" });
    expect(entity.notes.customer_name).toBe("*****Devi");
    expect(entity.notes.orderId).toBe("o1");
    expect(entity.acquirer_data.rrn).toBe("123456789012");
    expect(masked.event).toBe("payment.captured");
    // The input is not mutated.
    expect(payload.payload.payment.entity.email).toBe("asha.devi@example.com");
  });

  it("handles arrays, nulls, scalars and runaway depth", () => {
    expect(maskPayload([{ email: "x@y.z" }, 1, null])).toEqual([
      { email: "x**@y.z" },
      1,
      null,
    ]);
    expect(maskPayload({ token: null, phone: 42 })).toEqual({
      token: null,
      phone: "***",
    });
    let deep: Record<string, unknown> = { leaf: "ok" };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    expect(JSON.stringify(maskPayload(deep))).toContain("[…]");
  });

  it("leaves the payload alone for ADMIN", () => {
    expect(maskForRole(payload, "ADMIN")).toBe(payload);
    expect(maskForRole(payload, "STAFF")).not.toEqual(payload);
  });
});
