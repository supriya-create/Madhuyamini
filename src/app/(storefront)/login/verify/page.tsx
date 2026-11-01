import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VerifySecondFactorForm } from "@/components/admin/VerifySecondFactorForm";
import { AuthPage } from "@/components/auth/AuthPage";
import { safeReturnPath } from "@/features/auth/schemas";
import { getCurrentUser } from "@/server/auth/current-user";
import { getStaffContext } from "@/server/auth/staff";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Confirm your sign-in",
  robots: { index: false, follow: false },
};

/**
 * Second step of a staff sign-in (docs/admin.md §5.9). Customers and
 * already-verified sessions are sent on; unenrolled staff go to set up.
 */
export default async function LoginVerifyPage({
  searchParams,
}: PageProps<"/login/verify">) {
  const query = await searchParams;
  const next = safeReturnPath(query.next, routes.admin);
  const user = await getCurrentUser();
  if (!user) redirect(`${routes.login}?next=${encodeURIComponent(next)}`);
  const resolution = await getStaffContext();
  if (resolution.ok) redirect(next);
  if (resolution.reason === "forbidden")
    redirect(safeReturnPath(query.next, routes.account));
  if (resolution.reason === "not_enrolled") {
    redirect(`${routes.accountTwoFactor}?next=${encodeURIComponent(next)}`);
  }
  return (
    <AuthPage
      title="Confirm your sign-in"
      intro={
        <p>
          Staff accounts confirm every new session with a second factor. Enter
          the code from your authenticator app, or use one of your recovery
          codes.
        </p>
      }
    >
      <VerifySecondFactorForm next={next} />
    </AuthPage>
  );
}
