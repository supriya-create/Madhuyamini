import { createHash } from "node:crypto";

/**
 * Password policy (P3): 10–128 characters, no composition rules, must not be
 * the customer's own email or name, must not be a commonly compromised
 * password. Pure checks live here; the optional Have I Been Pwned lookup is
 * injected so it can be disabled in tests and fails open in production.
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Commonly breached passwords that are long enough to pass the length rule.
 * Drawn from widely published most-used-password lists; the length rule
 * already removes the short majority. Compared case-insensitively.
 */
const COMMON_PASSWORDS = new Set(
  [
    "1234567890",
    "12345678910",
    "123456789012",
    "0987654321",
    "qwertyuiop",
    "qwertyuiop1",
    "qwertyuiopasdfghjkl",
    "asdfghjkl;",
    "asdfghjkl1",
    "zxcvbnm123",
    "1q2w3e4r5t",
    "1q2w3e4r5t6y",
    "1qaz2wsx3edc",
    "qazwsxedcrfv",
    "abcdefghij",
    "abcdefghijk",
    "abcdefghijklmnop",
    "abcd1234ef",
    "password12",
    "password123",
    "password1234",
    "password12345",
    "password1!",
    "password!1",
    "password@123",
    "passw0rd123",
    "p@ssw0rd123",
    "p@ssword123",
    "letmein123",
    "welcome123",
    "welcome1234",
    "admin12345",
    "administrator",
    "iloveyou12",
    "iloveyou123",
    "iloveyou1234",
    "sunshine123",
    "princess123",
    "football123",
    "superman123",
    "baseball123",
    "trustno1234",
    "computer123",
    "internet123",
    "whatever123",
    "monkey12345",
    "dragon12345",
    "india@12345",
    "india123456",
    "indian12345",
    "mumbai12345",
    "delhi123456",
    "bangalore1",
    "madhubani1",
    "madhuyamini",
    "madhuyamini1",
    "madhuyamini123",
  ].map((entry) => entry.toLowerCase()),
);

export type PasswordProblem =
  | "too_short"
  | "too_long"
  | "matches_email"
  | "matches_name"
  | "too_predictable"
  | "compromised";

export const passwordProblemMessages: Readonly<
  Record<PasswordProblem, string>
> = {
  too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  matches_email: "Your password cannot be your email address.",
  matches_name: "Your password cannot be your name.",
  too_predictable:
    "That password is too predictable. Try a longer phrase that is unique to you.",
  compromised:
    "That password has appeared in a data breach. Please choose a different one.",
};

function isRepetitiveOrSequential(password: string): boolean {
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(lower)) return true; // aaaaaaaaaa
  if (/^(..)\1{4,}$/.test(lower)) return true; // ababababab
  const digitsOnly = /^\d+$/.test(lower);
  if (digitsOnly) {
    let ascending = true;
    let descending = true;
    for (let index = 1; index < lower.length; index += 1) {
      const diff = Number(lower[index]) - Number(lower[index - 1]);
      if (diff !== 1 && diff !== -9) ascending = false;
      if (diff !== -1 && diff !== 9) descending = false;
    }
    if (ascending || descending) return true;
  }
  return false;
}

export interface PasswordContext {
  readonly email?: string;
  readonly name?: string;
}

/** Synchronous rules only. Returns the first problem found, or null. */
export function checkPasswordLocally(
  password: string,
  context: PasswordContext = {},
): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "too_short";
  if (password.length > PASSWORD_MAX_LENGTH) return "too_long";

  const lower = password.toLowerCase();
  const email = context.email?.trim().toLowerCase();
  if (email && (lower === email || lower === email.split("@")[0]))
    return "matches_email";
  const name = context.name?.trim().toLowerCase();
  if (name && name.length >= 3 && lower === name) return "matches_name";

  if (COMMON_PASSWORDS.has(lower) || isRepetitiveOrSequential(lower))
    return "too_predictable";
  return null;
}

export type BreachLookup = (sha1Prefix: string) => Promise<string | null>;

const HIBP_RANGE_ENDPOINT = "https://api.pwnedpasswords.com/range/";

/**
 * Have I Been Pwned range query (k-anonymity: only the first five hex
 * characters of the SHA-1 leave the server). Returns null on any failure so
 * the caller can fail open; a logged warning records the outage.
 */
export const hibpLookup: BreachLookup = async (sha1Prefix) => {
  try {
    const response = await fetch(`${HIBP_RANGE_ENDPOINT}${sha1Prefix}`, {
      headers: {
        "Add-Padding": "true",
        "User-Agent": "Madhuyamini password check",
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
};

/** True when the password's SHA-1 suffix appears in the range response with a count > 0. */
export function isListedInRange(
  password: string,
  rangeResponse: string,
): boolean {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const suffix = sha1.slice(5);
  for (const line of rangeResponse.split(/\r?\n/)) {
    const [hashSuffix, count] = line.trim().split(":");
    if (hashSuffix === suffix && Number(count) > 0) return true;
  }
  return false;
}

export function sha1Prefix(password: string): string {
  return createHash("sha1")
    .update(password)
    .digest("hex")
    .toUpperCase()
    .slice(0, 5);
}

/**
 * Full policy: local rules, then the optional breach lookup. The lookup fails
 * open (returns no problem) when unavailable, by design.
 */
export async function checkPassword(
  password: string,
  context: PasswordContext,
  lookup: BreachLookup | null,
): Promise<PasswordProblem | null> {
  const local = checkPasswordLocally(password, context);
  if (local) return local;
  if (!lookup) return null;

  const range = await lookup(sha1Prefix(password));
  if (range === null) {
    console.warn(
      "[auth] breach lookup unavailable; accepting password without the check",
    );
    return null;
  }
  return isListedInRange(password, range) ? "compromised" : null;
}
