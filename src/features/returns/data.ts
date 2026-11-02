import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor, ReturnStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";

import { OPEN_RETURN_STATUSES, countsAgainstAvailability } from "./transitions";

/**
 * Returns data access (docs/phase-8-returns-custom-artwork.md §7.2, §8.1).
 * Customer reads are scoped by user id in the query itself; nothing fetches
 * a request by id alone for a customer. Admin reads live in
 * features/admin/returns/data.ts and take a StaffContext.
 */

type Tx = Prisma.TransactionClient;

export const returnItemSelect = {
  id: true,
  orderItemId: true,
  variantId: true,
  requestedQty: true,
  approvedQty: true,
  receivedQty: true,
  restockQty: true,
  repairQty: true,
  quarantineQty: true,
  writeOffQty: true,
  returnToCustomerQty: true,
  notReceivedQty: true,
  heldQty: true,
  releasedQty: true,
  reason: true,
  description: true,
  resolutionPreference: true,
  exchangeVariantId: true,
  condition: true,
  inspectionNote: true,
  inspected: true,
  orderItem: {
    select: {
      productTitle: true,
      variantTitle: true,
      sku: true,
      quantity: true,
      unitPriceInPaise: true,
      imageUrl: true,
      imageAlt: true,
    },
  },
  exchangeVariant: { select: { id: true, title: true, sku: true } },
} satisfies Prisma.ReturnItemSelect;

export const returnRequestSelect = {
  id: true,
  requestNumber: true,
  orderId: true,
  userId: true,
  status: true,
  operationKey: true,
  policySnapshot: true,
  instructionsSnapshot: true,
  decisionDueAt: true,
  shipByAt: true,
  receiveByAt: true,
  receivedAt: true,
  receivedNote: true,
  inspectedAt: true,
  inspectionNote: true,
  closedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      email: true,
      phone: true,
      recipientName: true,
      city: true,
      state: true,
      status: true,
    },
  },
  items: { select: returnItemSelect, orderBy: { createdAt: "asc" } },
  shipments: {
    select: {
      id: true,
      direction: true,
      carrier: true,
      trackingNumber: true,
      trackingUrl: true,
      shippedAt: true,
      receivedAt: true,
      recordedBy: true,
    },
    orderBy: { shippedAt: "asc" },
  },
  events: {
    select: {
      id: true,
      type: true,
      actor: true,
      fromStatus: true,
      toStatus: true,
      visibleToCustomer: true,
      note: true,
      data: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
  messages: {
    select: {
      id: true,
      author: true,
      body: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.ReturnRequestSelect;

export type ReturnRequestRow = Prisma.ReturnRequestGetPayload<{
  select: typeof returnRequestSelect;
}>;

export const evidenceSelect = {
  id: true,
  purpose: true,
  status: true,
  width: true,
  height: true,
  format: true,
  bytes: true,
  ownerUserId: true,
  issuedByStaffId: true,
  issuedAt: true,
} satisfies Prisma.CustomerUploadSelect;

export type EvidenceRow = Prisma.CustomerUploadGetPayload<{
  select: typeof evidenceSelect;
}>;

/** The order facts eligibility needs, for the signed-in owner only. */
export const returnableOrderSelect = {
  id: true,
  orderNumber: true,
  userId: true,
  status: true,
  email: true,
  shipment: { select: { deliveredAt: true } },
  items: {
    select: {
      id: true,
      variantId: true,
      quantity: true,
      productTitle: true,
      variantTitle: true,
      sku: true,
      variant: {
        select: {
          productId: true,
          product: {
            select: {
              kind: true,
              isOneOfAKind: true,
              category: { select: { slug: true } },
              variants: {
                where: { isActive: true },
                select: {
                  id: true,
                  title: true,
                  sku: true,
                  inventory: { select: { stockOnHand: true, reserved: true } },
                },
                orderBy: { position: "asc" },
              },
            },
          },
        },
      },
    },
    orderBy: { productTitle: "asc" },
  },
} satisfies Prisma.OrderSelect;

export type ReturnableOrderRow = Prisma.OrderGetPayload<{
  select: typeof returnableOrderSelect;
}>;

export function findReturnableOrder(
  userId: string,
  orderNumber: string,
  tx: Tx = db,
) {
  return tx.order.findFirst({
    where: { orderNumber, userId },
    select: returnableOrderSelect,
  });
}

export function findRequestForUser(
  userId: string,
  requestNumber: string,
  tx: Tx = db,
) {
  return tx.returnRequest.findFirst({
    where: { requestNumber, userId },
    select: returnRequestSelect,
  });
}

export function listRequestsForUser(userId: string, tx: Tx = db) {
  return tx.returnRequest.findMany({
    where: { userId },
    select: {
      id: true,
      requestNumber: true,
      status: true,
      createdAt: true,
      order: { select: { orderNumber: true } },
      items: { select: { requestedQty: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export function listRequestsForOrder(
  userId: string,
  orderId: string,
  tx: Tx = db,
) {
  return tx.returnRequest.findMany({
    where: { userId, orderId },
    select: {
      id: true,
      requestNumber: true,
      status: true,
      createdAt: true,
      items: { select: { requestedQty: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Units of each order line that are already in an open request or were
 * accepted by a closed one; computed under the order lock, never cached.
 */
export async function usedQuantities(
  tx: Tx,
  orderId: string,
): Promise<Map<string, number>> {
  const rows = await tx.returnItem.findMany({
    where: { request: { orderId } },
    select: {
      orderItemId: true,
      requestedQty: true,
      approvedQty: true,
      receivedQty: true,
      request: { select: { status: true } },
    },
  });
  const used = new Map<string, number>();
  for (const row of rows) {
    if (!countsAgainstAvailability(row.request.status)) continue;
    const units = OPEN_RETURN_STATUSES.includes(row.request.status)
      ? (row.approvedQty ?? row.requestedQty)
      : (row.receivedQty ?? row.approvedQty ?? 0);
    used.set(row.orderItemId, (used.get(row.orderItemId) ?? 0) + units);
  }
  return used;
}

export async function hasOpenRequest(
  tx: Tx,
  orderId: string,
): Promise<boolean> {
  const count = await tx.returnRequest.count({
    where: { orderId, status: { in: [...OPEN_RETURN_STATUSES] } },
  });
  return count > 0;
}

/** Row lock on the request; callers hold the order lock first (lock order §9.4). */
export async function lockReturnRequest(tx: Tx, id: string): Promise<void> {
  await tx.$executeRaw`SELECT id FROM return_requests WHERE id = ${id}::uuid FOR UPDATE`;
}

export function recordReturnEvent(
  tx: Tx,
  input: {
    readonly returnRequestId: string;
    readonly type: string;
    readonly actor: OrderActor;
    readonly actorUserId?: string | null;
    readonly fromStatus?: ReturnStatus | null;
    readonly toStatus?: ReturnStatus | null;
    readonly visibleToCustomer?: boolean;
    readonly note?: string | null;
    readonly data?: Prisma.InputJsonValue;
    readonly at?: Date;
  },
) {
  return tx.returnEvent.create({
    data: {
      returnRequestId: input.returnRequestId,
      type: input.type,
      actor: input.actor,
      actorUserId: input.actorUserId ?? null,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      visibleToCustomer: input.visibleToCustomer ?? true,
      note: input.note ?? null,
      data: input.data,
      ...(input.at ? { createdAt: input.at } : {}),
    },
    select: { id: true },
  });
}

/** Evidence attached to a request, in upload order. */
export function listEvidenceForRequest(requestId: string, tx: Tx = db) {
  return tx.customerUpload.findMany({
    where: {
      targetType: "return_request",
      targetId: requestId,
      status: "ATTACHED",
    },
    select: evidenceSelect,
    orderBy: { issuedAt: "asc" },
  });
}

/** Verified, unattached evidence the given customer uploaded, by id. */
export function findVerifiedEvidence(
  tx: Tx,
  userId: string,
  ids: readonly string[],
) {
  if (ids.length === 0) return Promise.resolve([]);
  return tx.customerUpload.findMany({
    where: {
      id: { in: [...ids] },
      ownerUserId: userId,
      purpose: "RETURN_EVIDENCE",
      status: "ISSUED",
      verifiedAt: { not: null },
      targetId: null,
    },
    select: { id: true },
  });
}

export async function attachEvidence(
  tx: Tx,
  userId: string,
  ids: readonly string[],
  requestId: string,
  now: Date,
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await tx.customerUpload.updateMany({
    where: {
      id: { in: [...ids] },
      ownerUserId: userId,
      purpose: "RETURN_EVIDENCE",
      status: "ISSUED",
      verifiedAt: { not: null },
      targetId: null,
    },
    data: {
      status: "ATTACHED",
      targetType: "return_request",
      targetId: requestId,
      resolvedAt: now,
    },
  });
  return result.count;
}
