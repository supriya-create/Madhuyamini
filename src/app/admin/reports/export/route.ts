import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ReauthRequiredError } from "@/features/admin/authz";
import {
  reportQuerySchema,
  resolveWindow,
} from "@/features/admin/reports/schemas";
import { exportReportCsv } from "@/features/admin/reports/service";
import { StaffGateError, getStaffContext } from "@/server/auth/staff";
import { isAppError } from "@/server/errors";
import { routes } from "@/lib/routes";

/**
 * CSV export (docs/admin.md §5.8): ADMIN with a fresh second factor, audited.
 * Route handlers sit outside the admin layout, so the gate runs here too.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const resolution = await getStaffContext();
  if (!resolution.ok) {
    if (resolution.reason === "forbidden")
      return new NextResponse(null, { status: 404 });
    return new NextResponse(null, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const query = reportQuerySchema.parse({
    report: params.get("report") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    granularity: params.get("granularity") ?? undefined,
  });
  const report = query.report ?? "sales";
  try {
    const { filename, body } = await exportReportCsv(
      resolution.ctx,
      report,
      resolveWindow(query),
    );
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      return NextResponse.redirect(
        new URL(
          `${routes.adminReauth}?next=${encodeURIComponent(next)}`,
          request.url,
        ),
      );
    }
    if (error instanceof StaffGateError)
      return new NextResponse(null, { status: 403 });
    if (isAppError(error))
      return new NextResponse(error.message, { status: error.status });
    throw error;
  }
}
