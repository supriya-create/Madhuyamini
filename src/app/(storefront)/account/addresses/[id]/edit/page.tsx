import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AccountShell } from "@/components/account/AccountShell";
import { AddressForm } from "@/components/account/AddressForm";
import { addressIdSchema } from "@/features/account/schemas";
import { getAddress } from "@/features/account/service";
import { requireUser } from "@/server/auth/current-user";
import { NotFoundError } from "@/server/errors";

export const metadata: Metadata = {
  title: "Edit address",
  robots: { index: false, follow: false },
};

export default async function EditAddressPage({
  params,
}: PageProps<"/account/addresses/[id]/edit">) {
  const user = await requireUser();
  const { id } = await params;
  const parsed = addressIdSchema.safeParse(id);
  if (!parsed.success) notFound();

  let address;
  try {
    address = await getAddress(user, parsed.data);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <AccountShell user={user} title="Edit address">
      <AddressForm address={address} />
    </AccountShell>
  );
}
