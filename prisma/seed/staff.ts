import { hashPassword } from "better-auth/crypto";

import type { AppPrismaClient } from "../../src/server/prisma-client";

/**
 * Development staff accounts, created only when SEED_ADMIN_PASSWORD is set
 * (CI sets a throwaway value for the admin e2e journeys). The seed guard
 * already refuses production and remote databases. Password hashes use the
 * same scrypt function Better Auth uses at sign-in. Each run also clears the
 * accounts' second factor and sessions, so the e2e journeys always start at
 * enrolment.
 */

export const DEV_STAFF = [
  { email: "admin@example.com", name: "Development Admin", role: "ADMIN" },
  { email: "staff@example.com", name: "Development Staff", role: "STAFF" },
] as const;

export async function seedStaff(
  prisma: AppPrismaClient,
  password: string | undefined,
): Promise<number> {
  if (!password) return 0;
  const hash = await hashPassword(password);
  let count = 0;
  for (const staff of DEV_STAFF) {
    const user = await prisma.user.upsert({
      where: { email: staff.email },
      create: {
        email: staff.email,
        name: staff.name,
        role: staff.role,
        emailVerified: true,
      },
      update: { role: staff.role, emailVerified: true },
      select: { id: true },
    });
    await prisma.account.upsert({
      where: {
        providerId_accountId: { providerId: "credential", accountId: user.id },
      },
      create: {
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: hash,
      },
      update: { password: hash },
    });
    await prisma.staffRecoveryCode.deleteMany({ where: { userId: user.id } });
    await prisma.staffTwoFactor.deleteMany({ where: { userId: user.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    count += 1;
  }
  return count;
}
