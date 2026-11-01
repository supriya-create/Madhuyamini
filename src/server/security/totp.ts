import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226, HMAC-SHA1), secret
 * encryption at rest and one-time recovery codes (docs/admin.md §5.9). Pure:
 * no I/O, no clock of its own; callers pass the time and the policy, so the
 * RFC test vectors and the replay rules are unit-testable.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 input");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes: number): Buffer {
  return randomBytes(bytes);
}

/** RFC 4226 HOTP: dynamic truncation of HMAC-SHA1 over the 8-byte counter. */
export function hotp(secret: Buffer, counter: bigint, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  const modulus = 10 ** digits;
  return (binary % modulus).toString().padStart(digits, "0");
}

export function currentStep(now: Date, periodSeconds: number): bigint {
  return BigInt(Math.floor(now.getTime() / 1000 / periodSeconds)); // policy-literal-ok: ms → s
}

export function totpAt(secret: Buffer, step: bigint, digits: number): string {
  return hotp(secret, step, digits);
}

export interface TotpWindow {
  readonly digits: number;
  readonly periodSeconds: number;
  readonly windowSteps: number;
}

/**
 * The time step whose code matches `code` within ±windowSteps of now, or
 * null. Comparison is constant-time per candidate; the caller then applies
 * the replay rule (the step must exceed the last accepted one).
 */
export function findMatchingStep(
  secret: Buffer,
  code: string,
  now: Date,
  window: TotpWindow,
): bigint | null {
  const normalised = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${window.digits}}$`).test(normalised)) return null;
  const provided = Buffer.from(normalised, "utf8");
  const centre = currentStep(now, window.periodSeconds);
  let matched: bigint | null = null;
  for (
    let offset = -window.windowSteps;
    offset <= window.windowSteps;
    offset += 1
  ) {
    const step = centre + BigInt(offset);
    if (step < 0n) continue;
    const expected = Buffer.from(totpAt(secret, step, window.digits), "utf8");
    // Always compare every candidate so timing does not reveal which matched.
    if (timingSafeEqual(expected, provided) && matched === null) matched = step;
  }
  return matched;
}

export function otpauthUri(params: {
  issuer: string;
  account: string;
  secret: Buffer;
  digits: number;
  periodSeconds: number;
}): string {
  const label = encodeURIComponent(`${params.issuer}:${params.account}`);
  const query = new URLSearchParams({
    secret: base32Encode(params.secret),
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(params.digits),
    period: String(params.periodSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

// ---------------------------------------------------------------------------
// Secret encryption at rest: AES-256-GCM, iv | tag | ciphertext, base64url.
// ---------------------------------------------------------------------------

const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptSecret(secret: Buffer, key: Buffer): string {
  if (key.length !== 32) throw new Error("TOTP key must be 32 bytes");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptSecret(encoded: string, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error("TOTP key must be 32 bytes");
  const data = Buffer.from(encoded, "base64url");
  if (data.length <= IV_BYTES + TAG_BYTES)
    throw new Error("Ciphertext too short");
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ---------------------------------------------------------------------------
// Recovery codes: unambiguous alphabet, shown once, stored as scrypt hashes
// salted per user so the lookup by hash stays deterministic.
// ---------------------------------------------------------------------------

const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateRecoveryCodes(count: number, length: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let code = "";
    for (let i = 0; i < length; i += 1) {
      code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    codes.add(code);
  }
  return [...codes];
}

/** Upper-cases and strips separators a user may type or paste. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function hashRecoveryCode(code: string, userId: string): string {
  return scryptSync(normalizeRecoveryCode(code), `recovery:${userId}`, 32, {
    N: 16384, // policy-literal-ok: scrypt cost
    r: 8,
    p: 1,
  }).toString("base64url");
}

/** Readable form for the one-time display: XXXXX-XXXXX. */
export { formatRecoveryCode } from "@/lib/recovery-code";
