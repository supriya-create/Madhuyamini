import { randomUUID } from "node:crypto";

import { getAdminPolicy } from "@/config/admin-policy";
import type { UserRole } from "@/generated/prisma/enums";
import {
  beginEnrolment,
  confirmEnrolment,
} from "@/features/admin/security/service";
import type { CurrentUser } from "@/server/auth/current-user";
import { resolveStaffContext } from "@/server/auth/staff";
import type { StaffContext } from "@/server/auth/staff";
import { base32Decode, currentStep, totpAt } from "@/server/security/totp";

import { testDb } from "./db";

/** Fixtures for the staff gate: users, sessions and a completed enrolment. */

export type StaffUserRow = Omit<CurrentUser, "session">;

export async function createStaffUser(
  role: UserRole,
  email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@example.com`,
): Promise<StaffUserRow> {
  return testDb.user.create({
    data: { email, name: `Test ${role}`, role, emailVerified: true },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      name: true,
      phone: true,
      role: true,
    },
  });
}

export async function createSession(user: StaffUserRow): Promise<CurrentUser> {
  const session = await testDb.session.create({
    data: {
      userId: user.id,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    select: { id: true, token: true, createdAt: true, expiresAt: true },
  });
  return { ...user, session };
}

/** The code an authenticator app would show for this secret at `now`. */
export function codeFor(secretBase32: string, now: Date): string {
  const { totp } = getAdminPolicy();
  return totpAt(
    base32Decode(secretBase32),
    currentStep(now, totp.periodSeconds),
    totp.digits,
  );
}

export async function enrolAndVerify(
  user: CurrentUser,
  now = new Date(),
): Promise<{
  ctx: StaffContext;
  secretBase32: string;
  recoveryCodes: readonly string[];
}> {
  const start = await beginEnrolment(user, now);
  const { recoveryCodes } = await confirmEnrolment(
    user,
    codeFor(start.secretBase32, now),
    now,
  );
  const resolution = await resolveStaffContext(user);
  if (!resolution.ok) throw new Error(`gate: ${resolution.reason}`);
  return {
    ctx: resolution.ctx,
    secretBase32: start.secretBase32,
    recoveryCodes,
  };
}

export async function verifiedStaff(
  role: "STAFF" | "ADMIN",
  now = new Date(),
): Promise<{ user: CurrentUser; ctx: StaffContext; secretBase32: string }> {
  const user = await createSession(await createStaffUser(role));
  const { ctx, secretBase32 } = await enrolAndVerify(user, now);
  return { user, ctx, secretBase32 };
}

export function minutesLater(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60 * 1000);
}
