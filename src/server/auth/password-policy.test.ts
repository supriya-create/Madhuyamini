import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  checkPassword,
  checkPasswordLocally,
  isListedInRange,
  sha1Prefix,
} from "./password-policy";

describe("checkPasswordLocally", () => {
  it("enforces 10–128 characters", () => {
    expect(checkPasswordLocally("short1234")).toBe("too_short");
    expect(checkPasswordLocally("x".repeat(129))).toBe("too_long");
    expect(checkPasswordLocally("correct horse battery")).toBeNull();
  });

  it("rejects the customer's own email or name", () => {
    expect(
      checkPasswordLocally("Asha.Devi@Example.com", {
        email: "asha.devi@example.com",
      }),
    ).toBe("matches_email");
    expect(
      checkPasswordLocally("asha.devi99", { email: "asha.devi99@example.com" }),
    ).toBe("matches_email");
    expect(
      checkPasswordLocally("Supriya Sinha", { name: "supriya sinha" }),
    ).toBe("matches_name");
  });

  it("rejects common and predictable passwords regardless of case", () => {
    expect(checkPasswordLocally("Password123")).toBe("too_predictable");
    expect(checkPasswordLocally("QWERTYUIOP")).toBe("too_predictable");
    expect(checkPasswordLocally("1234567890")).toBe("too_predictable");
    expect(checkPasswordLocally("0987654321")).toBe("too_predictable");
    expect(checkPasswordLocally("aaaaaaaaaaaa")).toBe("too_predictable");
    expect(checkPasswordLocally("abababababab")).toBe("too_predictable");
    expect(checkPasswordLocally("madhuyamini123")).toBe("too_predictable");
  });

  it("accepts ordinary passphrases without composition rules", () => {
    expect(checkPasswordLocally("peacock on the pallu")).toBeNull();
    expect(checkPasswordLocally("kohbar-2019-bihar")).toBeNull();
  });
});

describe("breach lookup", () => {
  const password = "peacock on the pallu";
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();

  it("sends only the first five characters of the SHA-1", () => {
    expect(sha1Prefix(password)).toBe(sha1.slice(0, 5));
    expect(sha1Prefix(password)).toHaveLength(5);
  });

  it("matches the suffix in a range response", () => {
    const range = `0000A:3\r\n${sha1.slice(5)}:12\r\nFFFFF:0`;
    expect(isListedInRange(password, range)).toBe(true);
    expect(isListedInRange(password, `${sha1.slice(5)}:0`)).toBe(false);
    expect(isListedInRange("another passphrase", range)).toBe(false);
  });

  it("reports a compromised password when the lookup lists it", async () => {
    const lookup = vi.fn().mockResolvedValue(`${sha1.slice(5)}:99`);
    expect(await checkPassword(password, {}, lookup)).toBe("compromised");
    expect(lookup).toHaveBeenCalledWith(sha1.slice(0, 5));
  });

  it("fails open when the lookup is unavailable, and skips it when disabled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      await checkPassword(password, {}, vi.fn().mockResolvedValue(null)),
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(await checkPassword(password, {}, null)).toBeNull();
  });

  it("applies local rules before any network lookup", async () => {
    const lookup = vi.fn();
    expect(await checkPassword("password123", {}, lookup)).toBe(
      "too_predictable",
    );
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("hibpLookup transport (k-anonymity)", () => {
  it("sends only the five-character SHA-1 prefix, never the password or full hash", async () => {
    const { hibpLookup } = await import("./password-policy");
    const calls: string[] = [];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        calls.push(String(input));
        return Promise.resolve(new Response("ABCDE:1\r\n", { status: 200 }));
      });
    const password = "peacock on the pallu";
    const prefix = sha1Prefix(password);
    const body = await hibpLookup(prefix);

    expect(body).toBe("ABCDE:1\r\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(calls[0]).not.toContain(password);
    expect(calls[0]?.split("/").pop()).toHaveLength(5);
    fetchSpy.mockRestore();
  });

  it("returns null (fail open) on network errors and non-OK responses", async () => {
    const { hibpLookup } = await import("./password-policy");
    const failing = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));
    expect(await hibpLookup("ABCDE")).toBeNull();
    failing.mockRestore();
    const serverError = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 503 }));
    expect(await hibpLookup("ABCDE")).toBeNull();
    serverError.mockRestore();
  });

  it("fail-open never bypasses the local rules", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unavailable = vi.fn().mockResolvedValue(null);
    expect(await checkPassword("password123", {}, unavailable)).toBe(
      "too_predictable",
    );
    expect(await checkPassword("short", {}, unavailable)).toBe("too_short");
    expect(
      await checkPassword(
        "asha@example.com",
        { email: "asha@example.com" },
        unavailable,
      ),
    ).toBe("matches_email");
    expect(unavailable).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
