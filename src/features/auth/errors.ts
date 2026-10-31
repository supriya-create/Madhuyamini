import { APIError } from "better-auth/api";

/** Reads Better Auth's machine-readable error code, if any. */
export function authErrorCode(error: unknown): string | null {
  if (!(error instanceof APIError)) return null;
  const body: unknown = error.body;
  if (
    body &&
    typeof body === "object" &&
    "code" in body &&
    typeof body.code === "string"
  ) {
    return body.code;
  }
  return null;
}

export function authErrorMessage(error: unknown): string | null {
  return error instanceof APIError ? error.message : null;
}

/** Password-policy rejections raised by our Better Auth hook. */
export function isPasswordPolicyError(error: unknown): boolean {
  return authErrorCode(error)?.startsWith("PASSWORD_") ?? false;
}
