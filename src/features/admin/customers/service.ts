import "server-only";

import { headers } from "next/headers";

import { getAdminPolicy, hoursToMs } from "@/config/admin-policy";
import { minutesToMs } from "@/config/checkout-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/generated/prisma/enums";
import { orderStatusLabels } from "@/features/orders/types";
import { auth } from "@/server/auth/auth";
import {
  RateLimitedError,
  authRateLimits,
  consumeRateLimit,
  rateLimitKey,
} from "@/server/auth/rate-limit";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";
import { AppError, NotFoundError } from "@/server/errors";
import { enqueueOpsAlert } from "@/server/notifications/outbox";
import { routes } from "@/lib/routes";

import {
  actorFromContext,
  runAudited,
  runAuditedExternal,
  writeAudit,
} from "../audit";
import { requirePermission } from "../authz";
import { enforceActorLimit } from "../limits";
import { maskEmail, maskPhone } from "../redact";
import { resetTwoFactor } from "../security/service";
import {
  findCustomer,
  listCustomers,
  listGrantsForCustomer,
  listRevealsForCustomer,
  listStaffUsers,
} from "./data";
import { findActiveGrants, findLiveReveals } from "./grant-queries";
import type {
  CustomerFilters,
  CustomerListRow,
  GrantRow,
  RevealRow,
} from "./data";
import type { PiiField } from "./schemas";

/**
 * Customers (docs/admin.md §5.7, A8, A11, A12): masked by default; reveals
 * need an ADMIN-issued, scoped, time-limited grant (or ADMIN's own
 * permission), are time-boxed, re-checked on every render and end the
 * moment the grant is revoked. Role changes revoke everything the target
 * held, under an advisory lock, and never demote the last ADMIN.
 */

type Tx = Prisma.TransactionClient;

export class CustomerError extends AppError {
  constructor(message: string, code = "CUSTOMER_NOT_ALLOWED", status = 409) {
    super(message, { code, status });
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface CustomerListItem {
  readonly id: string;
  readonly name: string;
  readonly emailMasked: string;
  readonly phoneMasked: string | null;
  readonly role: UserRole;
  readonly emailVerified: boolean;
  readonly orderCount: number;
  readonly city: string | null;
  readonly joinedAt: Date;
}

function toListItem(row: CustomerListRow): CustomerListItem {
  return {
    id: row.id,
    name: row.name,
    emailMasked: maskEmail(row.email),
    phoneMasked: row.phone ? maskPhone(row.phone) : null,
    role: row.role,
    emailVerified: row.emailVerified,
    orderCount: row._count.orders,
    city: row.addresses[0]?.city ?? null,
    joinedAt: row.createdAt,
  };
}

export async function getCustomerList(
  ctx: StaffContext,
  filters: CustomerFilters,
): Promise<{
  items: CustomerListItem[];
  total: number;
  page: number;
  pageCount: number;
}> {
  const result = await listCustomers(ctx, filters);
  return { ...result, items: result.rows.map(toListItem) };
}

export interface CustomerDetail {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly role: UserRole;
  readonly emailVerified: boolean;
  readonly joinedAt: Date;
  readonly sessionCount: number;
  readonly staffEnrolled: boolean;
  /** Which fields are currently shown unmasked to this viewer, and until when. */
  readonly revealed: ReadonlySet<PiiField>;
  readonly revealExpiresAt: Date | null;
  readonly addresses: ReadonlyArray<{
    readonly id: string;
    readonly label: string | null;
    readonly recipientName: string;
    readonly line1: string | null;
    readonly line2: string | null;
    readonly landmark: string | null;
    readonly city: string;
    readonly state: string;
    readonly postalCode: string;
    readonly isDefault: boolean;
  }>;
  readonly orders: ReadonlyArray<{
    readonly id: string;
    readonly orderNumber: string;
    readonly status: string;
    readonly statusLabel: string;
    readonly totalInPaise: number;
    readonly placedAt: Date;
  }>;
  readonly grants: ReadonlyArray<GrantView>;
  readonly reveals: ReadonlyArray<RevealView>;
  readonly viewerGrantedFields: ReadonlySet<PiiField>;
  readonly can: {
    readonly reveal: boolean;
    readonly grant: boolean;
    readonly setRole: boolean;
    readonly resetTwoFactor: boolean;
    readonly resendVerification: boolean;
  };
}

export interface GrantView {
  readonly id: string;
  readonly granteeName: string;
  readonly granteeEmailMasked: string;
  readonly grantedByName: string;
  readonly scope: "this customer" | "any customer";
  readonly fields: readonly string[];
  readonly reason: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly active: boolean;
}

export interface RevealView {
  readonly id: string;
  readonly staffName: string;
  readonly fields: readonly string[];
  readonly reason: string;
  readonly at: Date;
  readonly expiresAt: Date;
  readonly viaGrant: boolean;
}

function toGrantView(row: GrantRow, now: Date): GrantView {
  return {
    id: row.id,
    granteeName: row.grantee.name,
    granteeEmailMasked: maskEmail(row.grantee.email),
    grantedByName: row.grantedBy.name,
    scope: row.customerId ? "this customer" : "any customer",
    fields: row.fields,
    reason: row.reason,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    active: row.revokedAt === null && row.expiresAt > now,
  };
}

function toRevealView(row: RevealRow): RevealView {
  return {
    id: row.id,
    staffName: row.staff.name,
    fields: row.fields,
    reason: row.reason,
    at: row.createdAt,
    expiresAt: row.expiresAt,
    viaGrant: row.grantId !== null,
  };
}

/**
 * What this viewer may see unmasked right now: their unexpired reveals
 * whose grant (if any) is still active. Nothing is cached.
 */
async function liveRevealedFields(
  tx: Tx,
  ctx: StaffContext,
  customerId: string,
  now: Date,
): Promise<{ fields: Set<PiiField>; expiresAt: Date | null }> {
  const reveals = await findLiveReveals(tx, ctx.user.id, customerId, now);
  const fields = new Set<PiiField>();
  let expiresAt: Date | null = null;
  for (const reveal of reveals) {
    if (reveal.grantId) {
      const grant = await tx.staffPiiGrant.findFirst({
        where: { id: reveal.grantId, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true },
      });
      if (!grant) continue;
    } else if (ctx.role !== "ADMIN") {
      continue;
    }
    for (const field of reveal.fields) fields.add(field as PiiField);
    const until = await tx.staffPiiReveal.findUnique({
      where: { id: reveal.id },
      select: { expiresAt: true },
    });
    if (until && (!expiresAt || until.expiresAt > expiresAt))
      expiresAt = until.expiresAt;
  }
  return { fields, expiresAt };
}

export async function getCustomerDetail(
  ctx: StaffContext,
  userId: string,
  now = new Date(),
): Promise<CustomerDetail | null> {
  const row = await findCustomer(ctx, userId);
  if (!row) return null;
  const [grants, reveals, live, viewerGrants] = await Promise.all([
    listGrantsForCustomer(ctx, userId),
    listRevealsForCustomer(ctx, userId),
    liveRevealedFields(db, ctx, userId, now),
    findActiveGrants(db, ctx.user.id, userId, now),
  ]);
  const granted = new Set<PiiField>();
  if (ctx.role === "ADMIN")
    for (const field of getAdminPolicy().pii.fields) granted.add(field);
  for (const grant of viewerGrants)
    for (const field of grant.fields) granted.add(field as PiiField);
  const showEmail = live.fields.has("email");
  const showPhone = live.fields.has("phone");
  const showAddress = live.fields.has("address");
  return {
    id: row.id,
    name: row.name,
    email: showEmail ? row.email : maskEmail(row.email),
    phone: row.phone ? (showPhone ? row.phone : maskPhone(row.phone)) : null,
    role: row.role,
    emailVerified: row.emailVerified,
    joinedAt: row.createdAt,
    sessionCount: row._count.sessions,
    staffEnrolled:
      row.staffTwoFactor?.enabledAt !== null && row.staffTwoFactor !== null,
    revealed: live.fields,
    revealExpiresAt: live.expiresAt,
    addresses: row.addresses.map((address) => ({
      id: address.id,
      label: address.label,
      recipientName: address.recipientName,
      line1: showAddress ? address.line1 : null,
      line2: showAddress ? address.line2 : null,
      landmark: showAddress ? address.landmark : null,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      isDefault: address.isDefault,
    })),
    orders: row.orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      statusLabel: orderStatusLabels[order.status],
      totalInPaise: order.totalInPaise,
      placedAt: order.createdAt,
    })),
    grants: grants.map((grant) => toGrantView(grant, now)),
    reveals: reveals.map(toRevealView),
    viewerGrantedFields: granted,
    can: {
      reveal: granted.size > 0,
      grant: ctx.role === "ADMIN",
      setRole: ctx.role === "ADMIN" && row.id !== ctx.user.id,
      resetTwoFactor:
        ctx.role === "ADMIN" &&
        row.role !== "CUSTOMER" &&
        row.id !== ctx.user.id,
      resendVerification: !row.emailVerified,
    },
  };
}

export async function getStaffDirectory(ctx: StaffContext) {
  return listStaffUsers(ctx);
}

// ---------------------------------------------------------------------------
// Grants (A14) and reveals (A15)
// ---------------------------------------------------------------------------

export interface GrantInput {
  readonly granteeId: string;
  readonly customerId: string | null;
  readonly fields: readonly PiiField[];
  readonly hours: number;
  readonly reason: string;
}

export async function issueGrant(
  ctx: StaffContext,
  input: GrantInput,
  now = new Date(),
): Promise<{ id: string }> {
  const policy = getAdminPolicy().pii;
  await enforceActorLimit(ctx, "grant", getAdminPolicy().limits.grantPerActor, {
    action: "customer.pii.grant",
    targetType: "grant",
  });
  return runAudited(
    {
      ctx,
      action: "customer.pii.grant",
      targetType: "grant",
      capability: "customers.grant",
      reason: input.reason,
      now,
    },
    async (tx) => {
      const grantee = await tx.user.findUnique({
        where: { id: input.granteeId },
        select: { id: true, role: true, name: true },
      });
      if (!grantee || grantee.role === "CUSTOMER") {
        throw new CustomerError(
          "Grants go to staff accounts only.",
          "GRANTEE_NOT_STAFF",
        );
      }
      if (input.customerId) {
        const customer = await tx.user.findUnique({
          where: { id: input.customerId },
          select: { id: true },
        });
        if (!customer) throw new NotFoundError("Customer");
      }
      const hours = Math.min(input.hours, policy.grantMaxHours);
      const grant = await tx.staffPiiGrant.create({
        data: {
          granteeId: input.granteeId,
          grantedById: ctx.user.id,
          customerId: input.customerId,
          fields: [...new Set(input.fields)],
          reason: input.reason,
          expiresAt: new Date(now.getTime() + hoursToMs(hours)),
          createdAt: now,
        },
        select: {
          id: true,
          granteeId: true,
          customerId: true,
          fields: true,
          expiresAt: true,
          revokedAt: true,
        },
      });
      await enqueueOpsAlert(tx, {
        key: `pii-grant:${grant.id}`,
        orderId: null,
        payload: {
          reason: `Customer-data grant issued to ${grantee.name}`,
          fields: grant.fields.join(", "),
          scope: input.customerId ? "one customer" : "any customer",
          hours,
          grantReason: input.reason,
        },
      });
      return { result: { id: grant.id }, targetId: grant.id, after: grant };
    },
  );
}

export async function revokeGrant(
  ctx: StaffContext,
  grantId: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  await runAudited(
    {
      ctx,
      action: "customer.pii.revoke",
      targetType: "grant",
      targetId: grantId,
      capability: "customers.grant",
      reason,
      grantId,
      now,
    },
    async (tx) => {
      const grant = await tx.staffPiiGrant.findUnique({
        where: { id: grantId },
        select: {
          id: true,
          granteeId: true,
          customerId: true,
          fields: true,
          expiresAt: true,
          revokedAt: true,
        },
      });
      if (!grant) throw new NotFoundError("Grant");
      if (grant.revokedAt) throw new CustomerError("Already revoked.");
      const after = await tx.staffPiiGrant.update({
        where: { id: grantId },
        data: { revokedAt: now, revokedById: ctx.user.id },
        select: {
          id: true,
          granteeId: true,
          customerId: true,
          fields: true,
          expiresAt: true,
          revokedAt: true,
        },
      });
      // Reveals that leaned on this grant end now: every render re-reads the
      // grant (liveRevealedFields), so nothing further needs rewriting.
      return { result: undefined, before: grant, after };
    },
  );
}

export async function revealCustomer(
  ctx: StaffContext,
  customerId: string,
  input: { readonly fields: readonly PiiField[]; readonly reason: string },
  now = new Date(),
): Promise<{ id: string; expiresAt: Date }> {
  await requirePermission(ctx, "customers.view", { now });
  await enforceActorLimit(
    ctx,
    "reveal",
    getAdminPolicy().limits.revealPerActor,
    {
      action: "customer.pii.reveal",
      targetType: "user",
      targetId: customerId,
    },
  );
  const fields = [...new Set(input.fields)];
  // ADMIN reveals on their own permission; STAFF need an active grant that covers every field.
  let grantId: string | null = null;
  if (ctx.role === "ADMIN") {
    await requirePermission(ctx, "customers.reveal", { now });
  } else {
    const grants = await findActiveGrants(db, ctx.user.id, customerId, now);
    const covering = grants.find((grant) =>
      fields.every((field) => grant.fields.includes(field)),
    );
    if (!covering) {
      await writeAudit({
        actor: actorFromContext(ctx),
        action: "customer.pii.reveal",
        targetType: "user",
        targetId: customerId,
        outcome: "REFUSED",
        errorCode: "NO_ACTIVE_GRANT",
        reason: input.reason,
      });
      throw new CustomerError(
        "You do not hold an active grant covering those fields for this customer.",
        "NO_ACTIVE_GRANT",
        403,
      );
    }
    grantId = covering.id;
  }
  const minutes = getAdminPolicy().pii.revealMinutes;
  return runAudited(
    {
      ctx,
      action: "customer.pii.reveal",
      targetType: "reveal",
      capability: "customers.view",
      reason: input.reason,
      grantId,
      now,
    },
    async (tx) => {
      if (grantId) {
        // The grant must still be active at the moment of the reveal (FOR SHARE semantics via re-read).
        const grant = await tx.staffPiiGrant.findFirst({
          where: { id: grantId, revokedAt: null, expiresAt: { gt: now } },
          select: { id: true },
        });
        if (!grant)
          throw new CustomerError(
            "The grant is no longer active.",
            "GRANT_INACTIVE",
            403,
          );
      }
      const customer = await tx.user.findUnique({
        where: { id: customerId },
        select: { id: true },
      });
      if (!customer) throw new NotFoundError("Customer");
      const reveal = await tx.staffPiiReveal.create({
        data: {
          grantId,
          staffId: ctx.user.id,
          customerId,
          fields,
          reason: input.reason,
          expiresAt: new Date(now.getTime() + minutesToMs(minutes)),
          createdAt: now,
        },
        select: {
          id: true,
          grantId: true,
          customerId: true,
          fields: true,
          expiresAt: true,
        },
      });
      return {
        result: { id: reveal.id, expiresAt: reveal.expiresAt },
        targetId: reveal.id,
        after: reveal,
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Roles (A11) and staff second factor
// ---------------------------------------------------------------------------

export async function setRole(
  ctx: StaffContext,
  userId: string,
  input: {
    readonly role: UserRole;
    readonly reason: string;
    readonly confirmEmail: string;
  },
  now = new Date(),
): Promise<void> {
  await enforceActorLimit(
    ctx,
    "role-change",
    getAdminPolicy().limits.roleChangePerActor,
    { action: "user.role.set", targetType: "user", targetId: userId },
  );
  await runAudited(
    {
      ctx,
      action: "user.role.set",
      targetType: "user",
      targetId: userId,
      capability: "customers.set_role",
      reason: input.reason,
      now,
    },
    async (tx) => {
      if (userId === ctx.user.id)
        throw new CustomerError(
          "You cannot change your own role.",
          "ROLE_SELF",
        );
      // Serialises every role change (and the promote script) so the
      // last-admin rule cannot be raced; the trigger is the final guard.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user-roles'))`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, emailVerified: true },
      });
      if (!user) throw new NotFoundError("User");
      if (user.email !== input.confirmEmail.trim().toLowerCase()) {
        throw new CustomerError(
          "The email you typed does not match this account.",
          "CONFIRMATION_MISMATCH",
        );
      }
      if (user.role === input.role)
        throw new CustomerError(`Already ${input.role}.`);
      if (input.role !== "CUSTOMER" && !user.emailVerified) {
        throw new CustomerError(
          "Staff accounts must have a confirmed email address.",
          "EMAIL_NOT_VERIFIED",
        );
      }
      const after = await tx.user.update({
        where: { id: userId },
        data: { role: input.role },
        select: { id: true, email: true, role: true },
      });
      const sessions = await tx.session.deleteMany({ where: { userId } });
      await tx.staffSessionVerification.deleteMany({ where: { userId } });
      await tx.staffPiiGrant.updateMany({
        where: { granteeId: userId, revokedAt: null },
        data: { revokedAt: now, revokedById: ctx.user.id },
      });
      if (input.role === "CUSTOMER") {
        await tx.staffRecoveryCode.deleteMany({ where: { userId } });
        await tx.staffTwoFactor.deleteMany({ where: { userId } });
      }
      await enqueueOpsAlert(tx, {
        key: `role-changed:${userId}:${now.getTime()}`,
        orderId: null,
        payload: {
          reason: `Account role changed: ${user.role} → ${input.role}`,
          userId,
          sessionsRevoked: sessions.count,
          changeReason: input.reason,
        },
      });
      return {
        result: undefined,
        before: { id: user.id, email: user.email, role: user.role },
        after,
      };
    },
  );
}

export async function resetStaffTwoFactor(
  ctx: StaffContext,
  userId: string,
  reason: string,
  now = new Date(),
): Promise<void> {
  await resetTwoFactor(ctx, userId, reason, now);
}

/** Reuses the Phase 4 rate-limited verification email. */
export async function resendVerification(
  ctx: StaffContext,
  userId: string,
  now = new Date(),
): Promise<void> {
  await runAuditedExternal(
    {
      ctx,
      action: "user.verification.resend",
      targetType: "user",
      targetId: userId,
      capability: "customers.resend_verification",
      now,
    },
    async () => {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, emailVerified: true },
      });
      if (!user) throw new NotFoundError("User");
      if (user.emailVerified)
        throw new CustomerError("This address is already confirmed.");
      const limit = await consumeRateLimit(
        rateLimitKey("verify:email", user.email),
        authRateLimits.verificationResendByEmail,
      );
      if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
      await auth.api.sendVerificationEmail({
        headers: await headers(),
        body: { email: user.email, callbackURL: `${routes.login}?verified=1` },
      });
      return {
        result: undefined,
        after: { id: user.id, emailVerified: false },
      };
    },
  );
}
