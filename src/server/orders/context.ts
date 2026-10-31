import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { daysToMs, getCheckoutPolicy } from "@/config/checkout-policy";
import { getCurrentUser } from "@/server/auth/current-user";
import { isProduction } from "@/server/env";

import {
  ORDER_ACCESS_COOKIE,
  hashOrderAccessToken,
  isPlausibleOrderAccessToken,
} from "./token";

/**
 * Who may see an order in this request: the signed-in customer (by user id,
 * never by cookie) or a guest holding the order-access cookie. Signed-in
 * customers never use the cookie (docs/checkout.md §10.1).
 */
export type OrderAccess =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "guest"; readonly tokenHash: string }
  | { readonly kind: "anonymous" };

export const orderCookieName = isProduction
  ? `__Host-${ORDER_ACCESS_COOKIE}`
  : ORDER_ACCESS_COOKIE;

export const resolveOrderAccess = cache(async (): Promise<OrderAccess> => {
  const user = await getCurrentUser();
  if (user) return { kind: "user", userId: user.id };
  const value = (await cookies()).get(orderCookieName)?.value;
  return isPlausibleOrderAccessToken(value)
    ? { kind: "guest", tokenHash: hashOrderAccessToken(value) }
    : { kind: "anonymous" };
});

/** Server Actions only (cookies cannot be set while rendering). */
export async function issueOrderAccessCookie(token: string): Promise<void> {
  const policy = getCheckoutPolicy();
  (await cookies()).set(orderCookieName, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(daysToMs(policy.guestAccess.tokenTtlDays) / 1000),
  });
}

export async function clearOrderAccessCookie(): Promise<void> {
  (await cookies()).delete({ name: orderCookieName, path: "/" });
}
