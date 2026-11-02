import "server-only";

import { cleanupCarts } from "@/features/cart/service";
import { cleanupRateLimits } from "@/server/auth/rate-limit";
import { db } from "@/server/db";

import { runSweepCustomerUploads } from "./sweep-customer-uploads";
import { runSweepUploads } from "./sweep-uploads";

/**
 * The daily sweeps the earlier phases deferred, expired order-access
 * tokens, and (Phase 7) the orphaned upload ledger rows.
 */
export async function runCleanup(
  options: { readonly now?: Date } = {},
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const uploads = await runSweepUploads({ now });
  const customerUploads = await runSweepCustomerUploads({ now });
  const carts = await cleanupCarts(now);
  const rateLimits = await cleanupRateLimits(undefined, now.getTime());
  const sessions = await db.session.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const verifications = await db.verification.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const accessTokens = await db.orderAccessToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
  });
  return {
    carts,
    rateLimits: typeof rateLimits === "number" ? rateLimits : 0,
    sessions: sessions.count,
    verifications: verifications.count,
    accessTokens: accessTokens.count,
    uploadsSwept: uploads.swept,
    uploadSweepErrors: uploads.errors,
    customerUploadsSwept: customerUploads.swept,
    customerUploadSweepErrors: customerUploads.errors,
  };
}
