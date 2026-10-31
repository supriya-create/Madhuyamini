import { describe, expect, it } from "vitest";

import {
  SESSION_ABSOLUTE_LIFETIME_SECONDS,
  isWithinAbsoluteLifetime,
} from "./session-lifetime";

describe("isWithinAbsoluteLifetime", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;

  it("accepts sessions up to 30 days old and rejects older ones", () => {
    expect(isWithinAbsoluteLifetime(new Date(now - 29 * day), now)).toBe(true);
    expect(isWithinAbsoluteLifetime(new Date(now - 30 * day), now)).toBe(true);
    expect(isWithinAbsoluteLifetime(new Date(now - 30 * day - 1), now)).toBe(
      false,
    );
    expect(SESSION_ABSOLUTE_LIFETIME_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  it("rejects unparseable creation times rather than treating them as fresh", () => {
    expect(isWithinAbsoluteLifetime("not a date", now)).toBe(false);
  });
});
