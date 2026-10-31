import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { getCurrentUser } from "@/server/auth/current-user";
import { isProduction } from "@/server/env";

import {
  GUEST_CART_COOKIE,
  generateCartToken,
  isPlausibleCartToken,
} from "./token";

/**
 * Who the cart belongs to for this request. Signed-in customers are always
 * identified by their session, never by the guest cookie (requirement 4).
 */
export type CartContext =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "guest"; readonly token: string }
  | { readonly kind: "anonymous" };

/** `__Host-` binds the cookie to this origin and path in production (needs HTTPS). */
export const cartCookieName = isProduction
  ? `__Host-${GUEST_CART_COOKIE}`
  : GUEST_CART_COOKIE;

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export async function readGuestCartToken(): Promise<string | null> {
  const value = (await cookies()).get(cartCookieName)?.value;
  return isPlausibleCartToken(value) ? value : null;
}

export const resolveCartContext = cache(async (): Promise<CartContext> => {
  const user = await getCurrentUser();
  if (user) return { kind: "user", userId: user.id };
  const token = await readGuestCartToken();
  return token ? { kind: "guest", token } : { kind: "anonymous" };
});

/**
 * Sets (or, with an existing token, renews) the guest cart cookie so its
 * lifetime tracks the cart's own 30-day expiry (C2). Server Actions only:
 * cookies cannot be set while rendering.
 */
export async function issueGuestCartCookie(
  token = generateCartToken(),
): Promise<string> {
  (await cookies()).set(cartCookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS_SECONDS,
  });
  return token;
}

export async function clearGuestCartCookie(): Promise<void> {
  (await cookies()).delete({ name: cartCookieName, path: "/" });
}
