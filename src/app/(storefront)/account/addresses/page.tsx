import type { Metadata } from "next";

import { AccountShell } from "@/components/account/AccountShell";
import { AddressList } from "@/components/account/AddressList";
import { listAddresses } from "@/features/account/service";
import { requireUser } from "@/server/auth/current-user";

export const metadata: Metadata = {
  title: "Addresses",
  robots: { index: false, follow: false },
};

export default async function AddressesPage() {
  const user = await requireUser();
  const addresses = await listAddresses(user);
  return (
    <AccountShell user={user} title="Addresses">
      <AddressList addresses={addresses} />
    </AccountShell>
  );
}
