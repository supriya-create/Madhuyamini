import "server-only";

import { getReturnsPolicy } from "@/config/returns-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { ReturnStatus } from "@/generated/prisma/enums";
import { normalizeOrderNumber } from "@/features/orders/order-number";
import { normalizeReturnNumber } from "@/features/returns/request-number";
import {
  listEvidenceForRequest,
  returnRequestSelect,
} from "@/features/returns/data";
import type { EvidenceRow, ReturnRequestRow } from "@/features/returns/data";
import { OPEN_RETURN_STATUSES } from "@/features/returns/transitions";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { requirePermission } from "../authz";

/**
 * Admin return reads (docs/phase-8-returns-custom-artwork.md §11.2). Every
 * function takes a live StaffContext and checks `returns.view`.
 */

type Tx = Prisma.TransactionClient;

export interface ReturnListFilters {
  readonly status: ReturnStatus | "open" | null;
  readonly q: string | null;
  readonly page: number;
}

export const adminReturnListSelect = {
  id: true,
  requestNumber: true,
  orderId: true,
  status: true,
  createdAt: true,
  decisionDueAt: true,
  shipByAt: true,
  receiveByAt: true,
  order: { select: { orderNumber: true, email: true, recipientName: true } },
  items: { select: { requestedQty: true, approvedQty: true } },
} satisfies Prisma.ReturnRequestSelect;

export type AdminReturnListRow = Prisma.ReturnRequestGetPayload<{
  select: typeof adminReturnListSelect;
}>;

function whereFor(filters: ReturnListFilters): Prisma.ReturnRequestWhereInput {
  const where: Prisma.ReturnRequestWhereInput = {};
  if (filters.status === "open") {
    where.status = { in: [...OPEN_RETURN_STATUSES] };
  } else if (filters.status) {
    where.status = filters.status;
  }
  if (filters.q) {
    const asReturn = normalizeReturnNumber(filters.q);
    const asOrder = normalizeOrderNumber(filters.q);
    where.OR = [
      ...(asReturn ? [{ requestNumber: asReturn }] : []),
      ...(asOrder ? [{ order: { orderNumber: asOrder } }] : []),
      { order: { email: { contains: filters.q.toLowerCase() } } },
    ];
  }
  return where;
}

export async function listReturns(
  ctx: StaffContext,
  filters: ReturnListFilters,
): Promise<{
  rows: AdminReturnListRow[];
  total: number;
  page: number;
  pageCount: number;
}> {
  await requirePermission(ctx, "returns.view");
  const pageSize = getReturnsPolicy().lists.pageSize;
  const where = whereFor(filters);
  const total = await db.returnRequest.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, filters.page), pageCount);
  const rows = await db.returnRequest.findMany({
    where,
    select: adminReturnListSelect,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { rows, total, page, pageCount };
}

export interface AdminReturnBundle {
  readonly row: ReturnRequestRow;
  readonly evidence: readonly EvidenceRow[];
}

export async function findReturnDetail(
  ctx: StaffContext,
  id: string,
  tx: Tx = db,
): Promise<AdminReturnBundle | null> {
  await requirePermission(ctx, "returns.view", { tx });
  const row = await tx.returnRequest.findUnique({
    where: { id },
    select: returnRequestSelect,
  });
  if (!row) return null;
  const evidence = await listEvidenceForRequest(id, tx);
  return { row, evidence };
}

/** Counts for the overview tile and the queue tabs. */
export async function countReturnsByStatus(
  ctx: StaffContext,
): Promise<ReadonlyArray<{ status: ReturnStatus; count: number }>> {
  await requirePermission(ctx, "returns.view");
  const groups = await db.returnRequest.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  return groups.map((group) => ({
    status: group.status,
    count: group._count._all,
  }));
}
