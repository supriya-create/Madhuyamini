import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  TwoFactorError,
  beginEnrolment,
  confirmEnrolment,
  pendingEnrolment,
  resetTwoFactor,
  securityStatus,
  verifySecondFactor,
} from "@/features/admin/security/service";
import {
  PromoteError,
  promoteToAdmin,
} from "@/features/admin/security/promote";
import { StaffGateError, resolveStaffContext } from "@/server/auth/staff";

import { seedStaff } from "../../prisma/seed/staff";
import { resetDatabase, testDb } from "./db";
import {
  codeFor,
  createSession,
  createStaffUser,
  enrolAndVerify,
  minutesLater,
  verifiedStaff,
} from "./staff";

/**
 * The staff second factor (docs/admin.md §5.9): enrolment that counts only
 * once verified, replay protection and recovery codes that are atomic under
 * concurrency, rate limits, admin reset, and the first-admin script (§13).
 */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

const code = (error: unknown) =>
  error instanceof TwoFactorError ? error.code : String(error);

describe("enrolment", () => {
  it("counts only after a valid code, then issues hashed recovery codes and verifies this session", async () => {
    const now = new Date();
    const user = await createSession(await createStaffUser("STAFF"));
    const start = await beginEnrolment(user, now);
    expect(start.secretBase32).toMatch(/^[A-Z2-7]{32}$/);
    expect(start.uri).toMatch(/^otpauth:\/\/totp\/Madhuyamini(:|%3A)/);
    expect(start.uri).toContain(`secret=${start.secretBase32}`);
    expect(await securityStatus(user)).toMatchObject({
      enabled: false,
      pending: true,
      recoveryCodesRemaining: 0,
      sessionVerifiedAt: null,
    });
    expect((await pendingEnrolment(user, now))?.secretBase32).toBe(
      start.secretBase32,
    );

    await expect(confirmEnrolment(user, "000000", now)).rejects.toSatisfy(
      (error) => code(error) === "TWO_FACTOR_INVALID_CODE",
    );
    expect((await securityStatus(user)).enabled).toBe(false);

    const { recoveryCodes } = await confirmEnrolment(
      user,
      codeFor(start.secretBase32, now),
      now,
    );
    expect(recoveryCodes).toHaveLength(10);
    for (const plain of recoveryCodes) {
      expect(plain).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/);
    }
    const stored = await testDb.staffRecoveryCode.findMany({
      where: { userId: user.id },
    });
    expect(stored).toHaveLength(10);
    for (const row of stored) {
      expect(recoveryCodes).not.toContain(row.codeHash);
      expect(row.usedAt).toBeNull();
    }
    expect(await securityStatus(user)).toMatchObject({
      enabled: true,
      pending: false,
      recoveryCodesRemaining: 10,
      sessionVerifiedAt: now,
    });
    // The secret is stored encrypted, never in the clear, and the setup key is gone.
    const factor = await testDb.staffTwoFactor.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(factor.secretCiphertext).not.toContain(start.secretBase32);
    expect(await pendingEnrolment(user, now)).toBeNull();

    const audit = await testDb.adminAuditLog.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((row) => [row.action, row.outcome])).toEqual([
      ["security.two_factor.begin", "SUCCESS"],
      ["security.two_factor.confirm", "REFUSED"],
      ["security.two_factor.confirm", "SUCCESS"],
    ]);
    expect(JSON.stringify(audit)).not.toContain(start.secretBase32);
    for (const plain of recoveryCodes) {
      expect(JSON.stringify(audit)).not.toContain(plain);
    }
  });

  it("expires a pending enrolment and lets the user start again", async () => {
    const now = new Date();
    const user = await createSession(await createStaffUser("STAFF"));
    const start = await beginEnrolment(user, now);
    const later = minutesLater(now, 16);
    expect(await pendingEnrolment(user, later)).toBeNull();
    await expect(
      confirmEnrolment(user, codeFor(start.secretBase32, later), later),
    ).rejects.toSatisfy(
      (error) => code(error) === "TWO_FACTOR_ENROLMENT_EXPIRED",
    );
    const restart = await beginEnrolment(user, later);
    expect(restart.secretBase32).not.toBe(start.secretBase32);
    await confirmEnrolment(user, codeFor(restart.secretBase32, later), later);
    expect((await securityStatus(user)).enabled).toBe(true);
  });

  it("refuses re-enrolment once enabled until an ADMIN resets it", async () => {
    const staff = await verifiedStaff("STAFF");
    await expect(beginEnrolment(staff.user)).rejects.toSatisfy(
      (error) => code(error) === "TWO_FACTOR_ALREADY_ENABLED",
    );

    const admin = await verifiedStaff("ADMIN");
    await resetTwoFactor(admin.ctx, staff.user.id, "lost phone");
    expect(await securityStatus(staff.user)).toMatchObject({
      enabled: false,
      pending: false,
      recoveryCodesRemaining: 0,
      sessionVerifiedAt: null,
    });
    expect(await resolveStaffContext(staff.user)).toEqual({
      ok: false,
      reason: "not_enrolled",
    });
    const reset = await testDb.adminAuditLog.findFirstOrThrow({
      where: { action: "security.two_factor.reset" },
    });
    expect(reset).toMatchObject({
      actorId: admin.user.id,
      targetId: staff.user.id,
      outcome: "SUCCESS",
      reason: "lost phone",
    });
    expect(
      await testDb.notificationOutbox.count({ where: { kind: "ops.alert" } }),
    ).toBe(1);

    const again = await beginEnrolment(staff.user);
    expect(again.secretBase32).toBeTruthy();
  });

  it("is for staff accounts only, and STAFF cannot reset anyone", async () => {
    const customer = await createSession(await createStaffUser("CUSTOMER"));
    await expect(beginEnrolment(customer)).rejects.toSatisfy(
      (error) => code(error) === "TWO_FACTOR_NOT_AVAILABLE",
    );
    const staff = await verifiedStaff("STAFF");
    const other = await verifiedStaff("STAFF");
    await expect(
      resetTwoFactor(staff.ctx, other.user.id, "no"),
    ).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    expect((await securityStatus(other.user)).enabled).toBe(true);
  });
});

describe("verification", () => {
  it("accepts each code once: a replay is refused even from another session", async () => {
    const now = new Date();
    const row = await createStaffUser("STAFF");
    const first = await createSession(row);
    const { secretBase32 } = await enrolAndVerify(first, now);
    const second = await createSession(row);

    await expect(
      verifySecondFactor(
        second,
        { kind: "totp", code: codeFor(secretBase32, now) },
        { now },
      ),
    ).rejects.toSatisfy((error) => code(error) === "TWO_FACTOR_INVALID_CODE");
    expect(await resolveStaffContext(second)).toEqual({
      ok: false,
      reason: "unverified",
    });
    expect(
      await testDb.adminAuditLog.count({
        where: { errorCode: "TWO_FACTOR_REPLAYED" },
      }),
    ).toBe(1);

    const later = new Date(now.getTime() + 30_000);
    await verifySecondFactor(
      second,
      { kind: "totp", code: codeFor(secretBase32, later) },
      { now: later, requestIp: "203.0.113.9" },
    );
    expect((await resolveStaffContext(second)).ok).toBe(true);
    // The hashed address is stored, never the address itself.
    const verified = await testDb.adminAuditLog.findFirstOrThrow({
      where: { action: "security.two_factor.verify", outcome: "SUCCESS" },
    });
    expect(verified.requestIp).toBeTruthy();
    expect(verified.requestIp).not.toContain("203.0.113.9");
  });

  it("lets exactly one of several concurrent requests with the same code win", async () => {
    const now = new Date();
    const row = await createStaffUser("STAFF");
    const enrolled = await createSession(row);
    const { secretBase32 } = await enrolAndVerify(enrolled, now);
    const later = new Date(now.getTime() + 60_000);
    const sessions = await Promise.all([
      createSession(row),
      createSession(row),
      createSession(row),
      createSession(row),
    ]);
    const results = await Promise.allSettled(
      sessions.map((session) =>
        verifySecondFactor(
          session,
          { kind: "totp", code: codeFor(secretBase32, later) },
          { now: later },
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await testDb.staffSessionVerification.count({
        where: { userId: row.id },
      }),
    ).toBe(2); // the enrolment session plus the one winner
  });

  it("rate-limits attempts per user, correct code or not", async () => {
    const now = new Date();
    const row = await createStaffUser("STAFF");
    const enrolled = await createSession(row);
    const { secretBase32 } = await enrolAndVerify(enrolled, now);
    const session = await createSession(row);
    // The enrolment itself used one attempt; four wrong ones exhaust the window.
    for (let i = 0; i < 4; i += 1) {
      await expect(
        verifySecondFactor(session, { kind: "totp", code: "123456" }, { now }),
      ).rejects.toSatisfy((error) => code(error) === "TWO_FACTOR_INVALID_CODE");
    }
    const later = new Date(now.getTime() + 60_000);
    await expect(
      verifySecondFactor(
        session,
        { kind: "totp", code: codeFor(secretBase32, later) },
        { now: later },
      ),
    ).rejects.toSatisfy((error) => code(error) === "TWO_FACTOR_RATE_LIMITED");
    expect(await resolveStaffContext(session)).toEqual({
      ok: false,
      reason: "unverified",
    });
  });

  it("consumes a recovery code once and notifies the user and the owner", async () => {
    const now = new Date();
    const row = await createStaffUser("STAFF");
    const enrolled = await createSession(row);
    const { recoveryCodes } = await enrolAndVerify(enrolled, now);
    const [plain] = recoveryCodes;
    if (!plain) throw new Error("no recovery codes");

    const second = await createSession(row);
    await verifySecondFactor(
      second,
      { kind: "recovery", code: plain.toLowerCase() },
      { now },
    );
    expect((await resolveStaffContext(second)).ok).toBe(true);
    expect((await securityStatus(second)).recoveryCodesRemaining).toBe(9);

    const third = await createSession(row);
    await expect(
      verifySecondFactor(third, { kind: "recovery", code: plain }, { now }),
    ).rejects.toSatisfy((error) => code(error) === "TWO_FACTOR_INVALID_CODE");
    expect(await resolveStaffContext(third)).toEqual({
      ok: false,
      reason: "unverified",
    });

    const outbox = await testDb.notificationOutbox.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(outbox.map((item) => [item.kind, item.recipient])).toEqual([
      ["security.recovery_code_used", row.email],
      ["ops.alert", "owner@example.com"],
    ]);
    expect(JSON.stringify(outbox)).not.toContain(plain);
  });

  it("lets exactly one of concurrent requests consume the same recovery code", async () => {
    const now = new Date();
    const row = await createStaffUser("STAFF");
    const enrolled = await createSession(row);
    const { recoveryCodes } = await enrolAndVerify(enrolled, now);
    const [plain] = recoveryCodes;
    if (!plain) throw new Error("no recovery codes");
    const sessions = await Promise.all([
      createSession(row),
      createSession(row),
      createSession(row),
    ]);
    const results = await Promise.allSettled(
      sessions.map((session) =>
        verifySecondFactor(session, { kind: "recovery", code: plain }, { now }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await testDb.staffRecoveryCode.count({
        where: { userId: row.id, usedAt: null },
      }),
    ).toBe(9);
  });

  it("refreshes the session's verification time for re-authentication", async () => {
    const now = new Date();
    const { user, secretBase32 } = await verifiedStaff("STAFF", now);
    const later = minutesLater(now, 20);
    await verifySecondFactor(
      user,
      { kind: "totp", code: codeFor(secretBase32, later) },
      { now: later },
    );
    const resolved = await resolveStaffContext(user);
    expect(resolved.ok && resolved.ctx.verifiedAt).toEqual(later);
  });

  it("sends an unenrolled staff account to set-up rather than verifying", async () => {
    const user = await createSession(await createStaffUser("STAFF"));
    await expect(
      verifySecondFactor(user, { kind: "totp", code: "123456" }),
    ).rejects.toBeInstanceOf(StaffGateError);
  });
});

describe("promote-admin script (A9, §13)", () => {
  const local = "postgresql://u:p@localhost:5432/madhuyamini_test";

  it("promotes a verified account, revokes its sessions and audits the script", async () => {
    const row = await createStaffUser("CUSTOMER", "owner@example.com");
    await createSession(row);
    await createSession(row);
    const outcome = await promoteToAdmin(testDb, {
      email: " Owner@Example.com ",
      confirm: null,
      databaseUrl: local,
      siteEnv: "development",
      host: "test-host",
    });
    expect(outcome).toEqual({
      kind: "promoted",
      userId: row.id,
      sessionsRevoked: 2,
    });
    const user = await testDb.user.findUniqueOrThrow({ where: { id: row.id } });
    expect(user.role).toBe("ADMIN");
    expect(await testDb.session.count({ where: { userId: row.id } })).toBe(0);
    const audit = await testDb.adminAuditLog.findFirstOrThrow();
    expect(audit).toMatchObject({
      actorId: null,
      actorLabel: "script:promote-admin@test-host",
      action: "user.role.set",
      targetId: row.id,
      outcome: "SUCCESS",
      before: { id: row.id, role: "CUSTOMER" },
      after: { id: row.id, role: "ADMIN" },
    });

    const again = await promoteToAdmin(testDb, {
      email: "owner@example.com",
      confirm: null,
      databaseUrl: local,
      siteEnv: "development",
      host: "test-host",
    });
    expect(again).toEqual({ kind: "already_admin", userId: row.id });
  });

  it("refuses unknown or unverified accounts", async () => {
    await expect(
      promoteToAdmin(testDb, {
        email: "nobody@example.com",
        confirm: null,
        databaseUrl: local,
        siteEnv: "development",
        host: "h",
      }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    await testDb.user.create({
      data: { email: "new@example.com", name: "New", emailVerified: false },
    });
    await expect(
      promoteToAdmin(testDb, {
        email: "new@example.com",
        confirm: null,
        databaseUrl: local,
        siteEnv: "development",
        host: "h",
      }),
    ).rejects.toBeInstanceOf(PromoteError);
    expect(await testDb.user.count({ where: { role: "ADMIN" } })).toBe(0);
  });

  it("needs the typed confirmation for a remote database or production", async () => {
    const row = await createStaffUser("CUSTOMER", "owner@example.com");
    const remote = "postgresql://u:p@db.example.com:5432/madhuyamini";
    await expect(
      promoteToAdmin(testDb, {
        email: row.email,
        confirm: null,
        databaseUrl: remote,
        siteEnv: "development",
        host: "h",
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(
      promoteToAdmin(testDb, {
        email: row.email,
        confirm: null,
        databaseUrl: local,
        siteEnv: "production",
        host: "h",
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(
      promoteToAdmin(testDb, {
        email: row.email,
        confirm: "someone-else@example.com",
        databaseUrl: remote,
        siteEnv: "production",
        host: "h",
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    expect(await testDb.user.count({ where: { role: "ADMIN" } })).toBe(0);

    const outcome = await promoteToAdmin(testDb, {
      email: row.email,
      confirm: row.email,
      databaseUrl: remote,
      siteEnv: "production",
      host: "h",
    });
    expect(outcome.kind).toBe("promoted");
  });
});

describe("development staff seed", () => {
  it("creates nothing without SEED_ADMIN_PASSWORD", async () => {
    expect(await seedStaff(testDb, undefined)).toBe(0);
    expect(await testDb.user.count()).toBe(0);
  });

  it("creates the two labelled accounts with working credentials, idempotently", async () => {
    expect(await seedStaff(testDb, "development only")).toBe(2);
    expect(await seedStaff(testDb, "development only")).toBe(2);
    const users = await testDb.user.findMany({
      orderBy: { email: "asc" },
      include: { accounts: true },
    });
    expect(users.map((u) => [u.email, u.role, u.emailVerified])).toEqual([
      ["admin@example.com", "ADMIN", true],
      ["staff@example.com", "STAFF", true],
    ]);
    for (const user of users) {
      expect(user.accounts).toHaveLength(1);
      const account = user.accounts[0];
      expect(account?.providerId).toBe("credential");
      expect(account?.password).toBeTruthy();
      expect(account?.password).not.toContain("development only");
      expect(
        await verifyPassword({
          hash: account?.password ?? "",
          password: "development only",
        }),
      ).toBe(true);
    }
    // Seeded staff are not enrolled: the first sign-in sets up the second factor.
    expect(await testDb.staffTwoFactor.count()).toBe(0);
  });
});
