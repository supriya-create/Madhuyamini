import { describe, expect, it } from "vitest";

import {
  phoneSchema,
  registerSchema,
  safeReturnPath,
  signInSchema,
} from "./schemas";

describe("safeReturnPath", () => {
  it("allows same-site paths only", () => {
    expect(safeReturnPath("/account/addresses?tab=1", "/account")).toBe(
      "/account/addresses?tab=1",
    );
    for (const bad of [
      "//evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "account",
      "/a\\b",
      undefined,
      42,
    ]) {
      expect(safeReturnPath(bad, "/account")).toBe("/account");
    }
  });
});

describe("phoneSchema", () => {
  it("normalises Indian numbers to E.164 and accepts international ones", () => {
    expect(phoneSchema.parse("98765 43210")).toBe("+919876543210");
    expect(phoneSchema.parse("+91 (98765) 43210")).toBe("+919876543210");
    expect(phoneSchema.parse("+44 20 7946 0958")).toBe("+442079460958");
    expect(phoneSchema.safeParse("12345").success).toBe(false);
    expect(phoneSchema.safeParse("abc").success).toBe(false);
  });
});

describe("registerSchema", () => {
  it("lower-cases email, trims name and treats a blank phone as absent", () => {
    const parsed = registerSchema.parse({
      name: "  Asha Devi ",
      email: "Asha@Example.COM",
      password: "peacock on the pallu",
      phone: "",
    });
    expect(parsed).toEqual({
      name: "Asha Devi",
      email: "asha@example.com",
      password: "peacock on the pallu",
      phone: undefined,
    });
  });

  it("rejects unknown keys such as role", () => {
    expect(
      registerSchema.safeParse({
        name: "Asha",
        email: "a@example.com",
        password: "peacock on the pallu",
        phone: "",
        role: "ADMIN",
      }).success,
    ).toBe(false);
  });
});

describe("signInSchema", () => {
  it("requires both fields but does not reveal policy on the password", () => {
    const result = signInSchema.safeParse({
      email: "a@example.com",
      password: "x",
    });
    expect(result.success).toBe(true);
    expect(
      signInSchema.safeParse({ email: "nope", password: "x" }).success,
    ).toBe(false);
  });
});
