import { describe, expect, it } from "vitest";

import { maskEmail, maskPhone, redactForAudit } from "./redact";

/** Audit snapshots: allow-listed keys only, contact details masked, no secrets. */
describe("redactForAudit", () => {
  it("keeps only the allow-listed keys for a known target type", () => {
    const out = redactForAudit("order", {
      id: "o1",
      orderNumber: "MY-1",
      status: "CONFIRMED",
      totalInPaise: 129_900,
      shippingAddress: { line1: "12 Lane", city: "Patna" },
      customerNote: "Leave with the neighbour",
      email: "asha.devi@example.com",
    });
    expect(out).toEqual({
      id: "o1",
      orderNumber: "MY-1",
      status: "CONFIRMED",
      totalInPaise: 129_900,
      email: "a********@example.com",
    });
  });

  it("masks phones and emails wherever they appear", () => {
    expect(maskEmail("priya@example.com")).toBe("p****@example.com");
    expect(maskEmail("ab@x.in")).toBe("a**@x.in");
    expect(maskPhone("+91 98765 43210")).toBe("********3210");
    expect(redactForAudit("user", { id: "u1", phone: "9876543210" })).toEqual({
      id: "u1",
      phone: "******3210",
    });
  });

  it("drops everything for unknown target types and non-objects", () => {
    expect(redactForAudit("session", { token: "secret" })).toEqual({});
    expect(redactForAudit("order", "string")).toEqual({});
    expect(redactForAudit("order", ["a"])).toEqual({});
    expect(redactForAudit("order", null)).toBeUndefined();
    expect(redactForAudit("order", undefined)).toBeUndefined();
  });

  it("never copies secrets, hashes, tokens or nested objects", () => {
    const out = redactForAudit("two_factor", {
      userId: "u1",
      enabled: true,
      secretCiphertext: "AAAA",
      codeHash: "BBBB",
      token: "CCCC",
      nested: { password: "x" },
    });
    expect(out).toEqual({ userId: "u1", enabled: true });
    expect(JSON.stringify(out)).not.toMatch(/AAAA|BBBB|CCCC|password/);
  });

  it("serialises dates and bigints so the snapshot is plain JSON", () => {
    const out = redactForAudit("shipment", {
      id: "s1",
      shippedAt: new Date("2026-11-01T10:00:00Z"),
      trackingNumber: "TRK1",
    });
    expect(out).toEqual({
      id: "s1",
      shippedAt: "2026-11-01T10:00:00.000Z",
      trackingNumber: "TRK1",
    });
  });
});
