import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  base32Decode,
  base32Encode,
  currentStep,
  decryptSecret,
  encryptSecret,
  findMatchingStep,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  hotp,
  normalizeRecoveryCode,
  otpauthUri,
  totpAt,
} from "./totp";

/** RFC 6238 Appendix B (SHA-1 secret "12345678901234567890"), last six digits. */
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: Array<[number, string, string]> = [
  [59, "94287082", "287082"],
  [1111111109, "07081804", "081804"],
  [1111111111, "14050471", "050471"],
  [1234567890, "89005924", "005924"],
  [2000000000, "69279037", "279037"],
  [20000000000, "65353130", "353130"],
];
const WINDOW = { digits: 6, periodSeconds: 30, windowSteps: 1 };

describe("RFC 6238 vectors", () => {
  it.each(RFC_VECTORS)("time %d → %s", (seconds, eight, six) => {
    const step = currentStep(new Date(seconds * 1000), 30);
    expect(totpAt(RFC_SECRET, step, 8)).toBe(eight);
    expect(totpAt(RFC_SECRET, step, 6)).toBe(six);
  });

  it("matches RFC 4226 HOTP for the first counters", () => {
    // RFC 4226 Appendix D, secret "12345678901234567890".
    expect(hotp(RFC_SECRET, 0n, 6)).toBe("755224");
    expect(hotp(RFC_SECRET, 1n, 6)).toBe("287082");
    expect(hotp(RFC_SECRET, 9n, 6)).toBe("520489");
  });
});

describe("code matching", () => {
  const secret = randomBytes(20);
  const now = new Date("2026-11-01T12:00:15Z");
  const step = currentStep(now, 30);

  it("accepts the current step and one either side, reporting which", () => {
    expect(findMatchingStep(secret, totpAt(secret, step, 6), now, WINDOW)).toBe(
      step,
    );
    expect(
      findMatchingStep(secret, totpAt(secret, step - 1n, 6), now, WINDOW),
    ).toBe(step - 1n);
    expect(
      findMatchingStep(secret, totpAt(secret, step + 1n, 6), now, WINDOW),
    ).toBe(step + 1n);
    expect(
      findMatchingStep(secret, totpAt(secret, step + 2n, 6), now, WINDOW),
    ).toBeNull();
    expect(
      findMatchingStep(secret, totpAt(secret, step - 2n, 6), now, WINDOW),
    ).toBeNull();
  });

  it("tolerates spaces and refuses malformed input without throwing", () => {
    const code = totpAt(secret, step, 6);
    expect(
      findMatchingStep(
        secret,
        `${code.slice(0, 3)} ${code.slice(3)}`,
        now,
        WINDOW,
      ),
    ).toBe(step);
    for (const bad of ["", "12345", "1234567", "abcdef", "12345a"]) {
      expect(findMatchingStep(secret, bad, now, WINDOW)).toBeNull();
    }
    expect(findMatchingStep(randomBytes(20), code, now, WINDOW)).toBeNull();
  });

  it("builds the provisioning URI apps expect", () => {
    const uri = otpauthUri({
      issuer: "Madhuyamini",
      account: "staff@example.com",
      secret: base32Decode("JBSWY3DPEHPK3PXP"),
      digits: 6,
      periodSeconds: 30,
    });
    expect(uri).toBe(
      "otpauth://totp/Madhuyamini%3Astaff%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Madhuyamini&algorithm=SHA1&digits=6&period=30",
    );
  });
});

describe("base32", () => {
  it("round-trips and matches a known encoding", () => {
    expect(base32Encode(Buffer.from("Hello!"))).toBe("JBSWY3DPEE");
    expect(base32Decode("JBSWY3DPEE").toString()).toBe("Hello!");
    for (let i = 0; i < 20; i += 1) {
      const bytes = randomBytes(1 + i);
      expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    }
    expect(() => base32Decode("1!")).toThrow(/base32/);
  });
});

describe("secret encryption", () => {
  const key = randomBytes(32);

  it("round-trips under the key, never repeats ciphertext, and rejects tampering", () => {
    const secret = randomBytes(20);
    const a = encryptSecret(secret, key);
    const b = encryptSecret(secret, key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key).equals(secret)).toBe(true);
    expect(decryptSecret(b, key).equals(secret)).toBe(true);
    expect(() => decryptSecret(a, randomBytes(32))).toThrow();
    const tampered = Buffer.from(a, "base64url");
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(tampered.toString("base64url"), key)).toThrow();
    expect(() => decryptSecret("short", key)).toThrow(/short/);
    expect(() => encryptSecret(secret, randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe("recovery codes", () => {
  it("generates distinct codes from the unambiguous alphabet and hashes per user", () => {
    const codes = generateRecoveryCodes(10, 10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes)
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
    const first = codes[0]!;
    expect(hashRecoveryCode(first, "user-a")).toBe(
      hashRecoveryCode(formatRecoveryCode(first).toLowerCase(), "user-a"),
    );
    expect(hashRecoveryCode(first, "user-a")).not.toBe(
      hashRecoveryCode(first, "user-b"),
    );
    expect(hashRecoveryCode(first, "user-a")).not.toContain(first);
    expect(normalizeRecoveryCode(" ab-cd ef ")).toBe("ABCDEF");
    expect(formatRecoveryCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });
});
