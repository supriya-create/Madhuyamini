import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeReturnPath } from "@/features/auth/schemas";
import { getCurrentUser } from "@/server/auth/current-user";
import { REQUEST_PATH_HEADER } from "@/lib/request-headers";
import { routes } from "@/lib/routes";

/**
 * The real gate for the account area: the session is verified in the
 * database on every request. proxy.ts only redirects optimistically. A
 * visitor whose session lapsed on a deep page comes back to that page: the
 * proxy forwards the request path in a header it overwrites itself, and the
 * value is still run through `safeReturnPath` before it is trusted.
 */
export default async function AccountLayout({
  children,
}: LayoutProps<"/account">) {
  const user = await getCurrentUser();
  if (!user) {
    const requested = (await headers()).get(REQUEST_PATH_HEADER);
    const next = safeReturnPath(requested, routes.account);
    redirect(`${routes.login}?next=${encodeURIComponent(next)}`);
  }
  return children;
}
