import { emailSchema, passwordInputSchema } from "./schemas";

/**
 * Client-side shape check for the sign-in form, run before the Server Action
 * so an empty or malformed entry is pointed out beside its field without a
 * round trip. The same Zod schemas run again inside `signInAction`, which
 * still answers with one generic message and never says which field failed.
 */

export interface SignInInput {
  readonly email: string;
  readonly password: string;
}

export interface SignInFieldErrors {
  readonly email?: string;
  readonly password?: string;
}

export function validateSignInInput(input: SignInInput): SignInFieldErrors {
  const errors: { email?: string; password?: string } = {};

  const email = emailSchema.safeParse(input.email);
  if (!email.success) {
    errors.email = email.error.issues[0]?.message ?? "Enter your email address";
  }

  const password = passwordInputSchema.safeParse(input.password);
  if (!password.success) {
    const issue = password.error.issues[0];
    errors.password =
      issue?.code === "too_small"
        ? "Enter your password"
        : (issue?.message ?? "Enter your password");
  }

  return errors;
}

export function hasSignInErrors(errors: SignInFieldErrors): boolean {
  return errors.email !== undefined || errors.password !== undefined;
}
