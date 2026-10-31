import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optimistic redirect only: a missing session cookie means the account area
 * cannot possibly render, so send the visitor to sign in with a return path.
 * Presence of a cookie proves nothing; every account page verifies the
 * session in the database (src/server/auth/current-user.ts).
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*"],
};
