import type { Metadata } from "next";

import { AdminPageHeader } from "@/components/admin/AdminShell";
import { VerifySecondFactorForm } from "@/components/admin/VerifySecondFactorForm";
import { safeReturnPath } from "@/features/auth/schemas";
import { requireStaffSession } from "@/server/auth/staff";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Confirm it's you" };

/** Sensitive operations ask for a fresh code (docs/admin.md §5.9). */
export default async function ReauthPage({
  searchParams,
}: PageProps<"/admin/reauth">) {
  await requireStaffSession();
  const query = await searchParams;
  const next = safeReturnPath(query.next, routes.admin);
  return (
    <div>
      <AdminPageHeader
        title="Confirm it's you"
        lede="This action needs a fresh code from your authenticator app. You will be taken back once it is confirmed."
      />
      <VerifySecondFactorForm next={next} submitLabel="Confirm and continue" />
    </div>
  );
}
