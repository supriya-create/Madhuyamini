import { NextResponse } from "next/server";
import { z } from "zod";

import { getReturnsPolicy } from "@/config/returns-policy";
import { actorFromContext, writeAudit } from "@/features/admin/audit-log";
import { can } from "@/features/admin/authz";
import { getCurrentUser } from "@/server/auth/current-user";
import { getStaffContext } from "@/server/auth/staff";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { signedDeliveryUrl } from "@/server/uploads/private-url";

/**
 * The only way a private file reaches a browser (docs/phase-8-returns-custom-artwork.md
 * §6.9, §8.3). The caller must own the ledger row or hold `returns.view`;
 * the asset is then fetched server-side with a signed `authenticated` URL
 * that never leaves the server, and streamed with no caching. Width is
 * limited to the policy's list so arbitrary transformations cannot be
 * requested. Staff downloads of originals are audited.
 */

export const dynamic = "force-dynamic";

const idSchema = z.uuid();
const NOT_FOUND = new NextResponse(null, { status: 404 });

export async function GET(
  request: Request,
  context: RouteContext<"/api/files/[ledgerId]">,
) {
  const { ledgerId } = await context.params;
  const parsedId = idSchema.safeParse(ledgerId);
  if (!parsedId.success) return NOT_FOUND;
  const user = await getCurrentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const row = await db.customerUpload.findUnique({
    where: { id: parsedId.data },
    select: {
      id: true,
      ownerUserId: true,
      publicId: true,
      format: true,
      status: true,
      verifiedAt: true,
      targetType: true,
      targetId: true,
    },
  });
  if (!row || !row.verifiedAt || !row.format) return NOT_FOUND;
  if (row.status !== "ATTACHED" && row.status !== "ISSUED") return NOT_FOUND;

  let staffActor: ReturnType<typeof actorFromContext> | null = null;
  if (row.ownerUserId !== user.id) {
    const staff = await getStaffContext();
    if (!staff.ok || !can(staff.ctx.role, "returns.view")) return NOT_FOUND;
    // Unattached uploads are visible to their owner only.
    if (row.status !== "ATTACHED") return NOT_FOUND;
    staffActor = actorFromContext(staff.ctx);
  }

  const config = env.cloudinary;
  if (!config) return NOT_FOUND;
  const policy = getReturnsPolicy();
  const url = new URL(request.url);
  const widthParam = url.searchParams.get("w");
  const width = widthParam ? Number(widthParam) : null;
  if (width !== null && !policy.files.deliveryWidths.includes(width)) {
    return new NextResponse(null, { status: 400 });
  }
  const download = url.searchParams.get("download") === "1";
  if (download && staffActor) {
    await writeAudit({
      actor: staffActor,
      action: "file.downloaded",
      targetType: "customer_upload",
      targetId: row.id,
      outcome: "SUCCESS",
      after: { id: row.id, publicId: row.publicId, status: row.status },
    });
  }

  const upstream = await fetch(
    signedDeliveryUrl({
      cloudName: config.cloudName,
      apiSecret: config.apiSecret,
      publicId: row.publicId,
      format: row.format,
      version: null,
      transformation: width !== null ? `c_limit,w_${width}` : null,
      type: policy.files.deliveryType,
    }),
    { cache: "no-store" },
  );
  if (!upstream.ok || !upstream.body) {
    return new NextResponse(null, {
      status: upstream.status === 404 ? 404 : 502,
    });
  }
  const headers = new Headers();
  headers.set(
    "Content-Type",
    upstream.headers.get("content-type") ?? "application/octet-stream",
  );
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Content-Disposition",
    `${download ? "attachment" : "inline"}; filename="${row.id}.${row.format}"`,
  );
  return new NextResponse(upstream.body, { status: 200, headers });
}
