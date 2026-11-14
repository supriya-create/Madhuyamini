import { describe, expect, it } from "vitest";

import { parseEnv } from "@/server/env-schema";

import { assertPaymentReadiness, checkPaymentReadiness } from "./readiness";

const base = {
  DATABASE_URL: "postgresql://app:pw@localhost:5432/madhuyamini",
  BETTER_AUTH_SECRET: "x".repeat(32),
};
const production = {
  ...base,
  SITE_ENV: "production",
  SITE_URL: "https://madhuyamini.example",
};

describe("production payment readiness", () => {
  it("passes with live keys and a webhook secret", () => {
    const env = parseEnv({
      ...production,
      RAZORPAY_KEY_ID: "rzp_live_abc123",
      RAZORPAY_KEY_SECRET: "live-secret",
      RAZORPAY_WEBHOOK_SECRET: "whsec",
    });
    expect(checkPaymentReadiness(env)).toEqual([]);
    expect(() => assertPaymentReadiness(env)).not.toThrow();
  });

  it("refuses to start production without Razorpay credentials", () => {
    const env = parseEnv(production);
    // The build-time schema tolerates this; the server must not.
    expect(env.payments).toEqual({ gateway: "razorpay", razorpay: null });
    expect(checkPaymentReadiness(env)).toEqual([
      "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required in production",
    ]);
    expect(() => assertPaymentReadiness(env)).toThrow(
      /not ready for production/,
    );
  });

  it("refuses to start production without a webhook secret, as defence in depth behind the schema", () => {
    // The schema now rejects keys without a webhook secret at parse time; the
    // startup check must still stand on its own, so bypass the schema here.
    const env = {
      siteEnv: "production" as const,
      payments: {
        gateway: "razorpay" as const,
        razorpay: {
          keyId: "rzp_live_abc123",
          keySecret: "the-live-secret-value",
          webhookSecrets: [],
        },
      },
    };
    const problems = checkPaymentReadiness(env);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/RAZORPAY_WEBHOOK_SECRET/);
    let message = "";
    try {
      assertPaymentReadiness(env);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/WEBHOOK_SECRET/);
    expect(message).not.toContain("the-live-secret-value");
    expect(message).not.toContain("rzp_live_abc123");
  });

  it("flags a non-live key or a non-Razorpay gateway if one ever reached a production env object", () => {
    // Bypassing the schema on purpose: the check must stand on its own.
    expect(
      checkPaymentReadiness({
        siteEnv: "production",
        payments: {
          gateway: "fake",
          razorpay: {
            keyId: "rzp_test_abc",
            keySecret: "s",
            webhookSecrets: ["w"],
          },
        },
      }),
    ).toEqual([
      "PAYMENT_GATEWAY must be razorpay in production",
      "RAZORPAY_KEY_ID must be a live key (rzp_live_…) in production",
    ]);
  });

  it("is a no-op outside production, where a missing gateway only disables online payment", () => {
    for (const siteEnv of ["development", "preview"] as const) {
      const env = parseEnv({
        ...base,
        // A preview must name an isolated database; development may use any.
        DATABASE_URL: `postgresql://app:pw@localhost:5432/madhuyamini_${siteEnv}`,
        SITE_ENV: siteEnv,
        PAYMENT_GATEWAY: "razorpay",
      });
      expect(checkPaymentReadiness(env)).toEqual([]);
    }
  });
});
