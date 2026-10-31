"use server";

import { revalidatePath } from "next/cache";

import { parseForm, pickFormValues } from "@/features/auth/form-data";
import { consumeRateLimit, rateLimitKey } from "@/server/auth/rate-limit";
import {
  issueGuestCartCookie,
  resolveCartContext,
} from "@/server/cart/context";
import type { CartContext } from "@/server/cart/context";
import { NotFoundError } from "@/server/errors";
import { routes } from "@/lib/routes";

import type { CartActionState } from "./action-state";
import { addToCartSchema, lineIdSchema, updateLineSchema } from "./schemas";
import * as service from "./service";

/**
 * Cart Server Actions. The cart is always taken from the request (session or
 * guest cookie), never from form input; line ids are checked against it.
 */

const CART_MUTATION_LIMIT = { windowSeconds: 60, max: 60 };

async function limitCartMutations(context: CartContext): Promise<boolean> {
  const identity =
    context.kind === "user"
      ? context.userId
      : context.kind === "guest"
        ? context.token
        : null;
  if (!identity) return true;
  const outcome = await consumeRateLimit(
    rateLimitKey("cart", identity),
    CART_MUTATION_LIMIT,
  );
  return outcome.allowed;
}

async function refreshCartViews(context: CartContext) {
  // C2: the cookie's life is renewed with the cart's expiry.
  if (context.kind === "guest") await issueGuestCartCookie(context.token);
  revalidatePath(routes.cart);
  // The header count lives in the storefront layout.
  revalidatePath("/", "layout");
}

export async function addToCartAction(
  _prev: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const parsed = parseForm(
    addToCartSchema,
    pickFormValues(formData, ["variantId", "quantity"]),
  );
  if (!parsed.ok)
    return { status: "error", message: "Choose a quantity between 1 and 10." };

  let context = await resolveCartContext();
  if (!(await limitCartMutations(context))) {
    return {
      status: "error",
      message: "Too many changes at once. Please wait a moment and try again.",
    };
  }
  if (context.kind === "anonymous") {
    context = { kind: "guest", token: await issueGuestCartCookie() };
  }

  try {
    const result = await service.addToCart(context, parsed.data);
    await refreshCartViews(context);
    if (result.quantityAdded === 0) {
      return {
        status: "error",
        itemCount: result.itemCount,
        message:
          result.limitedBy === "one_of_a_kind"
            ? "This one-of-a-kind piece is already in your cart."
            : result.limitedBy === "stock"
              ? `Only ${result.quantityInCart} available; your cart already has them.`
              : "You already have the maximum of 10 in your cart.",
      };
    }
    const limited =
      result.limitedBy === "stock"
        ? ` Only ${result.quantityInCart} available, so your cart now holds ${result.quantityInCart}.`
        : result.limitedBy === "max"
          ? " Your cart holds the maximum of 10."
          : "";
    return {
      status: "success",
      itemCount: result.itemCount,
      message: `Added to your cart.${limited}`,
    };
  } catch (error) {
    if (error instanceof service.CartItemUnavailableError)
      return { status: "error", message: error.message };
    throw error;
  }
}

export async function updateLineAction(formData: FormData): Promise<void> {
  const parsed = parseForm(
    updateLineSchema,
    pickFormValues(formData, ["lineId", "quantity"]),
  );
  if (!parsed.ok) return;
  const context = await resolveCartContext();
  if (!(await limitCartMutations(context))) return;
  try {
    await service.updateLine(context, parsed.data);
  } catch (error) {
    if (
      !(error instanceof NotFoundError) &&
      !(error instanceof service.CartItemUnavailableError)
    )
      throw error;
  }
  await refreshCartViews(context);
}

export async function removeLineAction(formData: FormData): Promise<void> {
  const parsed = parseForm(lineIdSchema, pickFormValues(formData, ["lineId"]));
  if (!parsed.ok) return;
  const context = await resolveCartContext();
  if (!(await limitCartMutations(context))) return;
  try {
    await service.removeLine(context, parsed.data.lineId);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  await refreshCartViews(context);
}

export async function acknowledgePriceAction(
  formData: FormData,
): Promise<void> {
  const parsed = parseForm(lineIdSchema, pickFormValues(formData, ["lineId"]));
  if (!parsed.ok) return;
  const context = await resolveCartContext();
  try {
    await service.acknowledgePrice(context, parsed.data.lineId);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  await refreshCartViews(context);
}
