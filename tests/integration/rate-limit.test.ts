import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { cleanupRateLimits, consumeRateLimit } from "@/server/auth/rate-limit";

import { resetDatabase, testDb } from "./db";

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

const rule = { windowSeconds: 60, max: 3 };

describe("consumeRateLimit", () => {
  it("allows max attempts in a window, then blocks until it lapses", async () => {
    const start = 1_700_000_000_000;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect((await consumeRateLimit("k", rule, start + attempt)).allowed).toBe(
        true,
      );
    }
    const blocked = await consumeRateLimit("k", rule, start + 10_000);
    expect(blocked).toMatchObject({ allowed: false, remaining: 0 });
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);

    // A new window starts fresh: blocks are temporary, never lockouts.
    // The window began at the first attempt (start + 1), so it lapses at start + 60_001.
    expect(await consumeRateLimit("k", rule, start + 1 + 60_000)).toMatchObject(
      {
        allowed: true,
        remaining: 2,
      },
    );
  });

  it("keeps keys independent and counts concurrent attempts atomically", async () => {
    const now = Date.now();
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        consumeRateLimit("burst", { windowSeconds: 60, max: 4 }, now),
      ),
    );
    expect(outcomes.filter((o) => o.allowed)).toHaveLength(4);
    expect((await consumeRateLimit("other", rule, now)).allowed).toBe(true);
    const row = await testDb.rateLimit.findUniqueOrThrow({
      where: { key: "burst" },
    });
    expect(row.count).toBe(10);
  });

  it("cleans up stale counters only", async () => {
    const now = Date.now();
    await consumeRateLimit("old", rule, now - 2 * 24 * 60 * 60 * 1000);
    await consumeRateLimit("fresh", rule, now);
    expect(await cleanupRateLimits(24 * 60 * 60, now)).toBe(1);
    expect(await testDb.rateLimit.findMany()).toHaveLength(1);
  });
});
