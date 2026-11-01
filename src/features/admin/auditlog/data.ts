import "server-only";

import { getAdminPolicy } from "@/config/admin-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { AuditOutcome } from "@/generated/prisma/enums";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { requirePermission } from "../authz";

/** The audit browser (docs/admin.md §5.7, ADMIN): read-only, newest first. */

export const auditRowSelect = {
  id: true,
  actorLabel: true,
  actorRole: true,
  action: true,
  targetType: true,
  targetId: true,
  outcome: true,
  reason: true,
  errorCode: true,
  grantId: true,
  before: true,
  after: true,
  createdAt: true,
} satisfies Prisma.AdminAuditLogSelect;

export type AuditRow = Prisma.AdminAuditLogGetPayload<{
  select: typeof auditRowSelect;
}>;

export interface AuditFilters {
  readonly action: string | null;
  readonly outcome: AuditOutcome | null;
  readonly targetId: string | null;
  readonly page: number;
}

export async function listAudit(
  ctx: StaffContext,
  filters: AuditFilters,
  tx: Prisma.TransactionClient = db,
): Promise<{
  rows: AuditRow[];
  total: number;
  page: number;
  pageCount: number;
}> {
  await requirePermission(ctx, "audit.view", { tx });
  const pageSize = getAdminPolicy().lists.maxPageSize;
  const where: Prisma.AdminAuditLogWhereInput = {};
  if (filters.action) where.action = { startsWith: filters.action };
  if (filters.outcome) where.outcome = filters.outcome;
  if (filters.targetId) where.targetId = filters.targetId;
  const total = await tx.adminAuditLog.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  const rows = await tx.adminAuditLog.findMany({
    where,
    select: auditRowSelect,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { rows, total, page, pageCount };
}
