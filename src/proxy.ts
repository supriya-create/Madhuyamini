import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ADMIN_PATH_HEADER } from "@/lib/request-headers";

/**
 * Optimistic redirect only: a missing session cookie means the account and
 * admin areas cannot possibly render, so send the visitor to sign in with a
 * return path. Presence of a cookie proves nothing; every account page
 * verifies the session in the database (src/server/auth/current-user.ts) and
 * every admin read and mutation requires a verified StaffContext
 * (src/server/auth/staff.ts).
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  // The admin layout has no access to the URL; it reads the path from this
  // header, which is overwritten here so a client cannot supply its own.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(ADMIN_PATH_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*"],
};
