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

  it("rejects empty and whitespace-only entries with the field messages", () => {
    const empty = signInSchema.safeParse({ email: "", password: "" });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      // Zod reports every failed check; the first message per field is the
      // one shown beside it.
      const firstMessageFor = (field: string) =>
        empty.error.issues.find((issue) => issue.path[0] === field)?.message;
      expect(firstMessageFor("email")).toBe("Enter your email address");
      expect(firstMessageFor("password")).toBe("Enter a password");
    }
    expect(
      signInSchema.safeParse({ email: "   ", password: "x" }).success,
    ).toBe(false);
  });

  it("normalises the email and keeps the optional return path as given", () => {
    expect(
      signInSchema.parse({
        email: "  Asha@Example.COM ",
        password: "x",
        next: "/account/addresses",
      }),
    ).toEqual({
      email: "asha@example.com",
      password: "x",
      next: "/account/addresses",
    });
  });

  it("bounds the password without a minimum and refuses unknown keys", () => {
    expect(
      signInSchema.safeParse({ email: "a@example.com", password: "ab" })
        .success,
    ).toBe(true);
    expect(
      signInSchema.safeParse({
        email: "a@example.com",
        password: "p".repeat(129),
      }).success,
    ).toBe(false);
    expect(
      signInSchema.safeParse({
        email: "a@example.com",
        password: "x",
        remember: "1",
      }).success,
    ).toBe(false);
  });
});
