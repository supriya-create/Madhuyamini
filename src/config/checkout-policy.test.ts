import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  backoffMinutesFor,
  checkoutPolicy,
  checkoutPolicySchema,
  getCheckoutPolicy,
} from "./checkout-policy";

describe("checkout policy", () => {
  it("holds the owner's approved values", () => {
    const policy = getCheckoutPolicy();
    expect(policy).toBe(checkoutPolicy);
    // D7a
    expect(policy.shipping).toEqual({
      flatInPaise: 9_900,
      freeAtSubtotalInPaise: 199_900,
      serviceableCountries: ["IN"],
    });
    // D7b
    expect(policy.cod).toEqual({
      enabled: true,
      feeInPaise: 0,
      maxOrderInPaise: 500_000,
    });
    // D6
    expect(policy.reservation).toEqual({
      ttlMinutes: 15,
      extensionMinutes: 15,
      maxExtensions: 1,
    });
    expect(policy.guestAccess.tokenTtlDays).toBe(7);
    expect(policy.payment.minOrderInPaise).toBe(100);
    expect(policy.jobs.maxAttempts).toBeLessThanOrEqual(10);
  });

  it("rejects malformed policies instead of running with them", () => {
    expect(
      checkoutPolicySchema.safeParse({
        ...checkoutPolicy,
        shipping: { ...checkoutPolicy.shipping, flatInPaise: -1 },
      }).success,
    ).toBe(false);
    expect(
      checkoutPolicySchema.safeParse({
        ...checkoutPolicy,
        jobs: { ...checkoutPolicy.jobs, maxAttempts: 11 },
      }).success,
    ).toBe(false);
    expect(
      checkoutPolicySchema.safeParse({ ...checkoutPolicy, extra: true })
        .success,
    ).toBe(false);
    expect(
      checkoutPolicySchema.safeParse({
        ...checkoutPolicy,
        payment: { ...checkoutPolicy.payment, currency: "USD" },
      }).success,
    ).toBe(false);
  });

  it("backs off along the schedule and holds at the last step", () => {
    const jobs = {
      ...checkoutPolicy.jobs,
      backoffMinutes: [1, 5, 15],
    };
    expect(backoffMinutesFor(jobs, 1)).toBe(1);
    expect(backoffMinutesFor(jobs, 2)).toBe(5);
    expect(backoffMinutesFor(jobs, 3)).toBe(15);
    expect(backoffMinutesFor(jobs, 9)).toBe(15);
    expect(backoffMinutesFor(jobs, 0)).toBe(1);
  });

  /**
   * Amounts and durations belong in the policy, not in the modules that
   * apply it. The scan is deliberately simple: a paise literal (`_900`,
   * `9900`) or a minutes/days literal next to a time word is a smell worth a
   * human look, so the rare legitimate case gets an inline allowance comment.
   */
  it("keeps literal amounts and durations out of the checkout modules", () => {
    const roots = [
      "src/features/checkout",
      "src/features/orders",
      "src/features/returns",
      "src/features/payments",
      "src/features/inventory",
      "src/server/jobs",
      "src/server/payments",
      "src/features/admin",
      "src/server/security",
      "src/server/uploads",
      "src/server/auth/staff.ts",
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of listTypeScript(root)) {
        const source = readFileSync(file, "utf8");
        source.split("\n").forEach((rawLine, index) => {
          if (rawLine.includes("policy-literal-ok")) return;
          const line = stripComments(rawLine);
          if (/\b\d{1,3}(_\d{3})+\b|\b\d{4,}\b/.test(stripStrings(line))) {
            offenders.push(`${file}:${index + 1}: ${line.trim()}`);
          }
          if (/\b\d+\s*\*\s*60\b|\bminutes?\s*[:=]\s*\d+/i.test(line)) {
            offenders.push(`${file}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

function listTypeScript(root: string): string[] {
  let entries: string[];
  try {
    if (statSync(root).isFile()) return [root];
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return listTypeScript(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** Comments may cite RFC numbers and the like; only code is scanned. */
function stripComments(line: string): string {
  const trimmed = line.trimStart();
  if (
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("//")
  )
    return "";
  return line.replace(/\/\/.*$/, "");
}

/** Drops string contents so ids, messages and SQL text are not mistaken for amounts. */
function stripStrings(line: string): string {
  return line.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}
