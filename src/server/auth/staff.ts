import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { routes } from "@/lib/routes";

import { getCurrentUser } from "./current-user";
import type { CurrentUser } from "./current-user";

/**
 * The staff gate (docs/admin.md §6, refinement 6). A `StaffContext` exists
 * only when the signed-in user is STAFF or ADMIN, has a confirmed second
 * factor, and THIS session has passed it. Every admin data and service
 * function takes one as its first argument; `assertLiveStaffContext`
 * re-reads the database so a forged object buys nothing.
 */

declare const staffContextBrand: unique symbol;

export interface StaffContext {
  readonly [staffContextBrand]: true;
  readonly user: CurrentUser;
  readonly role: "STAFF" | "ADMIN";
  readonly sessionId: string;
  /** When this session last passed the second factor (re-auth refreshes it). */
  readonly verifiedAt: Date;
}

export type StaffGateReason =
  "anonymous" | "forbidden" | "not_enrolled" | "unverified";

export class StaffGateError extends AppError {
  readonly reason: StaffGateReason;

  constructor(reason: StaffGateReason) {
    super(
      reason === "anonymous"
        ? "Sign in to continue."
        : reason === "forbidden"
          ? "You do not have access to this area."
          : reason === "not_enrolled"
            ? "Set up your second factor to continue."
            : "Confirm your second factor to continue.",
      {
        code: `STAFF_${reason.toUpperCase()}`,
        status: reason === "anonymous" ? 401 : 403,
      },
    );
    this.reason = reason;
  }
}

export type StaffResolution =
  | { readonly ok: true; readonly ctx: StaffContext }
  | { readonly ok: false; readonly reason: StaffGateReason };

type Tx = Prisma.TransactionClient;

/** Pure of request scope: tests pass a user and a client. */
export async function resolveStaffContext(
  user: CurrentUser | null,
  tx: Tx = db,
): Promise<StaffResolution> {
  if (!user) return { ok: false, reason: "anonymous" };
  if (user.role === "CUSTOMER") return { ok: false, reason: "forbidden" };
  const twoFactor = await tx.staffTwoFactor.findUnique({
    where: { userId: user.id },
    select: { enabledAt: true },
  });
  if (!twoFactor?.enabledAt) return { ok: false, reason: "not_enrolled" };
  const verification = await tx.staffSessionVerification.findUnique({
    where: { sessionId: user.session.id },
    select: { verifiedAt: true },
  });
  if (!verification) return { ok: false, reason: "unverified" };
  return {
    ok: true,
    ctx: {
      user,
      role: user.role,
      sessionId: user.session.id,
      verifiedAt: verification.verifiedAt,
    } as StaffContext,
  };
}

/**
 * Re-checks a context against the database: the user still holds a staff
 * role, is enrolled, and this session is still verified. Called by every
 * permission check so that nothing trusts the object alone.
 */
export async function assertLiveStaffContext(
  ctx: StaffContext,
  tx: Tx = db,
): Promise<void> {
  const [user, verification] = await Promise.all([
    tx.user.findUnique({
      where: { id: ctx.user.id },
      select: { role: true, staffTwoFactor: { select: { enabledAt: true } } },
    }),
    tx.staffSessionVerification.findUnique({
      where: { sessionId: ctx.sessionId },
      select: { userId: true },
    }),
  ]);
  if (!user || user.role === "CUSTOMER") throw new StaffGateError("forbidden");
  if (!user.staffTwoFactor?.enabledAt) throw new StaffGateError("not_enrolled");
  if (!verification || verification.userId !== ctx.user.id)
    throw new StaffGateError("unverified");
}

export const getStaffContext = cache(async (): Promise<StaffResolution> =>
  resolveStaffContext(await getCurrentUser()),
);

/** For services and actions: throws when the gate is not passed. */
export async function requireStaffSession(): Promise<StaffContext> {
  const resolution = await getStaffContext();
  if (!resolution.ok) throw new StaffGateError(resolution.reason);
  return resolution.ctx;
}

/**
 * For pages: sends the visitor where the gate says, with a return path.
 * Customers get the storefront's not-found page, never a hint that /admin
 * exists.
 */
export async function requireStaffSessionOrRedirect(
  next: string,
): Promise<StaffContext> {
  const resolution = await getStaffContext();
  if (resolution.ok) return resolution.ctx;
  if (resolution.reason === "forbidden") notFound();
  redirect(redirectForGate(resolution.reason, next));
}

export function redirectForGate(
  reason: Exclude<StaffGateReason, "forbidden">,
  next: string,
): string {
  const back = encodeURIComponent(next);
  switch (reason) {
    case "anonymous":
      return `${routes.login}?next=${back}`;
    case "not_enrolled":
      return `${routes.accountTwoFactor}?next=${back}`;
    case "unverified":
      return `${routes.loginVerify}?next=${back}`;
  }
}
