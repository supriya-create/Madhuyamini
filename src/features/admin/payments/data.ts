import "server-only";

import { getAdminPolicy } from "@/config/admin-policy";
import type { Prisma } from "@/generated/prisma/client";
import type { RefundStatus } from "@/generated/prisma/enums";
import type { StaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";

import { requirePermission } from "../authz";
import { adminOrderListSelect } from "../orders/data";
import type { AdminOrderListRow } from "../orders/data";

/** Payment-review and refund reads (docs/admin.md §5.5), gated like every admin read. */

type Tx = Prisma.TransactionClient;

export async function listReviewOrders(
  ctx: StaffContext,
  tx: Tx = db,
): Promise<AdminOrderListRow[]> {
  await requirePermission(ctx, "admin.view", { tx });
  return tx.order.findMany({
    where: { status: "NEEDS_REVIEW" },
    select: adminOrderListSelect,
    orderBy: { updatedAt: "asc" },
    take: getAdminPolicy().lists.maxPageSize,
  });
}

export const refundRowSelect = {
  id: true,
  status: true,
  amountInPaise: true,
  reason: true,
  reference: true,
  providerRefundId: true,
  attempts: true,
  lastError: true,
  nextAttemptAt: true,
  requestedAt: true,
  processedAt: true,
  createdAt: true,
  order: { select: { id: true, orderNumber: true } },
  payment: { select: { id: true, attemptNo: true, providerPaymentId: true } },
} satisfies Prisma.RefundSelect;

export type RefundRow = Prisma.RefundGetPayload<{
  select: typeof refundRowSelect;
}>;

export async function listRefunds(
  ctx: StaffContext,
  filters: { readonly status: RefundStatus | null },
  tx: Tx = db,
): Promise<RefundRow[]> {
  await requirePermission(ctx, "admin.view", { tx });
  return tx.refund.findMany({
    where: filters.status ? { status: filters.status } : {},
    select: refundRowSelect,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: getAdminPolicy().lists.maxPageSize,
  });
}

export async function findRefund(
  ctx: StaffContext,
  refundId: string,
  tx: Tx = db,
): Promise<RefundRow | null> {
  await requirePermission(ctx, "admin.view", { tx });
  return tx.refund.findUnique({
    where: { id: refundId },
    select: refundRowSelect,
  });
}
