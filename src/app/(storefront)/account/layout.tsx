import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/current-user";
import { routes } from "@/lib/routes";

/**
 * The real gate for the account area: the session is verified in the
 * database on every request. proxy.ts only redirects optimistically.
 */
export default async function AccountLayout({
  children,
}: LayoutProps<"/account">) {
  const user = await getCurrentUser();
  if (!user)
    redirect(`${routes.login}?next=${encodeURIComponent(routes.account)}`);
  return children;
}
