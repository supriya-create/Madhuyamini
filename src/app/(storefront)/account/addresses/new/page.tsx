import type { Metadata } from "next";

import { AccountShell } from "@/components/account/AccountShell";
import { AddressForm } from "@/components/account/AddressForm";
import { requireUser } from "@/server/auth/current-user";

export const metadata: Metadata = {
  title: "Add an address",
  robots: { index: false, follow: false },
};

export default async function NewAddressPage() {
  const user = await requireUser();
  return (
    <AccountShell user={user} title="Add an address">
      <AddressForm />
    </AccountShell>
  );
}
