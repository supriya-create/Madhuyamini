import { describe, expect, it } from "vitest";

import { parseEnv } from "./env-schema";

const DATABASE_URL = "postgresql://app:pw@localhost:5432/madhuyamini";

/** Every valid configuration needs a database; tests add only what they vary. */
const withDb = (source: Record<string, string | undefined>) => ({
  DATABASE_URL,
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
