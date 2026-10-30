import { describe, expect, it } from "vitest";

import { parseEnv } from "./env-schema";

describe("parseEnv", () => {
  it("defaults to development on localhost when nothing is set", () => {
    const env = parseEnv({});
    expect(env.siteEnv).toBe("development");
    expect(env.siteUrl.origin).toBe("http://localhost:3000");
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv({ SITE_ENV: "", SITE_URL: "" });
    expect(env.siteEnv).toBe("development");
  });

  it("falls back to VERCEL_ENV when SITE_ENV is not set", () => {
    expect(parseEnv({ VERCEL_ENV: "preview" }).siteEnv).toBe("preview");
  });

  it("prefers an explicit SITE_ENV over VERCEL_ENV", () => {
    expect(
      parseEnv({ SITE_ENV: "development", VERCEL_ENV: "preview" }).siteEnv,
    ).toBe("development");
  });

  it("accepts a valid production configuration", () => {
    const env = parseEnv({
      SITE_ENV: "production",
      SITE_URL: "https://madhuyamini.example",
    });
    expect(env.siteEnv).toBe("production");
    expect(env.siteUrl.origin).toBe("https://madhuyamini.example");
  });

  it("requires SITE_URL in production", () => {
    expect(() => parseEnv({ SITE_ENV: "production" })).toThrow(/SITE_URL/);
  });

  it("requires https in production", () => {
    expect(() =>
      parseEnv({
        SITE_ENV: "production",
        SITE_URL: "http://madhuyamini.example",
      }),
    ).toThrow(/https/);
  });

  it("rejects unknown stages", () => {
    expect(() => parseEnv({ SITE_ENV: "staging" })).toThrow(/SITE_ENV/);
  });

  it("rejects malformed and non-http URLs", () => {
    expect(() => parseEnv({ SITE_URL: "not a url" })).toThrow(/SITE_URL/);
    expect(() => parseEnv({ SITE_URL: "javascript:alert(1)" })).toThrow(
      /SITE_URL/,
    );
  });

  it("never echoes variable values in the error message", () => {
    const secretLooking = "http://user:supersecret@example.com";
    try {
      parseEnv({ SITE_ENV: "production", SITE_URL: secretLooking });
      expect.unreachable("parseEnv should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain("supersecret");
    }
  });
});
