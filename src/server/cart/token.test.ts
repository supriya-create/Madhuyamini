import { describe, expect, it } from "vitest";

import {
  generateCartToken,
  hashCartToken,
  isPlausibleCartToken,
} from "./token";

describe("guest cart tokens", () => {
  it("generates 32 random bytes as base64url and hashes them deterministically", () => {
    const token = generateCartToken();
    expect(isPlausibleCartToken(token)).toBe(true);
    expect(generateCartToken()).not.toBe(token);
    expect(hashCartToken(token)).toBe(hashCartToken(token));
    expect(hashCartToken(token)).not.toBe(token);
    expect(hashCartToken(token)).not.toContain(token.slice(0, 12));
  });

  it("rejects malformed cookie values before any lookup", () => {
    expect(isPlausibleCartToken("")).toBe(false);
    expect(isPlausibleCartToken("short")).toBe(false);
    expect(isPlausibleCartToken("x".repeat(43) + "!")).toBe(false);
    expect(isPlausibleCartToken(42)).toBe(false);
  });
});
