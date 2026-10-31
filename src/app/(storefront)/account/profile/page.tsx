import type { Metadata } from "next";

import { AccountShell } from "@/components/account/AccountShell";
import { ProfileForm } from "@/components/account/ProfileForm";
import { requireUser } from "@/server/auth/current-user";

export const metadata: Metadata = {
  title: "Your details",
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <AccountShell user={user} title="Your details">
      <ProfileForm name={user.name} phone={user.phone} email={user.email} />
    </AccountShell>
  );
}
