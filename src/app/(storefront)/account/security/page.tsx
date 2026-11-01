import type { Metadata } from "next";
import Link from "next/link";

import { AccountShell } from "@/components/account/AccountShell";
import shellStyles from "@/components/account/AccountShell.module.css";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { SessionList } from "@/components/account/SessionList";
import { listSessions } from "@/features/account/service";
import { securityStatus } from "@/features/admin/security/service";
import { requireUser } from "@/server/auth/current-user";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Password and devices",
  robots: { index: false, follow: false },
};

export default async function SecurityPage({
  searchParams,
}: PageProps<"/account/security">) {
  const user = await requireUser();
  const [sessions, query, twoFactor] = await Promise.all([
    listSessions(user),
    searchParams,
    user.role === "CUSTOMER" ? null : securityStatus(user),
  ]);
  return (
    <AccountShell user={user} title="Password and devices">
      {query.changed === "1" ? (
        <p role="status" className={shellStyles.notice}>
          Your password has been changed and other devices have been signed out.
        </p>
      ) : null}
      <div className={shellStyles.panel}>
        <h2 className={shellStyles.panelTitle}>Change your password</h2>
        <ChangePasswordForm />
      </div>
      <div className={shellStyles.panel}>
        <h2 className={shellStyles.panelTitle}>Signed-in devices</h2>
        <SessionList sessions={sessions} />
      </div>
      {twoFactor ? (
        <div className={shellStyles.panel}>
          <h2 className={shellStyles.panelTitle}>Two-factor sign-in</h2>
          <p>
            {twoFactor.enabled
              ? "On. Every staff session confirms a code from your authenticator app."
              : "Not set up yet. You need it before you can open the admin area."}
          </p>
          <p>
            <Link href={routes.accountTwoFactor}>
              {twoFactor.enabled
                ? "Manage two-factor sign-in"
                : "Set up two-factor sign-in"}
            </Link>
          </p>
        </div>
      ) : null}
    </AccountShell>
  );
}
