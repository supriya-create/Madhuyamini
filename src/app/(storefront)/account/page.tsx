import type { Metadata } from "next";
import Link from "next/link";

import { AccountShell } from "@/components/account/AccountShell";
import { ResendVerification } from "@/components/account/ResendVerification";
import shellStyles from "@/components/account/AccountShell.module.css";
import { listAddresses } from "@/features/account/service";
import { requireUser } from "@/server/auth/current-user";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export default async function AccountPage({
  searchParams,
}: PageProps<"/account">) {
  const user = await requireUser();
  const query = await searchParams;
  const addresses = await listAddresses(user);
  const defaultAddress =
    addresses.find((address) => address.isDefault) ?? addresses[0];

  return (
    <AccountShell user={user} title="Overview">
      {query.verified === "1" && user.emailVerified ? (
        <p role="status" className={shellStyles.notice}>
          Thank you, your email address is confirmed.
        </p>
      ) : null}
      {!user.emailVerified ? <ResendVerification email={user.email} /> : null}

      <div className={shellStyles.panel}>
        <h2 className={shellStyles.panelTitle}>Orders</h2>
        <p>
          <Link href={routes.accountOrders}>See your orders</Link> and their
          progress.
        </p>
      </div>

      <div className={shellStyles.panel}>
        <h2 className={shellStyles.panelTitle}>Default address</h2>
        {defaultAddress ? (
          <p className={shellStyles.cardBody}>
            {[
              defaultAddress.recipientName,
              defaultAddress.line1,
              `${defaultAddress.city} ${defaultAddress.postalCode}`,
            ].join("\n")}
          </p>
        ) : (
          <p>No address saved yet.</p>
        )}
        <p>
          <Link href={routes.accountAddresses}>Manage addresses</Link>
        </p>
      </div>
    </AccountShell>
  );
}
