import "server-only";

import { getAdminPolicy } from "@/config/admin-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { UserRole } from "@/generated/prisma/enums";
import { normalizeOrderNumber } from "@/features/orders/order-number";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { requirePermission } from "../authz";

/**
 * Customer reads (docs/admin.md §5.7). Lists never return address lines or
 * full contact details; the service masks what it shows. Search by order
 * number, or by exact email or phone, never a partial contact match.
 */

type Tx = Prisma.TransactionClient;

export const customerListSelect = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  phone: true,
  role: true,
  createdAt: true,
  _count: { select: { orders: true, sessions: true } },
  addresses: { where: { isDefault: true }, select: { city: true }, take: 1 },
} satisfies Prisma.UserSelect;

export type CustomerListRow = Prisma.UserGetPayload<{
  select: typeof customerListSelect;
}>;

export interface CustomerFilters {
  readonly q: string | null;
  readonly role: UserRole | null;
  readonly page: number;
}

export async function listCustomers(
  ctx: StaffContext,
  filters: CustomerFilters,
  tx: Tx = db,
): Promise<{
  rows: CustomerListRow[];
  total: number;
  page: number;
  pageCount: number;
}> {
  await requirePermission(ctx, "customers.view", { tx });
  const pageSize = getAdminPolicy().lists.pageSize;
  const where: Prisma.UserWhereInput = {};
  if (filters.role) where.role = filters.role;
  const q = filters.q?.trim();
  if (q) {
    const orderNumber = normalizeOrderNumber(q);
    if (orderNumber) {
      where.orders = { some: { orderNumber } };
    } else if (q.includes("@")) {
      where.email = q.toLowerCase();
    } else if (/^\+?[0-9\s-]{8,16}$/.test(q)) {
      const digits = q.replace(/[\s-]/g, "");
      where.phone = digits.startsWith("+") ? digits : `+91${digits}`;
    } else {
      where.name = { contains: q, mode: "insensitive" };
    }
  }
  const total = await tx.user.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  const rows = await tx.user.findMany({
    where,
    select: customerListSelect,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { rows, total, page, pageCount };
}

export const customerDetailSelect = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  phone: true,
  role: true,
  createdAt: true,
  addresses: {
    select: {
      id: true,
      label: true,
      recipientName: true,
      phone: true,
      line1: true,
      line2: true,
      landmark: true,
      city: true,
      state: true,
      postalCode: true,
      isDefault: true,
    },
    orderBy: { createdAt: "asc" },
  },
  orders: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalInPaise: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  },
  staffTwoFactor: { select: { enabledAt: true } },
  _count: { select: { sessions: true } },
} satisfies Prisma.UserSelect;

export type CustomerDetailRow = Prisma.UserGetPayload<{
  select: typeof customerDetailSelect;
}>;

export async function findCustomer(
  ctx: StaffContext,
  userId: string,
  tx: Tx = db,
): Promise<CustomerDetailRow | null> {
  await requirePermission(ctx, "customers.view", { tx });
  return tx.user.findUnique({
    where: { id: userId },
    select: customerDetailSelect,
  });
}

export const grantSelect = {
  id: true,
  granteeId: true,
  grantedById: true,
  customerId: true,
  fields: true,
  reason: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  grantee: { select: { name: true, email: true } },
  grantedBy: { select: { name: true } },
} satisfies Prisma.StaffPiiGrantSelect;

export type GrantRow = Prisma.StaffPiiGrantGetPayload<{
  select: typeof grantSelect;
}>;

/** Grants that could apply to this customer (specific or shift-wide), newest first. */
export async function listGrantsForCustomer(
  ctx: StaffContext,
  customerId: string,
  tx: Tx = db,
): Promise<GrantRow[]> {
  await requirePermission(ctx, "customers.view", { tx });
  return tx.staffPiiGrant.findMany({
    where: { OR: [{ customerId }, { customerId: null }] },
    select: grantSelect,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export const revealSelect = {
  id: true,
  grantId: true,
  staffId: true,
  customerId: true,
  fields: true,
  reason: true,
  expiresAt: true,
  createdAt: true,
  staff: { select: { name: true } },
} satisfies Prisma.StaffPiiRevealSelect;

export type RevealRow = Prisma.StaffPiiRevealGetPayload<{
  select: typeof revealSelect;
}>;

export async function listRevealsForCustomer(
  ctx: StaffContext,
  customerId: string,
  tx: Tx = db,
): Promise<RevealRow[]> {
  await requirePermission(ctx, "customers.view", { tx });
  return tx.staffPiiReveal.findMany({
    where: { customerId },
    select: revealSelect,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function listStaffUsers(
  ctx: StaffContext,
  tx: Tx = db,
): Promise<Array<{ id: string; name: string; email: string; role: UserRole }>> {
  await requirePermission(ctx, "customers.view", { tx });
  return tx.user.findMany({
    where: { role: { in: ["STAFF", "ADMIN"] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
}

export async function countRevealsSince(
  ctx: StaffContext,
  since: Date,
  tx: Tx = db,
): Promise<number> {
  await requirePermission(ctx, "admin.view", { tx });
  return tx.staffPiiReveal.count({ where: { createdAt: { gte: since } } });
}
