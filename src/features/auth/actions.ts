"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth/auth";
import {
  getCurrentUser,
  requestClientAddress,
  requireUser,
} from "@/server/auth/current-user";
import {
  RateLimitedError,
  authRateLimits,
  consumeRateLimit,
  rateLimitKey,
} from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { routes } from "@/lib/routes";

import { authErrorMessage, isPasswordPolicyError } from "./errors";
import { parseForm, pickFormValues } from "./form-data";
import {
  forgotPasswordSchema,
  registerSchema,
  resetPasswordSchema,
  safeReturnPath,
  signInSchema,
} from "./schemas";
import type { FormState } from "./schemas";

/**
 * Authentication Server Actions. Each one: validates with Zod, applies the
 * PostgreSQL rate limits (D5), calls Better Auth, and returns only generic,
 * enumeration-safe messages. Cookies are set by the nextCookies plugin.
 */

const GENERIC_SIGN_IN_ERROR =
  "That email and password combination is not correct.";
const TRY_LATER =
  "Too many attempts. Please wait a little while and try again.";

function rateLimited(retryAfterSeconds: number): FormState {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return {
    status: "error",
    message: `${TRY_LATER} (About ${minutes} minute${minutes === 1 ? "" : "s"}.)`,
  };
}

async function enforce(
  key: string,
  rule: { windowSeconds: number; max: number },
) {
  const outcome = await consumeRateLimit(key, rule);
  if (!outcome.allowed) throw new RateLimitedError(outcome.retryAfterSeconds);
}

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    registerSchema,
    pickFormValues(formData, ["name", "email", "password", "phone"]),
  );
  if (!parsed.ok) return parsed.state;
  const { name, email, password, phone } = parsed.data;

  try {
    await enforce(
      rateLimitKey("register:ip", await requestClientAddress()),
      authRateLimits.registerByIp,
    );

    // Duplicate emails get this exact same response (Better Auth's generic
    // duplicate handling with autoSignIn off), and nobody is emailed about it.
    const result = await auth.api.signUpEmail({
      body: {
        name,
        email,
        password,
        callbackURL: `${routes.login}?verified=1`,
      },
    });

    if (phone) {
      // Only a user created by this very call can match: an existing account
      // has an older createdAt, and a synthetic duplicate id has no row at all.
      await db.user.updateMany({
        where: {
          id: result.user.id,
          phone: null,
          createdAt: { gte: new Date(Date.now() - 10_000) },
        },
        data: { phone },
      });
    }
  } catch (error) {
    if (error instanceof RateLimitedError)
      return rateLimited(error.retryAfterSeconds);
    if (isPasswordPolicyError(error)) {
      return {
        status: "error",
        message: "Please choose a different password.",
        fieldErrors: {
          password:
            authErrorMessage(error) ?? "Please choose a different password.",
        },
      };
    }
    console.error("[auth] register failed", {
      code: (error as { body?: { code?: string } })?.body?.code,
    });
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  return {
    status: "success",
    message: `We’ve sent a confirmation link to ${email}. You can sign in straight away; confirming your address lets us send order updates.`,
  };
}

export async function signInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    signInSchema,
    pickFormValues(formData, ["email", "password", "next"]),
  );
  if (!parsed.ok) {
    // Never hint at which field failed beyond "both are required".
    return {
      status: "error",
      message: "Enter your email address and password.",
    };
  }
  const { email, password } = parsed.data;
  const destination = safeReturnPath(parsed.data.next, routes.account);

  try {
    const address = await requestClientAddress();
    await enforce(
      rateLimitKey("sign-in:ip", address),
      authRateLimits.signInByIp,
    );
    await enforce(
      rateLimitKey("sign-in:email", email),
      authRateLimits.signInByEmail,
    );
    await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof RateLimitedError)
      return rateLimited(error.retryAfterSeconds);
    // Wrong password, unknown email and unverified-only errors all collapse to one message.
    return { status: "error", message: GENERIC_SIGN_IN_ERROR };
  }

  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect(routes.home);
}

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    forgotPasswordSchema,
    pickFormValues(formData, ["email"]),
  );
  if (!parsed.ok) return parsed.state;
  const { email } = parsed.data;

  try {
    await enforce(
      rateLimitKey("reset:ip", await requestClientAddress()),
      authRateLimits.resetRequestByIp,
    );
    await enforce(
      rateLimitKey("reset:email", email),
      authRateLimits.resetRequestByEmail,
    );
    // Resolves the same way whether or not the account exists; no email for unknown addresses.
    await auth.api.requestPasswordReset({ body: { email } });
  } catch (error) {
    if (error instanceof RateLimitedError)
      return rateLimited(error.retryAfterSeconds);
    console.error("[auth] reset request failed");
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  return {
    status: "success",
    message:
      "If an account exists for that address, we’ve sent a link to choose a new password. It works for 30 minutes.",
  };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    resetPasswordSchema,
    pickFormValues(formData, ["token", "password"]),
  );
  if (!parsed.ok) return parsed.state;
  const { token, password } = parsed.data;

  try {
    await auth.api.resetPassword({ body: { newPassword: password, token } });
  } catch (error) {
    if (isPasswordPolicyError(error)) {
      return {
        status: "error",
        message: "Please choose a different password.",
        fieldErrors: {
          password:
            authErrorMessage(error) ?? "Please choose a different password.",
        },
      };
    }
    return {
      status: "error",
      message:
        "This link has expired or has already been used. Request a new one to continue.",
    };
  }

  redirect(`${routes.login}?reset=1`);
}

export async function resendVerificationAction(): Promise<FormState> {
  const user = await requireUser();
  if (user.emailVerified)
    return {
      status: "success",
      message: "Your email address is already confirmed.",
    };

  try {
    await enforce(
      rateLimitKey("verify:email", user.email),
      authRateLimits.verificationResendByEmail,
    );
    await auth.api.sendVerificationEmail({
      headers: await headers(),
      body: { email: user.email, callbackURL: `${routes.login}?verified=1` },
    });
  } catch (error) {
    if (error instanceof RateLimitedError)
      return rateLimited(error.retryAfterSeconds);
    console.error("[auth] resend verification failed");
    return {
      status: "error",
      message: "Something went wrong. Please try again.",
    };
  }

  return {
    status: "success",
    message: `We’ve sent a new confirmation link to ${user.email}.`,
  };
}

/** Used by pages that must not render for signed-in customers (login, register). */
export async function redirectIfSignedIn(
  destination: string = routes.account,
): Promise<void> {
  if (await getCurrentUser()) redirect(destination);
}
