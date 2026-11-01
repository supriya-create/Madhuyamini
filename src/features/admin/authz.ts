import "server-only";

import { getAdminPolicy } from "@/config/admin-policy";
import { minutesToMs } from "@/config/checkout-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/generated/prisma/enums";
import { assertLiveStaffContext } from "@/server/auth/staff";
import type { StaffContext } from "@/server/auth/staff";
import { AppError } from "@/server/errors";

import {
  ADMIN_CAPABILITIES,
  STAFF_CAPABILITIES,
  SENSITIVE_CAPABILITIES,
} from "./capabilities";
import type { Capability } from "./capabilities";

/**
 * Authorisation for the admin area (docs/admin.md §9). The matrix itself is
 * pure (`capabilities.ts`); this module binds it to a live StaffContext.
 */

export class ForbiddenCapabilityError extends AppError {
  readonly capability: Capability;

  constructor(capability: Capability) {
    super("You do not have permission to do that.", {
      code: "ADMIN_FORBIDDEN",
      status: 403,
    });
    this.capability = capability;
  }
}

/** Sensitive operations need a second-factor check within the re-auth window. */
export class ReauthRequiredError extends AppError {
  readonly capability: Capability;

  constructor(capability: Capability) {
    super("Please confirm your second factor to continue.", {
      code: "ADMIN_REAUTH_REQUIRED",
      status: 403,
    });
    this.capability = capability;
  }
}

export function can(role: UserRole, capability: Capability): boolean {
  if (role === "ADMIN") return ADMIN_CAPABILITIES.has(capability);
  if (role === "STAFF") return STAFF_CAPABILITIES.has(capability);
  return false;
}

export function isSensitive(capability: Capability): boolean {
  return SENSITIVE_CAPABILITIES.has(capability);
}

export function isReauthFresh(ctx: StaffContext, now = new Date()): boolean {
  const window = minutesToMs(getAdminPolicy().sessions.reauthWindowMinutes);
  return now.getTime() - ctx.verifiedAt.getTime() <= window;
}

/**
 * Throws unless the context is live in the database, the role holds the
 * capability, and (for sensitive capabilities) the session re-authenticated
 * recently. Every admin service calls this before touching data.
 */
export async function requirePermission(
  ctx: StaffContext,
  capability: Capability,
  options: { readonly now?: Date; readonly tx?: Prisma.TransactionClient } = {},
): Promise<void> {
  await assertLiveStaffContext(ctx, options.tx);
  if (!can(ctx.role, capability))
    throw new ForbiddenCapabilityError(capability);
  if (isSensitive(capability) && !isReauthFresh(ctx, options.now)) {
    throw new ReauthRequiredError(capability);
  }
}
