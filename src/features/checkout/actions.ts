"use server";

import { redirect } from "next/navigation";

import type { OrderStatus } from "@/generated/prisma/enums";
import { z } from "zod";

import { getCheckoutPolicy } from "@/config/checkout-policy";
import { createAddress, findAddress } from "@/features/account/data";
import { parseForm, pickFormValues } from "@/features/auth/form-data";
import type { FormState } from "@/features/auth/schemas";
import {
  OrderNotCancellableError,
  cancelPendingOrder,
  findAccessibleOrder,
  trackOrder,
} from "@/features/orders/service";
import { findOpenAttempt } from "@/features/payments/data";
import {
  PaymentNotAllowedError,
  confirmFromCallback,
  recordModalFailure,
  startPaymentAttempt,
} from "@/features/payments/service";
import type { CallbackOutcome } from "@/features/payments/service";
import {
  getCurrentUser,
  requestClientAddress,
} from "@/server/auth/current-user";
import { consumeRateLimit, rateLimitKey } from "@/server/auth/rate-limit";
import { readGuestCartToken } from "@/server/cart/context";
import { hashCartToken } from "@/server/cart/token";
import { NotFoundError } from "@/server/errors";
import {
  issueOrderAccessCookie,
  resolveOrderAccess,
} from "@/server/orders/context";
import { getFakeGateway, isFakeGateway } from "@/server/payments";
import { routes } from "@/lib/routes";

import {
  confirmPaymentSchema,
  orderIdSchema,
  paymentFailureSchema,
  placeOrderFormSchema,
  trackOrderSchema,
} from "./schemas";
import { placeOrder } from "./service";
import type { AddressSnapshot } from "./types";

/**
 * Checkout Server Actions (docs/checkout.md §7). The cart and the order are
 * always resolved from the request's identity; the form contributes choices
 * and ids only. Every amount is recomputed in the service.
 */

const PLACE_ORDER_FIELDS = [
  "cartId",
  "email",
  "phone",
  "paymentMethod",
  "customerNote",
  "addressId",
  "recipientName",
  "line1",
  "line2",
  "landmark",
  "city",
  "state",
  "postalCode",
  "saveAddress",
] as const;

function failure(message: string): FormState {
  return { status: "error", message };
}

const TOO_MANY = "Too many attempts. Please wait a minute and try again.";

export async function placeOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = pickFormValues(formData, PLACE_ORDER_FIELDS);
  // The page carries one hash per payment method; the server picks the one
  // that matches the chosen method and recomputes it (P12).
  const hashField = formData.get(`quoteHash:${values.paymentMethod}`);
  const parsed = parseForm(placeOrderFormSchema, {
    ...values,
    quoteHash: typeof hashField === "string" ? hashField : "",
  });
  if (!parsed.ok) return parsed.state;
  const form = parsed.data;

  const user = await getCurrentUser();
  const guestToken = user ? null : await readGuestCartToken();
  if (!user && !guestToken) {
    return failure(
      "Your cart could not be found. Please add your pieces again.",
    );
  }

  const policy = getCheckoutPolicy();
  const identity = user ? user.id : (guestToken ?? "");
  const [byIdentity, byIp] = await Promise.all([
    consumeRateLimit(
      rateLimitKey("place-order", identity),
      policy.rateLimits.placeOrder,
    ),
    consumeRateLimit(
      rateLimitKey("place-order:ip", await requestClientAddress()),
      policy.rateLimits.placeOrderByIp,
    ),
  ]);
  if (!byIdentity.allowed || !byIp.allowed) return failure(TOO_MANY);

  let address: AddressSnapshot;
  if (form.addressId) {
    if (!user) {
      return {
        status: "error",
        message: "Sign in to use a saved address.",
        fieldErrors: { addressId: "Sign in to use a saved address." },
      };
    }
    const saved = await findAddress(user.id, form.addressId);
    if (!saved) {
      return {
        status: "error",
        message: "That saved address is no longer available.",
        fieldErrors: { addressId: "Choose another address." },
      };
    }
    address = {
      recipientName: saved.recipientName,
      line1: saved.line1,
      line2: saved.line2,
      landmark: saved.landmark,
      city: saved.city,
      state: saved.state,
      postalCode: saved.postalCode,
      country: saved.country,
    };
  } else if (form.address) {
    address = form.address;
    if (user && form.saveAddress) {
      await createAddress(user.id, {
        label: null,
        recipientName: address.recipientName,
        phone: form.phone,
        line1: address.line1,
        line2: address.line2,
        landmark: address.landmark,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: "IN",
        isDefault: false,
      });
    }
  } else {
    return failure("Enter a delivery address.");
  }

  let outcome;
  try {
    outcome = await placeOrder({
      cartId: form.cartId,
      identity: user
        ? { kind: "user", userId: user.id }
        : { kind: "guest", tokenHash: hashCartToken(guestToken ?? "") },
      customer: {
        userId: user?.id ?? null,
        email: user ? user.email : form.email,
        phone: form.phone,
      },
      address,
      paymentMethod: form.paymentMethod,
      quoteHash: form.quoteHash,
      customerNote: form.customerNote,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return failure(
        "Your cart could not be found. Please start again from the cart.",
      );
    }
    throw error;
  }

  switch (outcome.kind) {
    case "placed":
      if (outcome.guestToken) await issueOrderAccessCookie(outcome.guestToken);
      redirect(
        outcome.paymentMethod === "COD"
          ? `${routes.checkoutConfirmation(outcome.orderId)}?placed=1`
          : routes.checkoutPay(outcome.orderId),
      );
    case "resumed":
      redirect(
        outcome.status === "PENDING_PAYMENT"
          ? routes.checkoutPay(outcome.orderId)
          : routes.checkoutConfirmation(outcome.orderId),
      );
    case "quote_changed":
      return failure(
        "The prices or totals changed while you were checking out. Please review the updated summary and place the order again.",
      );
    case "not_purchasable":
      redirect(`${routes.cart}?issue=availability`);
    case "refused":
      switch (outcome.problem) {
        case "empty":
          return failure("Your cart is empty.");
        case "below_minimum":
          return failure(
            "The order total is below the minimum for online payment.",
          );
        case "cod_disabled":
          return failure("Cash on delivery is not available at the moment.");
        case "cod_over_limit":
          return failure(
            "Cash on delivery is available for orders up to the limit shown. Please pay online for this order.",
          );
      }
  }
}

/** The order for this request's identity, or a redirect to sign in / the cart. */
async function requireAccessibleOrder(orderId: string) {
  const access = await resolveOrderAccess();
  const found = await findAccessibleOrder(access, orderId);
  if (!found) {
    if (access.kind === "anonymous") {
      redirect(
        `${routes.login}?next=${encodeURIComponent(routes.accountOrders)}`,
      );
    }
    redirect(routes.cart);
  }
  return found;
}

export async function startPaymentAttemptAction(
  formData: FormData,
): Promise<void> {
  const parsed = parseForm(
    orderIdSchema,
    pickFormValues(formData, ["orderId"]),
  );
  if (!parsed.ok) return;
  const { orderId } = parsed.data;
  await requireAccessibleOrder(orderId);
  const policy = getCheckoutPolicy();
  const limit = await consumeRateLimit(
    rateLimitKey("start-attempt", orderId),
    policy.rateLimits.startAttempt,
  );
  if (!limit.allowed) redirect(`${routes.checkoutPay(orderId)}?limited=1`);
  try {
    await startPaymentAttempt(orderId);
  } catch (error) {
    if (error instanceof PaymentNotAllowedError) {
      redirect(routes.checkoutConfirmation(orderId));
    }
    throw error;
  }
  redirect(routes.checkoutPay(orderId));
}

function redirectForCallback(orderId: string, outcome: CallbackOutcome): never {
  switch (outcome.kind) {
    case "confirmed":
      redirect(`${routes.checkoutConfirmation(orderId)}?placed=1`);
    case "confirming":
      redirect(routes.checkoutConfirming(orderId));
    case "failed":
      redirect(`${routes.checkoutPay(orderId)}?failed=1`);
    case "invalid":
      redirect(`${routes.checkoutPay(orderId)}?invalid=1`);
  }
}

export async function confirmPaymentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    confirmPaymentSchema,
    pickFormValues(formData, [
      "orderId",
      "razorpay_order_id",
      "razorpay_payment_id",
      "razorpay_signature",
    ]),
  );
  if (!parsed.ok) return failure("We could not read the payment details.");
  const { orderId } = parsed.data;
  await requireAccessibleOrder(orderId);
  const policy = getCheckoutPolicy();
  const limit = await consumeRateLimit(
    rateLimitKey("confirm-payment", orderId),
    policy.rateLimits.confirmPayment,
  );
  if (!limit.allowed) return failure(TOO_MANY);

  const outcome = await confirmFromCallback({
    orderId,
    providerOrderId: parsed.data.razorpay_order_id,
    providerPaymentId: parsed.data.razorpay_payment_id,
    signature: parsed.data.razorpay_signature,
  });
  if (outcome.kind === "invalid") {
    return failure(
      "We could not verify this payment. If money was taken, it will be matched to your order automatically; nothing further is needed from you.",
    );
  }
  redirectForCallback(orderId, outcome);
}

export async function recordPaymentFailureAction(
  formData: FormData,
): Promise<void> {
  const parsed = parseForm(
    paymentFailureSchema,
    pickFormValues(formData, [
      "orderId",
      "razorpay_order_id",
      "razorpay_payment_id",
      "code",
      "description",
    ]),
  );
  if (!parsed.ok) return;
  const { orderId } = parsed.data;
  await requireAccessibleOrder(orderId);
  await recordModalFailure({
    orderId,
    providerOrderId: parsed.data.razorpay_order_id || null,
    providerPaymentId: parsed.data.razorpay_payment_id || null,
    code: parsed.data.code || null,
    description: parsed.data.description || null,
  });
  redirect(`${routes.checkoutPay(orderId)}?failed=1`);
}

export async function cancelPendingOrderAction(
  formData: FormData,
): Promise<void> {
  const parsed = parseForm(
    orderIdSchema,
    pickFormValues(formData, ["orderId"]),
  );
  if (!parsed.ok) return;
  const { orderId } = parsed.data;
  await requireAccessibleOrder(orderId);
  try {
    await cancelPendingOrder(await resolveOrderAccess(), orderId);
  } catch (error) {
    if (error instanceof OrderNotCancellableError) {
      redirect(routes.checkoutConfirmation(orderId));
    }
    throw error;
  }
  redirect(`${routes.cart}?order=cancelled`);
}

export interface OrderStatusSnapshot {
  readonly status: OrderStatus;
  readonly latestPaymentStatus: string | null;
}

/** Polled by the confirming page. */
export async function checkOrderStatusAction(
  orderId: string,
): Promise<OrderStatusSnapshot | null> {
  const parsed = orderIdSchema.safeParse({ orderId });
  if (!parsed.success) return null;
  const access = await resolveOrderAccess();
  const found = await findAccessibleOrder(access, parsed.data.orderId);
  if (!found) return null;
  return {
    status: found.row.status,
    latestPaymentStatus: found.row.payments[0]?.status ?? null,
  };
}

export async function trackOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseForm(
    trackOrderSchema,
    pickFormValues(formData, ["orderNumber", "email"]),
  );
  if (!parsed.ok) return parsed.state;
  const policy = getCheckoutPolicy();
  const [byIp, byEmail] = await Promise.all([
    consumeRateLimit(
      rateLimitKey("track-order:ip", await requestClientAddress()),
      policy.rateLimits.trackOrderByIp,
    ),
    consumeRateLimit(
      rateLimitKey("track-order:email", parsed.data.email),
      policy.rateLimits.trackOrderByEmail,
    ),
  ]);
  if (!byIp.allowed || !byEmail.allowed) return failure(TOO_MANY);

  const found = await trackOrder(parsed.data);
  if (!found) {
    return failure(
      "We could not find an order with that number and email address.",
    );
  }
  await issueOrderAccessCookie(found.token);
  redirect(routes.checkoutConfirmation(found.orderId));
}

const simulateSchema = z
  .object({
    orderId: z.string().uuid(),
    outcome: z.enum(["captured", "authorized", "failed", "captured_silently"]),
  })
  .strict();

/**
 * Development and test only (PAYMENT_GATEWAY=fake): records an outcome at
 * the fake provider and, unless "silently", runs the same callback path the
 * real checkout would. Does nothing with the real gateway.
 */
export async function simulatePaymentAction(formData: FormData): Promise<void> {
  if (!isFakeGateway()) return;
  const parsed = simulateSchema.safeParse(
    pickFormValues(formData, ["orderId", "outcome"]),
  );
  if (!parsed.success) return;
  const { orderId, outcome } = parsed.data;
  await requireAccessibleOrder(orderId);
  const attempt = await findOpenAttempt(orderId);
  if (!attempt?.providerOrderId) redirect(routes.checkoutPay(orderId));

  const fake = getFakeGateway();
  const status = outcome === "captured_silently" ? "captured" : outcome;
  const simulated = fake.simulatePayment(attempt.providerOrderId, {
    status,
    errorCode: status === "failed" ? "BAD_REQUEST_ERROR" : undefined,
    errorDescription:
      status === "failed" ? "Payment declined (simulated)" : undefined,
  });
  if (outcome === "captured_silently") {
    // Tests then deliver the webhook themselves; the ids are not secrets.
    const query = new URLSearchParams({
      simulated: simulated.providerPaymentId,
      providerOrder: attempt.providerOrderId,
    });
    redirect(`${routes.checkoutPay(orderId)}?${query.toString()}`);
  }

  const result = await confirmFromCallback({
    orderId,
    providerOrderId: attempt.providerOrderId,
    providerPaymentId: simulated.providerPaymentId,
    signature: simulated.signature,
  });
  redirectForCallback(orderId, result);
}
