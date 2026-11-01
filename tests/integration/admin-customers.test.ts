import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ForbiddenCapabilityError,
  ReauthRequiredError,
} from "@/features/admin/authz";
import {
  CustomerError,
  getCustomerDetail,
  getCustomerList,
  issueGrant,
  revealCustomer,
  revokeGrant,
  setRole,
} from "@/features/admin/customers/service";
import { db } from "@/server/db";

import { createUser, resetDatabase, testDb } from "./db";
import { confirmedOnlineOrder } from "./order-fixtures";
import {
  createSession,
  createStaffUser,
  minutesLater,
  verifiedStaff,
} from "./staff";

/**
 * Customers (docs/admin.md §5.7, A11, A14, A15): masked by default, reveals
 * only under an active grant (or as ADMIN), revocation immediate, role
 * changes serialised and revoking everything the target held.
 */

beforeEach(resetDatabase);
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

async function customerWithAddress() {
  const user = await createUser("asha.devi@example.com");
  await testDb.user.update({
    where: { id: user.id },
    data: { phone: "+919876543210" },
  });
  await testDb.address.create({
    data: {
      userId: user.id,
      recipientName: "Asha Devi",
      phone: "+919876543210",
      line1: "12 Station Road",
      city: "Madhubani",
      state: "Bihar",
      postalCode: "847211",
      isDefault: true,
    },
  });
  return user;
}

describe("masking and search", () => {
  it("lists and shows customers masked, and searches by exact email, phone or order number", async () => {
    const staff = await verifiedStaff("STAFF");
    const customer = await customerWithAddress();
    const placed = await confirmedOnlineOrder({
      sku: "CUS-1",
      email: "bina@example.com",
    });

    const all = await getCustomerList(staff.ctx, {
      q: null,
      role: "CUSTOMER",
      page: 1,
    });
    const asha = all.items.find((i) => i.id === customer.id);
    expect(asha).toMatchObject({
      emailMasked: "a********@example.com",
      city: "Madhubani",
    });
    expect(asha?.phoneMasked).toMatch(/^\*+3210$/);

    expect(
      (
        await getCustomerList(staff.ctx, {
          q: "Asha.Devi@example.com",
          role: null,
          page: 1,
        })
      ).items.map((i) => i.id),
    ).toEqual([customer.id]);
    expect(
      (
        await getCustomerList(staff.ctx, {
          q: "98765 43210",
          role: null,
          page: 1,
        })
      ).items.map((i) => i.id),
    ).toEqual([customer.id]);
    expect(
      (
        await getCustomerList(staff.ctx, {
          q: placed.orderNumber,
          role: null,
          page: 1,
        })
      ).items.map((i) => i.id),
    ).toEqual([placed.userId]);
    // Partial email never matches.
    expect(
      (await getCustomerList(staff.ctx, { q: "asha@", role: null, page: 1 }))
        .total,
    ).toBe(0);

    const detail = await getCustomerDetail(staff.ctx, customer.id);
    expect(detail).toMatchObject({
      email: "a********@example.com",
      revealExpiresAt: null,
    });
    expect(detail?.phone).toMatch(/^\*+3210$/);
    expect(detail?.addresses[0]).toMatchObject({
      line1: null,
      city: "Madhubani",
      postalCode: "847211",
    });
    expect(detail?.can).toMatchObject({
      reveal: false,
      grant: false,
      setRole: false,
    });
  });
});

describe("grants and reveals", () => {
  it("lets STAFF reveal only under an active grant covering the fields, for a limited time, and revocation ends it at once", async () => {
    const now = new Date();
    const staff = await verifiedStaff("STAFF", now);
    const admin = await verifiedStaff("ADMIN", now);
    const customer = await customerWithAddress();

    await expect(
      revealCustomer(
        staff.ctx,
        customer.id,
        { fields: ["email"], reason: "Support call." },
        now,
      ),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_GRANT" });
    expect(
      await testDb.adminAuditLog.count({
        where: { action: "customer.pii.reveal", outcome: "REFUSED" },
      }),
    ).toBe(1);

    await expect(
      issueGrant(
        staff.ctx,
        {
          granteeId: staff.user.id,
          customerId: customer.id,
          fields: ["email"],
          hours: 2,
          reason: "x",
        },
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    await expect(
      issueGrant(
        admin.ctx,
        {
          granteeId: customer.id,
          customerId: customer.id,
          fields: ["email"],
          hours: 2,
          reason: "x",
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "GRANTEE_NOT_STAFF" });
    const grant = await issueGrant(
      admin.ctx,
      {
        granteeId: staff.user.id,
        customerId: customer.id,
        fields: ["email", "address"],
        hours: 2,
        reason: "Delivery query.",
      },
      now,
    );
    const stored = await testDb.staffPiiGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(stored.expiresAt.getTime() - now.getTime()).toBe(2 * 60 * 60 * 1000);
    expect(
      await testDb.notificationOutbox.count({ where: { kind: "ops.alert" } }),
    ).toBe(1);

    // Phone is not in the grant.
    await expect(
      revealCustomer(
        staff.ctx,
        customer.id,
        { fields: ["email", "phone"], reason: "Call back." },
        now,
      ),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_GRANT" });
    const reveal = await revealCustomer(
      staff.ctx,
      customer.id,
      { fields: ["email", "address"], reason: "Delivery query." },
      now,
    );
    expect(reveal.expiresAt.getTime() - now.getTime()).toBe(10 * 60 * 1000);
    const detail = await getCustomerDetail(staff.ctx, customer.id, now);
    expect(detail?.email).toBe("asha.devi@example.com");
    expect(detail?.addresses[0]?.line1).toBe("12 Station Road");
    expect(detail?.phone).toMatch(/^\*+3210$/);
    expect([...(detail?.revealed ?? [])].sort()).toEqual(["address", "email"]);
    const revealAudit = await testDb.adminAuditLog.findFirstOrThrow({
      where: { action: "customer.pii.reveal", outcome: "SUCCESS" },
    });
    expect(revealAudit.grantId).toBe(grant.id);

    // Another staff member sees nothing.
    const other = await verifiedStaff("STAFF", now);
    expect((await getCustomerDetail(other.ctx, customer.id, now))?.email).toBe(
      "a********@example.com",
    );

    // After the reveal window, masked again without any action.
    expect(
      (await getCustomerDetail(staff.ctx, customer.id, minutesLater(now, 11)))
        ?.email,
    ).toBe("a********@example.com");

    // Revoking the grant ends a live reveal immediately.
    await revealCustomer(
      staff.ctx,
      customer.id,
      { fields: ["email"], reason: "Again." },
      now,
    );
    expect((await getCustomerDetail(staff.ctx, customer.id, now))?.email).toBe(
      "asha.devi@example.com",
    );
    await revokeGrant(admin.ctx, grant.id, "Shift over.", now);
    expect((await getCustomerDetail(staff.ctx, customer.id, now))?.email).toBe(
      "a********@example.com",
    );
    await expect(
      revealCustomer(
        staff.ctx,
        customer.id,
        { fields: ["email"], reason: "Once more." },
        now,
      ),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_GRANT" });

    // ADMIN reveals on their own permission, with no grant id.
    await revealCustomer(
      admin.ctx,
      customer.id,
      { fields: ["phone"], reason: "Fraud check." },
      now,
    );
    expect((await getCustomerDetail(admin.ctx, customer.id, now))?.phone).toBe(
      "+919876543210",
    );
    const adminReveal = await testDb.staffPiiReveal.findFirstOrThrow({
      where: { staffId: admin.user.id },
    });
    expect(adminReveal.grantId).toBeNull();
  });

  it("supports shift-wide grants and the SQL ceiling of 24 hours", async () => {
    const now = new Date();
    const staff = await verifiedStaff("STAFF", now);
    const admin = await verifiedStaff("ADMIN", now);
    const customer = await customerWithAddress();
    const grant = await issueGrant(
      admin.ctx,
      {
        granteeId: staff.user.id,
        customerId: null,
        fields: ["phone"],
        hours: 48,
        reason: "Shift.",
      },
      now,
    );
    const stored = await testDb.staffPiiGrant.findUniqueOrThrow({
      where: { id: grant.id },
    });
    expect(stored.expiresAt.getTime() - now.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
    await revealCustomer(
      staff.ctx,
      customer.id,
      { fields: ["phone"], reason: "Shift call." },
      now,
    );
    expect((await getCustomerDetail(staff.ctx, customer.id, now))?.phone).toBe(
      "+919876543210",
    );
    await expect(
      testDb.staffPiiGrant.create({
        data: {
          granteeId: staff.user.id,
          grantedById: admin.user.id,
          fields: ["email"],
          reason: "too long",
          expiresAt: minutesLater(now, 25 * 60),
          createdAt: now,
        },
      }),
    ).rejects.toThrow(/staff_pii_grants_window|check constraint/);
  });
});

describe("role changes (A11)", () => {
  it("is ADMIN with re-auth, needs the typed email, revokes sessions, verifications and grants, and protects the last admin", async () => {
    const now = new Date();
    const admin = await verifiedStaff("ADMIN", now);
    const staff = await verifiedStaff("STAFF", now);
    const customerRow = await createStaffUser(
      "CUSTOMER",
      "promote@example.com",
    );
    await createSession(customerRow);
    await issueGrant(
      admin.ctx,
      {
        granteeId: staff.user.id,
        customerId: null,
        fields: ["email"],
        hours: 1,
        reason: "Shift.",
      },
      now,
    );

    await expect(
      setRole(
        staff.ctx,
        customerRow.id,
        { role: "STAFF", reason: "Joining.", confirmEmail: customerRow.email },
        now,
      ),
    ).rejects.toBeInstanceOf(ForbiddenCapabilityError);
    await expect(
      setRole(
        admin.ctx,
        customerRow.id,
        { role: "STAFF", reason: "Joining.", confirmEmail: customerRow.email },
        minutesLater(now, 15),
      ),
    ).rejects.toBeInstanceOf(ReauthRequiredError);
    await expect(
      setRole(
        admin.ctx,
        customerRow.id,
        {
          role: "STAFF",
          reason: "Joining.",
          confirmEmail: "wrong@example.com",
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    await expect(
      setRole(
        admin.ctx,
        admin.user.id,
        { role: "STAFF", reason: "Oops.", confirmEmail: admin.user.email },
        now,
      ),
    ).rejects.toMatchObject({ code: "ROLE_SELF" });

    await setRole(
      admin.ctx,
      customerRow.id,
      {
        role: "STAFF",
        reason: "Joining the team.",
        confirmEmail: " Promote@Example.com ",
      },
      now,
    );
    expect(
      (await testDb.user.findUniqueOrThrow({ where: { id: customerRow.id } }))
        .role,
    ).toBe("STAFF");
    expect(
      await testDb.session.count({ where: { userId: customerRow.id } }),
    ).toBe(0);

    // Demoting staff revokes their verification, grants and second factor.
    await setRole(
      admin.ctx,
      staff.user.id,
      { role: "CUSTOMER", reason: "Left.", confirmEmail: staff.user.email },
      now,
    );
    expect(
      await testDb.session.count({ where: { userId: staff.user.id } }),
    ).toBe(0);
    expect(
      await testDb.staffSessionVerification.count({
        where: { userId: staff.user.id },
      }),
    ).toBe(0);
    expect(
      await testDb.staffTwoFactor.count({ where: { userId: staff.user.id } }),
    ).toBe(0);
    const grants = await testDb.staffPiiGrant.findMany({
      where: { granteeId: staff.user.id },
    });
    expect(grants.every((g) => g.revokedAt !== null)).toBe(true);
    expect(
      await testDb.notificationOutbox.count({ where: { kind: "ops.alert" } }),
    ).toBeGreaterThanOrEqual(3);

    // The only admin cannot be demoted, even by another admin.
    const second = await verifiedStaff("ADMIN", now);
    await setRole(
      second.ctx,
      admin.user.id,
      { role: "STAFF", reason: "Rotation.", confirmEmail: admin.user.email },
      now,
    );
    await expect(
      setRole(
        admin.ctx,
        second.user.id,
        { role: "CUSTOMER", reason: "x", confirmEmail: second.user.email },
        now,
      ),
    ).rejects.toThrow();
    const demotedAdminCtx = admin.ctx;
    await expect(
      setRole(
        demotedAdminCtx,
        second.user.id,
        { role: "CUSTOMER", reason: "x", confirmEmail: second.user.email },
        now,
      ),
    ).rejects.toThrow();
    expect(
      (await testDb.user.findUniqueOrThrow({ where: { id: second.user.id } }))
        .role,
    ).toBe("ADMIN");
    expect(new CustomerError("x").status).toBe(409);
  });
});
