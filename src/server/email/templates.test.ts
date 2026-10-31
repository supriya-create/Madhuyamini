import { describe, expect, it } from "vitest";

import {
  passwordChangedMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from "./templates";

const url =
  "https://madhuyamini.example/api/auth/verify-email?token=abc123SECRET";

describe("email templates", () => {
  it("puts one-time links in the body only, never in the subject", () => {
    for (const message of [
      verifyEmailMessage({ to: "a@example.com", name: "Asha", url }),
      resetPasswordMessage({ to: "a@example.com", name: "Asha", url }),
    ]) {
      expect(message.subject).not.toContain("SECRET");
      expect(message.text).toContain(url);
      expect(message.html).toContain(url);
    }
  });

  it("escapes HTML in names and URLs", () => {
    const message = verifyEmailMessage({
      to: "a@example.com",
      name: "<script>alert(1)</script>",
      url: "https://x.example/?a=1&b=2",
    });
    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("a=1&amp;b=2");
  });

  it("has a text version for every message", () => {
    const changed = passwordChangedMessage({
      to: "a@example.com",
      name: "Asha",
    });
    expect(changed.text).toMatch(/password .* was just changed/);
    expect(changed.html).toContain("signed out");
  });
});
