import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/**
 * Grant and reveal lookups used inside the customer service's own
 * authorisation logic. They take the caller's transaction and are never
 * exposed to pages; the service that calls them has already passed the gate.
 */

type Tx = Prisma.TransactionClient;

/** Active grants held by a staff member: not revoked, not expired, covering the customer. */
export async function findActiveGrants(
  tx: Tx,
  granteeId: string,
  customerId: string,
  now: Date,
): Promise<Array<{ id: string; fields: string[]; customerId: string | null }>> {
  return tx.staffPiiGrant.findMany({
    where: {
      granteeId,
      revokedAt: null,
      expiresAt: { gt: now },
      OR: [{ customerId }, { customerId: null }],
    },
    select: { id: true, fields: true, customerId: true },
    orderBy: { createdAt: "desc" },
  });
}

/** The viewer's own unexpired reveals for this customer (re-checked against their grants by the service). */
export async function findLiveReveals(
  tx: Tx,
  staffId: string,
  customerId: string,
  now: Date,
): Promise<Array<{ id: string; grantId: string | null; fields: string[] }>> {
  return tx.staffPiiReveal.findMany({
    where: { staffId, customerId, expiresAt: { gt: now } },
    select: { id: true, grantId: true, fields: true },
  });
}
