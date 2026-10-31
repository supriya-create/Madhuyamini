import { describe, expect, it } from "vitest";

import { parseEnv } from "./env-schema";

const DATABASE_URL = "postgresql://app:pw@localhost:5432/madhuyamini";
const BETTER_AUTH_SECRET = "x".repeat(32);

/** Every valid configuration needs a database and a secret; tests add only what they vary. */
const withDb = (source: Record<string, string | undefined>) => ({
  DATABASE_URL,
  BETTER_AUTH_SECRET,
  ...source,
});

describe("parseEnv", () => {
  it("defaults to development on localhost when only the database is set", () => {
    const env = parseEnv(withDb({}));
    expect(env.siteEnv).toBe("development");
    expect(env.siteUrl.origin).toBe("http://localhost:3000");
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv(withDb({ SITE_ENV: "", SITE_URL: "" }));
    expect(env.siteEnv).toBe("development");
  });

  it("falls back to VERCEL_ENV when SITE_ENV is not set", () => {
    expect(parseEnv(withDb({ VERCEL_ENV: "preview" })).siteEnv).toBe("preview");
  });

  it("prefers an explicit SITE_ENV over VERCEL_ENV", () => {
    expect(
      parseEnv(withDb({ SITE_ENV: "development", VERCEL_ENV: "preview" }))
        .siteEnv,
    ).toBe("development");
  });

  it("accepts a valid production configuration", () => {
    const env = parseEnv(
      withDb({
        SITE_ENV: "production",
        SITE_URL: "https://madhuyamini.example",
      }),
    );
    expect(env.siteEnv).toBe("production");
    expect(env.siteUrl.origin).toBe("https://madhuyamini.example");
  });

  it("requires SITE_URL in production", () => {
    expect(() => parseEnv(withDb({ SITE_ENV: "production" }))).toThrow(
      /SITE_URL/,
    );
  });

  it("requires https in production", () => {
    expect(() =>
      parseEnv(
        withDb({
          SITE_ENV: "production",
          SITE_URL: "http://madhuyamini.example",
        }),
      ),
    ).toThrow(/https/);
  });

  it("rejects unknown stages", () => {
    expect(() => parseEnv(withDb({ SITE_ENV: "staging" }))).toThrow(/SITE_ENV/);
  });

  it("rejects malformed and non-http URLs", () => {
    expect(() => parseEnv(withDb({ SITE_URL: "not a url" }))).toThrow(
      /SITE_URL/,
    );
    expect(() => parseEnv(withDb({ SITE_URL: "javascript:alert(1)" }))).toThrow(
      /SITE_URL/,
    );
  });

  it("never echoes variable values in the error message", () => {
    const secretLooking = "http://user:supersecret@example.com";
    try {
      parseEnv({
        SITE_ENV: "production",
        SITE_URL: secretLooking,
        DATABASE_URL:
          "postgresql://app:dbsecret@db.example:5432/x?sslmode=require&bogus",
      });
      expect.unreachable("parseEnv should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain("supersecret");
    }
  });

  it("never echoes the database password when DATABASE_URL is rejected", () => {
    expect(() =>
      parseEnv({ DATABASE_URL: "mysql://app:dbsecret@db.example/x" }),
    ).toThrow();
    try {
      parseEnv({ DATABASE_URL: "mysql://app:dbsecret@db.example/x" });
    } catch (error) {
      expect(String(error)).not.toContain("dbsecret");
    }
  });
});

describe("database, auth and email settings", () => {
  it("requires a PostgreSQL DATABASE_URL", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ BETTER_AUTH_SECRET, DATABASE_URL: "" })).toThrow(
      /DATABASE_URL/,
    );
    expect(() =>
      parseEnv(withDb({ DATABASE_URL: "mysql://localhost/db" })),
    ).toThrow(/postgresql/);
    expect(() => parseEnv(withDb({ DATABASE_URL: "not a url" }))).toThrow(
      /DATABASE_URL/,
    );
  });

  it("accepts both postgresql:// and postgres:// schemes", () => {
    expect(
      parseEnv(withDb({ DATABASE_URL: "postgres://localhost/db" })).databaseUrl,
    ).toBe("postgres://localhost/db");
  });

  it("requires a long BETTER_AUTH_SECRET and never echoes it", () => {
    expect(() => parseEnv({ DATABASE_URL })).toThrow(/BETTER_AUTH_SECRET/);
    try {
      parseEnv({ DATABASE_URL, BETTER_AUTH_SECRET: "tooshortsecret" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(String(error)).toMatch(/32 characters/);
      expect(String(error)).not.toContain("tooshortsecret");
    }
  });

  it("defaults email to the file transport outside production and to Resend in production", () => {
    expect(parseEnv(withDb({})).email).toMatchObject({
      transport: "file",
      resendApiKey: null,
      outboxDir: ".mail",
    });
    expect(parseEnv(withDb({})).passwordBreachCheck).toBe("off");

    const production = parseEnv(
      withDb({
        SITE_ENV: "production",
        SITE_URL: "https://madhuyamini.example",
      }),
    );
    expect(production.email.transport).toBe("resend");
    // Missing credentials do not fail parsing, and therefore not the build.
    expect(production.email.resendApiKey).toBeNull();
    expect(production.passwordBreachCheck).toBe("hibp");
  });

  it("refuses a non-Resend transport in production", () => {
    expect(() =>
      parseEnv(
        withDb({
          SITE_ENV: "production",
          SITE_URL: "https://madhuyamini.example",
          EMAIL_TRANSPORT: "file",
        }),
      ),
    ).toThrow(/EMAIL_TRANSPORT/);
  });

  it("passes email settings through and rejects unknown transports", () => {
    const env = parseEnv(
      withDb({
        EMAIL_TRANSPORT: "resend",
        RESEND_API_KEY: "re_test_123",
        EMAIL_FROM: "Madhuyamini <hello@madhuyamini.example>",
        PASSWORD_BREACH_CHECK: "hibp",
      }),
    );
    expect(env.email).toEqual({
      transport: "resend",
      from: "Madhuyamini <hello@madhuyamini.example>",
      resendApiKey: "re_test_123",
      outboxDir: ".mail",
    });
    expect(env.passwordBreachCheck).toBe("hibp");
    expect(() => parseEnv(withDb({ EMAIL_TRANSPORT: "smtp" }))).toThrow(
      /EMAIL_TRANSPORT/,
    );
  });
});
