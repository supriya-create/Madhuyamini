import type { Metadata } from "next";
import { headers } from "next/headers";

import { AdminShell } from "@/components/admin/AdminShell";
import { safeReturnPath } from "@/features/auth/schemas";
import { requireStaffSessionOrRedirect } from "@/server/auth/staff";
import { ADMIN_PATH_HEADER } from "@/lib/request-headers";
import { routes } from "@/lib/routes";

/**
 * The admin area never renders without a verified StaffContext
 * (docs/admin.md §6). This layout is the convenience gate; every page,
 * data read and mutation under it re-checks the context itself.
 */

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const requested = (await headers()).get(ADMIN_PATH_HEADER);
  const ctx = await requireStaffSessionOrRedirect(
    safeReturnPath(requested, routes.admin),
  );
  return <AdminShell ctx={ctx}>{children}</AdminShell>;
}
