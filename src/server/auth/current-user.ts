import "server-only";

import { headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";

import type { UserRole } from "@/generated/prisma/enums";
import { AppError } from "@/server/errors";

import { auth } from "./auth";
import { isWithinAbsoluteLifetime } from "./session-lifetime";

/**
 * Data-access layer for identity. Every page, layout and Server Action that
 * touches a customer's data calls these; `proxy.ts` only redirects
 * optimistically. The session is loaded from the database on each request
 * (no cookie cache), so revocation takes effect immediately.
 */

const roleSchema = z.enum(["CUSTOMER", "STAFF", "ADMIN"]);

export interface CurrentUser {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string;
  readonly phone: string | null;
  readonly role: UserRole;
  readonly session: {
    readonly id: string;
    readonly token: string;
    readonly createdAt: Date;
    readonly expiresAt: Date;
  };
}

export class UnauthorizedError extends AppError {
  constructor() {
    super("Sign in to continue", { code: "UNAUTHORIZED", status: 401 });
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super("You do not have access to this", { code: "FORBIDDEN", status: 403 });
  }
}

/** Current user for this request, or null. Memoised per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const result = await auth.api.getSession({ headers: await headers() });
  if (!result) return null;

  const { session, user } = result;

  // P4: 30-day absolute lifetime, on top of Better Auth's 14-day idle timeout.
  if (!isWithinAbsoluteLifetime(session.createdAt)) {
    await auth.api.revokeSession({
      headers: await headers(),
      body: { token: session.token },
    });
    return null;
  }

  const role = roleSchema.safeParse(user.role);
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    phone:
      typeof user.phone === "string" && user.phone.length > 0
        ? user.phone
        : null,
    role: role.success ? role.data : "CUSTOMER",
    session: {
      id: session.id,
      token: session.token,
      createdAt: new Date(session.createdAt),
      expiresAt: new Date(session.expiresAt),
    },
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

const roleRank: Record<UserRole, number> = { CUSTOMER: 0, STAFF: 1, ADMIN: 2 };

/** ADMIN satisfies STAFF; nothing satisfies ADMIN but ADMIN. */
export async function requireRole(minimum: UserRole): Promise<CurrentUser> {
  const user = await requireUser();
  if (roleRank[user.role] < roleRank[minimum]) throw new ForbiddenError();
  return user;
}

/** Best-effort client address for rate limiting; "unknown" when behind no proxy. */
export async function requestClientAddress(): Promise<string> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || requestHeaders.get("x-real-ip") || "unknown";
}
