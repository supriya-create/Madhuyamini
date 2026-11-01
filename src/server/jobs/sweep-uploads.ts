import "server-only";

import { getAdminPolicy, hoursToMs } from "@/config/admin-policy";
import { systemActor, writeAudit } from "@/features/admin/audit";
import { db } from "@/server/db";
import { destroyCloudinaryImage } from "@/server/uploads/cloudinary";
import type { DestroyOutcome } from "@/server/uploads/cloudinary";
import { isWithinUploadFolder } from "@/server/uploads/signature";

import { describeError } from "./queue";

/**
 * Orphaned uploads (docs/admin.md §5.2, A17): a signature was issued but
 * nothing was attached within the grace period. Ledger-driven, so only
 * assets we issued are ever deleted; folder-scoped, so a row that somehow
 * points elsewhere is left alone and flagged; each outcome is audited as
 * `system:upload-sweep`. Deleting is idempotent, so two workers racing on
 * the same row cannot do harm.
 */

export async function runSweepUploads(
  options: {
    readonly now?: Date;
    readonly limit?: number;
    readonly destroy?: (publicId: string) => Promise<DestroyOutcome>;
  } = {},
): Promise<{
  examined: number;
  swept: number;
  errors: number;
  skipped: number;
}> {
  const now = options.now ?? new Date();
  const policy = getAdminPolicy().uploads;
  const destroy =
    options.destroy ?? ((publicId: string) => destroyCloudinaryImage(publicId));
  const cutoff = new Date(now.getTime() - hoursToMs(policy.orphanGraceHours));
  const summary = { examined: 0, swept: 0, errors: 0, skipped: 0 };
  const actor = systemActor("upload-sweep");

  const rows = await db.productImageUpload.findMany({
    where: {
      OR: [
        { status: "ISSUED", issuedAt: { lt: cutoff } },
        // Removed images whose delete at Cloudinary failed at the time.
        { status: "DISCARDED", sweepError: { not: null } },
      ],
    },
    select: {
      id: true,
      publicId: true,
      folder: true,
      productId: true,
      status: true,
    },
    orderBy: { issuedAt: "asc" },
    take: options.limit ?? 50,
  });

  for (const row of rows) {
    summary.examined += 1;
    const base = {
      actor,
      action: "upload.sweep",
      targetType: "upload",
      targetId: row.id,
    } as const;
    if (!isWithinUploadFolder(row.publicId, policy.folder)) {
      await db.productImageUpload.update({
        where: { id: row.id },
        data: {
          sweepError: "Public id is outside the upload folder; left untouched.",
        },
      });
      await writeAudit({
        ...base,
        outcome: "REFUSED",
        errorCode: "UPLOAD_OUTSIDE_FOLDER",
        after: { id: row.id, publicId: row.publicId, status: row.status },
      });
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await destroy(row.publicId);
      await db.productImageUpload.updateMany({
        where: { id: row.id, status: { in: ["ISSUED", "DISCARDED"] } },
        data: { status: "SWEPT", resolvedAt: now, sweepError: null },
      });
      await writeAudit({
        ...base,
        outcome: "SUCCESS",
        reason: result,
        after: { id: row.id, publicId: row.publicId, status: "SWEPT" },
      });
      summary.swept += 1;
    } catch (error) {
      await db.productImageUpload.updateMany({
        where: { id: row.id, status: { in: ["ISSUED", "DISCARDED"] } },
        data: { sweepError: describeError(error) },
      });
      await writeAudit({
        ...base,
        outcome: "FAILED",
        errorCode: "UPLOAD_SWEEP_FAILED",
        after: { id: row.id, publicId: row.publicId, status: row.status },
      });
      summary.errors += 1;
    }
  }
  return summary;
}
