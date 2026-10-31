import type { Metadata } from "next";

import { AccountShell } from "@/components/account/AccountShell";
import shellStyles from "@/components/account/AccountShell.module.css";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { SessionList } from "@/components/account/SessionList";
import { listSessions } from "@/features/account/service";
import { requireUser } from "@/server/auth/current-user";

export const metadata: Metadata = {
  title: "Password and devices",
  robots: { index: false, follow: false },
};

export default async function SecurityPage({
  searchParams,
}: PageProps<"/account/security">) {
  const user = await requireUser();
  const [sessions, query] = await Promise.all([
    listSessions(user),
    searchParams,
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
    </AccountShell>
  );
}
