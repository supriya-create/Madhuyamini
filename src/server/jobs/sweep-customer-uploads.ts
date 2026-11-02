import "server-only";

import { daysToMs, getReturnsPolicy, hoursToMs } from "@/config/returns-policy";
import { systemActor, writeAudit } from "@/features/admin/audit-log";
import { CLOSED_RETURN_STATUSES } from "@/features/returns/transitions";
import { db } from "@/server/db";
import { destroyCloudinaryImage } from "@/server/uploads/cloudinary";
import type { DestroyOutcome } from "@/server/uploads/cloudinary";
import { isWithinUploadFolder } from "@/server/uploads/signature";

import { describeError } from "./queue";

/**
 * The private file ledger's sweep (docs/phase-8-returns-custom-artwork.md
 * §7.9, §10.1): orphans never attached within the grace period, evidence of
 * requests closed longer ago than the retention period, and rows whose
 * earlier delete failed. Ledger-driven and folder-scoped like the product
 * image sweep; every outcome is audited as the system actor.
 */

const FOLDERS = ["madhuyamini/returns", "madhuyamini/commissions"] as const;

export async function runSweepCustomerUploads(
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
  const policy = getReturnsPolicy().files;
  const destroy = options.destroy ?? destroyCloudinaryImage;
  const actor = systemActor("upload-sweep");
  const summary = { examined: 0, swept: 0, errors: 0, skipped: 0 };
  const orphanCutoff = new Date(
    now.getTime() - hoursToMs(policy.orphanGraceHours),
  );
  const retentionCutoff = new Date(
    now.getTime() - daysToMs(policy.retentionDaysAfterClose),
  );

  const closedRequestIds = (
    await db.returnRequest.findMany({
      where: {
        status: { in: [...CLOSED_RETURN_STATUSES] },
        closedAt: { lt: retentionCutoff },
      },
      select: { id: true },
      take: options.limit ?? 50,
    })
  ).map((row) => row.id);

  const rows = await db.customerUpload.findMany({
    where: {
      OR: [
        { status: "ISSUED", issuedAt: { lt: orphanCutoff } },
        { status: "DISCARDED", sweepError: { not: null } },
        ...(closedRequestIds.length > 0
          ? [
              {
                status: "ATTACHED" as const,
                targetType: "return_request",
                targetId: { in: closedRequestIds },
              },
            ]
          : []),
      ],
    },
    select: { id: true, publicId: true, status: true },
    orderBy: { issuedAt: "asc" },
    take: options.limit ?? 50,
  });

  for (const row of rows) {
    summary.examined += 1;
    const base = {
      actor,
      action: "upload.sweep",
      targetType: "customer_upload",
      targetId: row.id,
    } as const;
    if (!FOLDERS.some((folder) => isWithinUploadFolder(row.publicId, folder))) {
      await db.customerUpload.update({
        where: { id: row.id },
        data: {
          sweepError:
            "Public id is outside the upload folders; left untouched.",
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
      await db.customerUpload.updateMany({
        where: {
          id: row.id,
          status: { in: ["ISSUED", "DISCARDED", "ATTACHED"] },
        },
        data: {
          status: row.status === "ATTACHED" ? "DISCARDED" : "SWEPT",
          resolvedAt: now,
          sweepError: null,
        },
      });
      await writeAudit({
        ...base,
        outcome: "SUCCESS",
        reason: result,
        after: {
          id: row.id,
          publicId: row.publicId,
          status: row.status === "ATTACHED" ? "DISCARDED" : "SWEPT",
        },
      });
      summary.swept += 1;
    } catch (error) {
      await db.customerUpload.updateMany({
        where: { id: row.id },
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
