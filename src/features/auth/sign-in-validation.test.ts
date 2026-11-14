import { describe, expect, it } from "vitest";

import { PASSWORD_MAX_LENGTH } from "@/server/auth/password-policy";

import { hasSignInErrors, validateSignInInput } from "./sign-in-validation";

describe("validateSignInInput", () => {
  it("accepts a well-formed email and any non-empty password", () => {
    const errors = validateSignInInput({
      email: " Asha@Example.com ",
      password: "x",
    });
    expect(errors).toEqual({});
    expect(hasSignInErrors(errors)).toBe(false);
  });

  it("asks for both fields when the form is empty", () => {
    const errors = validateSignInInput({ email: "", password: "" });
    expect(errors).toEqual({
      email: "Enter your email address",
      password: "Enter your password",
    });
    expect(hasSignInErrors(errors)).toBe(true);
  });

  it("treats a whitespace-only email as empty", () => {
    expect(validateSignInInput({ email: "   ", password: "x" })).toEqual({
      email: "Enter your email address",
    });
  });

  it("flags a malformed email without touching a valid password", () => {
    for (const email of ["asha", "asha@", "@example.com", "asha example.com"]) {
      expect(validateSignInInput({ email, password: "x" })).toEqual({
        email: "Enter a valid email address",
      });
    }
  });

  it("bounds both fields the way the server does", () => {
    const longLocalPart = "a".repeat(250);
    expect(
      validateSignInInput({
        email: `${longLocalPart}@example.com`,
        password: "x",
      }).email,
    ).toBe("That email address is too long");
    expect(
      validateSignInInput({
        email: "asha@example.com",
        password: "p".repeat(PASSWORD_MAX_LENGTH + 1),
      }).password,
    ).toBe(`Use at most ${PASSWORD_MAX_LENGTH} characters`);
  });

  it("never reveals password policy on sign-in: a short password passes", () => {
    expect(
      validateSignInInput({ email: "asha@example.com", password: "ab" }),
    ).toEqual({});
  });
});
