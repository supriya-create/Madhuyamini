import { describe, expect, it } from "vitest";

import { generateOrderNumber, normalizeOrderNumber } from "./order-number";

describe("order numbers", () => {
  it("are MY- plus eight unambiguous characters, and vary", () => {
    const numbers = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const number = generateOrderNumber();
      expect(number).toMatch(/^MY-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
      numbers.add(number);
    }
    expect(numbers.size).toBe(500);
  });

  it("normalises what customers type and rejects anything else", () => {
    expect(normalizeOrderNumber(" my-7k3q9zhd ")).toBe("MY-7K3Q9ZHD");
    expect(normalizeOrderNumber("MY7K3Q9ZHD")).toBe("MY-7K3Q9ZHD");
    expect(normalizeOrderNumber("MY-7K3Q 9ZHD")).toBe("MY-7K3Q9ZHD");
    expect(normalizeOrderNumber("MY-7K3Q9ZH0")).toBeNull(); // 0 is not in the alphabet
    expect(normalizeOrderNumber("MY-7K3Q9ZHDX")).toBeNull();
    expect(normalizeOrderNumber("XX-7K3Q9ZHD")).toBeNull();
    expect(normalizeOrderNumber(42)).toBeNull();
    expect(normalizeOrderNumber(null)).toBeNull();
  });
});
