import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { hashRequestIp, runAudited, writeAudit } from "@/features/admin/audit";
import {
  ForbiddenCapabilityError,
  ReauthRequiredError,
  requirePermission,
} from "@/features/admin/authz";
import {
  beginEnrolment,
  confirmEnrolment,
} from "@/features/admin/security/service";
import {
  StaffGateError,
  assertLiveStaffContext,
  resolveStaffContext,
} from "@/server/auth/staff";
import type { StaffContext } from "@/server/auth/staff";
import { AppError } from "@/server/errors";

import { resetDatabase, testDb } from "./db";
import {
  STAFF_PASSWORD,
  codeFor,
  createSession,
  createStaffUser,
  enrolAndVerify,
  minutesLater,
  verifiedStaff,
} from "./staff";

/**
 * The mandatory staff gate (docs/admin.md §6, refinement 6), the audit
 * atomicity rules and the database-level protections of A13: triggers and
 * the runtime role's privileges, exercised as that role.
 */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

/** Audit rows other than the enrolment's own `security.*` entries. */
const auditRows = () =>
  testDb.adminAuditLog.findMany({
    where: { NOT: { action: { startsWith: "security." } } },
    orderBy: { createdAt: "asc" },
  });

describe("StaffContext resolution", () => {
  it("walks anonymous → forbidden → not enrolled → unverified → ok", async () => {
    expect(await resolveStaffContext(null)).toEqual({
      ok: false,
      reason: "anonymous",
    });

    const customer = await createSession(await createStaffUser("CUSTOMER"));
    expect(await resolveStaffContext(customer)).toEqual({
      ok: false,
      reason: "forbidden",
    });

    const staffRow = await createStaffUser("STAFF");
    const staff = await createSession(staffRow);
    expect(await resolveStaffContext(staff)).toEqual({
      ok: false,
      reason: "not_enrolled",
    });

    // A pending enrolment is not an enrolment.
    const now = new Date();
    const start = await beginEnrolment(staff, STAFF_PASSWORD, now);
    expect(await resolveStaffContext(staff)).toEqual({
      ok: false,
      reason: "not_enrolled",
    });

    await confirmEnrolment(staff, codeFor(start.secretBase32, now), now);
    const resolved = await resolveStaffContext(staff);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.ctx.role).toBe("STAFF");
      expect(resolved.ctx.sessionId).toBe(staff.session.id);
      expect(resolved.ctx.verifiedAt).toEqual(now);
    }

    // Every session passes the factor on its own.
    const second = await createSession(staffRow);
    expect(await resolveStaffContext(second)).toEqual({
      ok: false,
      reason: "unverified",
    });
  });

  it("rejects a forged context and one whose backing rows changed", async () => {
    const customer = await createSession(await createStaffUser("CUSTOMER"));
    const forged = {
      user: customer,
      role: "ADMIN",
      sessionId: customer.session.id,
      verifiedAt: new Date(),
    } as unknown as StaffContext;
    await expect(assertLiveStaffContext(forged)).rejects.toMatchObject({
      reason: "forbidden",
    });
    await expect(
      requirePermission(forged, "admin.view"),
    ).rejects.toBeInstanceOf(StaffGateError);

    const { user, ctx } = await verifiedStaff("STAFF");
    await expect(assertLiveStaffContext(ctx)).resolves.toBeUndefined();

    // Session verification revoked (for example by a role change).
    await testDb.staffSessionVerification.delete({
      where: { sessionId: user.session.id },
    });
    await expect(assertLiveStaffContext(ctx)).rejects.toMatchObject({
      reason: "unverified",
    });

    // Second factor reset.
    await testDb.staffTwoFactor.delete({ where: { userId: user.id } });
    await expect(assertLiveStaffContext(ctx)).rejects.toMatchObject({
      reason: "not_enrolled",
    });

    // Demoted.
    await testDb.user.update({
      where: { id: user.id },
      data: { role: "CUSTOMER" },
    });
    await expect(assertLiveStaffContext(ctx)).rejects.toMatchObject({
      reason: "forbidden",
    });
  });

  it("binds the context to its own session: another user's session does not count", async () => {
    const { ctx } = await verifiedStaff("STAFF");
    const other = await verifiedStaff("STAFF");
    const crossed = { ...ctx, sessionId: other.ctx.sessionId } as StaffContext;
    await expect(assertLiveStaffContext(crossed)).rejects.toMatchObject({
      reason: "unverified",
    });
  });
});

describe("requirePermission", () => {
  it("applies the role matrix", async () => {
    const staff = await verifiedStaff("STAFF");
    await expect(
      requirePermission(staff.ctx, "orders.fulfil"),
    ).resolves.toBeUndefined();
    await expect(
      requirePermission(staff.ctx, "payments.refund"),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    await expect(
      requirePermission(staff.ctx, "customers.set_role"),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);

    const admin = await verifiedStaff("ADMIN");
    await expect(
      requirePermission(admin.ctx, "payments.refund"),
    ).resolves.toBeUndefined();
  });

  it("asks for re-authentication on sensitive capabilities after the window", async () => {
    const now = new Date();
    const admin = await verifiedStaff("ADMIN", now);
    await expect(
      requirePermission(admin.ctx, "payments.refund", {
        now: minutesLater(now, 9),
      }),
    ).resolves.toBeUndefined();
    await expect(
      requirePermission(admin.ctx, "payments.refund", {
        now: minutesLater(now, 11),
      }),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
    // Routine capabilities never re-prompt.
    await expect(
      requirePermission(admin.ctx, "orders.fulfil", {
        now: minutesLater(now, 60),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("runAudited", () => {
  it("commits the SUCCESS row with the change, with redacted snapshots", async () => {
    const admin = await verifiedStaff("ADMIN");
    const id = await runAudited(
      {
        ctx: admin.ctx,
        action: "category.create",
        targetType: "category",
        capability: "catalogue.edit",
        reason: "new range",
      },
      async (tx, audit) => {
        const created = await tx.category.create({
          data: { slug: "saris", name: "Saris" },
          select: { id: true, slug: true, name: true, parentId: true },
        });
        expect(audit.id).toBeTruthy();
        return {
          result: created.id,
          targetId: created.id,
          after: { ...created, secret: "never" },
        };
      },
    );
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: admin.user.id,
      actorLabel: `user:${admin.user.id}`,
      actorRole: "ADMIN",
      sessionId: admin.user.session.id,
      action: "category.create",
      targetType: "category",
      targetId: id,
      outcome: "SUCCESS",
      reason: "new range",
      after: { id, slug: "saris", name: "Saris", parentId: null },
    });
    expect(JSON.stringify(rows[0]?.after)).not.toContain("never");
  });

  it("rolls the change back and records FAILED separately when the work throws", async () => {
    const admin = await verifiedStaff("ADMIN");
    await expect(
      runAudited(
        {
          ctx: admin.ctx,
          action: "category.create",
          targetType: "category",
          capability: "catalogue.edit",
        },
        async (tx) => {
          await tx.category.create({ data: { slug: "lost", name: "Lost" } });
          throw new AppError("Nope", { code: "TEST_FAILURE", status: 409 });
        },
      ),
    ).rejects.toMatchObject({ code: "TEST_FAILURE" });
    expect(await testDb.category.count()).toBe(0);
    const rows = await auditRows();
    expect(rows.map((row) => row.outcome)).toEqual(["FAILED"]);
    expect(rows[0]?.errorCode).toBe("TEST_FAILURE");
  });

  it("records REFUSED without running the work when the actor lacks the capability", async () => {
    const staff = await verifiedStaff("STAFF");
    let ran = false;
    await expect(
      runAudited(
        {
          ctx: staff.ctx,
          action: "user.role.set",
          targetType: "user",
          targetId: staff.user.id,
          capability: "customers.set_role",
        },
        async () => {
          ran = true;
          return { result: undefined };
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    expect(ran).toBe(false);
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "REFUSED",
      errorCode: "ADMIN_FORBIDDEN",
      action: "user.role.set",
      targetId: staff.user.id,
    });
  });

  it("records REFUSED when a sensitive action needs re-authentication", async () => {
    const now = new Date();
    const admin = await verifiedStaff("ADMIN", now);
    await expect(
      runAudited(
        {
          ctx: admin.ctx,
          action: "refund.create",
          targetType: "refund",
          capability: "payments.refund",
          now: minutesLater(now, 30),
        },
        async () => ({ result: undefined }),
      ),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
    const rows = await auditRows();
    expect(rows.map((row) => [row.outcome, row.errorCode])).toEqual([
      ["REFUSED", "ADMIN_REAUTH_REQUIRED"],
    ]);
  });
});

describe("audit log protection (A13)", () => {
  it("is append-only for the table owner through the trigger", async () => {
    const { ctx } = await verifiedStaff("ADMIN");
    const { id } = await writeAudit({
      actor: {
        actorId: ctx.user.id,
        actorLabel: `user:${ctx.user.id}`,
        actorRole: "ADMIN",
        sessionId: ctx.sessionId,
      },
      action: "test",
      targetType: "order",
      outcome: "SUCCESS",
    });
    await expect(
      testDb.adminAuditLog.update({
        where: { id },
        data: { action: "tampered" },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      testDb.adminAuditLog.delete({ where: { id } }),
    ).rejects.toThrow(/append-only/);
    expect(await auditRows()).toHaveLength(1);
  });

  it("denies UPDATE, DELETE and TRUNCATE to the runtime role (actual privileges)", async () => {
    const roles = await testDb.$queryRaw<Array<{ rolname: string }>>`
      SELECT rolname FROM pg_roles WHERE rolname = 'madhuyamini_app'
    `;
    expect(
      roles,
      "run scripts/provision-db-roles.sql against the test database",
    ).toHaveLength(1);

    const asApp = <T>(
      work: (
        tx: Parameters<Parameters<typeof testDb.$transaction>[0]>[0],
      ) => Promise<T>,
    ) =>
      testDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE madhuyamini_app");
        return work(tx);
      });

    // The role can read and append.
    await asApp(async (tx) => {
      await tx.adminAuditLog.create({
        data: {
          actorLabel: "system:test",
          action: "test",
          targetType: "order",
          outcome: "SUCCESS",
        },
      });
      await tx.orderEvent.count();
      await tx.inventoryAdjustment.count();
    });
    const row = await testDb.adminAuditLog.findFirstOrThrow({
      where: { actorLabel: "system:test" },
    });

    // It cannot change history, whether the trigger exists or not.
    for (const table of [
      "admin_audit_log",
      "inventory_adjustments",
      "order_events",
    ]) {
      await expect(
        asApp((tx) =>
          tx.$executeRawUnsafe(`UPDATE ${table} SET created_at = now()`),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asApp((tx) => tx.$executeRawUnsafe(`DELETE FROM ${table}`)),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asApp((tx) => tx.$executeRawUnsafe(`TRUNCATE ${table}`)),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      asApp((tx) => tx.$executeRawUnsafe("DELETE FROM _prisma_migrations")),
    ).rejects.toThrow(/permission denied/);

    // Ordinary tables stay writable for the application.
    const user = await createStaffUser("CUSTOMER");
    await asApp((tx) =>
      tx.user.update({ where: { id: user.id }, data: { name: "Renamed" } }),
    );
    expect(await auditRows()).toHaveLength(1);
    expect(row.action).toBe("test");
  });
});

describe("last-admin protection (trigger)", () => {
  it("refuses to demote or delete the only ADMIN, and allows it once another exists", async () => {
    const first = await createStaffUser("ADMIN");
    await expect(
      testDb.user.update({
        where: { id: first.id },
        data: { role: "STAFF" },
      }),
    ).rejects.toThrow(/at least one ADMIN must remain/);
    await expect(
      testDb.user.delete({ where: { id: first.id } }),
    ).rejects.toThrow(/at least one ADMIN must remain/);

    const second = await createStaffUser("ADMIN");
    await testDb.user.update({
      where: { id: first.id },
      data: { role: "STAFF" },
    });
    await expect(
      testDb.user.delete({ where: { id: second.id } }),
    ).rejects.toThrow(/at least one ADMIN must remain/);
    expect(await testDb.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("holds under concurrent demotions: at most one of two admins can step down", async () => {
    const a = await createStaffUser("ADMIN");
    const b = await createStaffUser("ADMIN");
    const results = await Promise.allSettled([
      testDb.user.update({ where: { id: a.id }, data: { role: "STAFF" } }),
      testDb.user.update({ where: { id: b.id }, data: { role: "STAFF" } }),
    ]);
    expect(
      await testDb.user.count({ where: { role: "ADMIN" } }),
    ).toBeGreaterThanOrEqual(1);
    expect(
      results.filter((r) => r.status === "fulfilled").length,
    ).toBeLessThanOrEqual(1);
  });
});

describe("enrolment keeps the gate closed for other sessions", () => {
  it("verifies only the session that confirmed the code", async () => {
    const row = await createStaffUser("ADMIN");
    const a = await createSession(row);
    const b = await createSession(row);
    await enrolAndVerify(a);
    expect((await resolveStaffContext(a)).ok).toBe(true);
    expect(await resolveStaffContext(b)).toEqual({
      ok: false,
      reason: "unverified",
    });
  });
});

describe("audit regressions", () => {
  it("records a REFUSED row even for a forged context whose actor the database does not know", async () => {
    const forged = {
      user: {
        id: "00000000-0000-7000-8000-00000000f0f0",
        email: "ghost@example.com",
        emailVerified: true,
        name: "Ghost",
        phone: null,
        role: "ADMIN",
        session: {
          id: "00000000-0000-7000-8000-00000000f0f1",
          token: "x",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      },
      role: "ADMIN",
      sessionId: "00000000-0000-7000-8000-00000000f0f1",
      verifiedAt: new Date(),
    } as unknown as StaffContext;
    await expect(
      runAudited(
        {
          ctx: forged,
          action: "category.create",
          targetType: "category",
          capability: "catalogue.edit",
        },
        async () => ({ result: undefined }),
      ),
    ).rejects.toBeInstanceOf(StaffGateError);
    const rows = await testDb.adminAuditLog.findMany({
      where: { action: "category.create" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      outcome: "REFUSED",
      actorId: null,
      actorLabel: "unverified:00000000-0000-7000-8000-00000000f0f0",
      errorCode: "STAFF_FORBIDDEN",
    });
    expect(await testDb.category.count()).toBe(0);
  });

  it("hashes request addresses with a key, not a bare digest", async () => {
    const { createHash } = await import("node:crypto");
    const hashed = hashRequestIp("203.0.113.9");
    expect(hashed).toHaveLength(24);
    expect(hashed).toBe(hashRequestIp("203.0.113.9"));
    expect(hashed).not.toBe(
      createHash("sha256")
        .update("203.0.113.9")
        .digest("base64url")
        .slice(0, 24),
    );
    expect(hashRequestIp(null)).toBeNull();
  });
});
