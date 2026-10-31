import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/server/db";
import { sendEmailAfterResponse } from "@/server/email";
import {
  resetPasswordMessage,
  verifyEmailMessage,
} from "@/server/email/templates";
import { env, isProduction } from "@/server/env";

import {
  checkPassword,
  hibpLookup,
  passwordProblemMessages,
} from "./password-policy";

/**
 * Better Auth instance (decision D3). Policy lives here so it also covers the
 * HTTP endpoints, and the app keeps authorisation in its own data-access layer
 * (`current-user.ts`). See docs/auth.md.
 */

const DAY = 60 * 60 * 24;

/** 14-day inactivity timeout (P4). The 30-day absolute cap lives in session-lifetime.ts. */
export const SESSION_IDLE_SECONDS = 14 * DAY;

/**
 * Paths served over HTTP by the catch-all route. Everything else is reached
 * only through the app's Server Actions (`auth.api.*`), which add rate
 * limiting and enumeration-safe responses. Email verification must stay
 * public: the link in the email is a GET to this endpoint.
 */
const PUBLIC_HTTP_PATHS = new Set(["/verify-email", "/ok", "/error"]);

function isHttpPathAllowed(path: string): boolean {
  return PUBLIC_HTTP_PATHS.has(path);
}

export const auth = betterAuth({
  appName: "Madhuyamini",
  baseURL: env.siteUrl.origin,
  secret: env.betterAuthSecret,
  trustedOrigins: [env.siteUrl.origin],
  database: prismaAdapter(db, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    // No auto sign-in on registration: with this off, Better Auth answers a
    // duplicate email with the same generic success as a new one (requirement 5).
    autoSignIn: false,
    requireEmailVerification: false,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 30 * 60,
    sendResetPassword: async ({ user, token }) => {
      const url = new URL("/reset-password", env.siteUrl);
      url.searchParams.set("token", token);
      await sendEmailAfterResponse(
        resetPasswordMessage({
          to: user.email,
          name: user.name,
          url: url.toString(),
        }),
      );
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    expiresIn: DAY,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmailAfterResponse(
        verifyEmailMessage({ to: user.email, name: user.name, url }),
      );
    },
  },

  session: {
    expiresIn: SESSION_IDLE_SECONDS,
    updateAge: DAY,
    // Every request checks the database so revocation is immediate.
    cookieCache: { enabled: false },
  },

  user: {
    additionalFields: {
      // Server-owned: clients can never set or change these (requirement 3).
      role: { type: "string", required: false, input: false },
      phone: { type: "string", required: false, input: false },
    },
  },

  advanced: {
    database: { generateId: false }, // PostgreSQL generates UUID v7 ids
    ipAddress: { disableIpTracking: true },
    useSecureCookies: isProduction,
  },

  // HTTP surface for direct API calls that do get through (defence in depth).
  rateLimit: {
    enabled: true,
    storage: "database",
    modelName: "rateLimit",
    window: 60,
    max: 30,
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // 1. Restrict the HTTP surface. `ctx.request` exists only for HTTP calls.
      if (ctx.request && !isHttpPathAllowed(ctx.path)) {
        throw new APIError("NOT_FOUND", { message: "Not found" });
      }

      // 2. Password policy (P3) on every path that sets a password.
      if (
        ctx.path === "/sign-up/email" ||
        ctx.path === "/reset-password" ||
        ctx.path === "/change-password"
      ) {
        const body = ctx.body as Record<string, unknown> | undefined;
        const password = body?.password ?? body?.newPassword;
        if (typeof password !== "string") return;
        const problem = await checkPassword(
          password,
          {
            email: typeof body?.email === "string" ? body.email : undefined,
            name: typeof body?.name === "string" ? body.name : undefined,
          },
          env.passwordBreachCheck === "hibp" ? hibpLookup : null,
        );
        if (problem) {
          throw new APIError("BAD_REQUEST", {
            message: passwordProblemMessages[problem],
            code: `PASSWORD_${problem.toUpperCase()}`,
          });
        }
      }
    }),
  },

  plugins: [nextCookies()],
});

export type Auth = typeof auth;
