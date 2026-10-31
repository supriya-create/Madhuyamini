import { describe, expect, it } from "vitest";

import {
  evaluateWindow,
  hashIdentifier,
  rateLimitKey,
} from "./rate-limit-rules";

const rule = { windowSeconds: 60, max: 3 };

describe("evaluateWindow", () => {
  it("allows up to max attempts within the window", () => {
    const start = 1_000_000;
    expect(
      evaluateWindow(rule, { count: 3, lastRequest: start }, start + 10_000),
    ).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(
      evaluateWindow(rule, { count: 4, lastRequest: start }, start + 10_000),
    ).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 50,
    });
  });

  it("starts a new window once the old one has lapsed", () => {
    const start = 1_000_000;
    const outcome = evaluateWindow(
      rule,
      { count: 99, lastRequest: start },
      start + 60_000,
    );
    expect(outcome).toEqual({
      allowed: true,
      remaining: 2,
      retryAfterSeconds: 0,
    });
  });
});

describe("keys", () => {
  it("never embeds the raw identifier and normalises case and whitespace", () => {
    const key = rateLimitKey("sign-in:email", "  Asha@Example.com ");
    expect(key).not.toContain("Asha");
    expect(key).not.toContain("example.com");
    expect(key).toBe(rateLimitKey("sign-in:email", "asha@example.com"));
    expect(hashIdentifier("a")).not.toBe(hashIdentifier("b"));
  });
});
