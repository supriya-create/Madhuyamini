import { describe, expect, it } from "vitest";

import { formatINR } from "./money";

describe("formatINR", () => {
  it.each([
    [0, "₹0"],
    [100, "₹1"],
    [149_900, "₹1,499"],
    [14_999_900, "₹1,49,999"],
    [1_000_000_000, "₹1,00,00,000"],
  ])("formats %i paise as whole rupees: %s", (paise, expected) => {
    expect(formatINR(paise)).toBe(expected);
  });

  it.each([
    [149_950, "₹1,499.50"],
    [5, "₹0.05"],
    [101, "₹1.01"],
  ])("shows paise only when present: %i → %s", (paise, expected) => {
    expect(formatINR(paise)).toBe(expected);
  });

  it.each([
    1.5,
    0.1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects non-integer or unsafe input: %s", (value) => {
    expect(() => formatINR(value)).toThrow(RangeError);
  });

  it("rejects negative amounts", () => {
    expect(() => formatINR(-100)).toThrow(RangeError);
  });
});
