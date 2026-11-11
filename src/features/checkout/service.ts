import "server-only";

import { daysToMs, getCheckoutPolicy } from "@/config/checkout-policy";
import { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { findAddresses } from "@/features/account/data";
import * as cartData from "@/features/cart/data";
import { toCartView } from "@/features/cart/service";
import type { CartLineView } from "@/features/cart/types";
import { StockUnavailableError } from "@/features/inventory/service";
import * as orders from "@/features/orders/data";
import { createOrderFromLines } from "@/features/orders/placement";
import { ensureProviderOrder } from "@/features/payments/service";
import { NotFoundError } from "@/server/errors";
import {
  generateOrderAccessToken,
  hashOrderAccessToken,
} from "@/server/orders/token";
import { hashCartToken } from "@/server/cart/token";
import type { CartContext } from "@/server/cart/context";
import { db } from "@/server/db";

import { buildQuote, codRefusal, quoteProblem } from "./rules";
import type { Quote, QuoteLine } from "./rules";
import type {
  CheckoutPaymentMethod,
  CheckoutView,
  PlaceOrderInput,
  PlaceOrderOutcome,
} from "./types";

/**
 * Checkout (docs/checkout.md §5.5–§5.7). `placeOrder` is transaction T1/T2
 * followed, for online orders, by the provider steps S2/S3 outside any
 * transaction. The cart is the idempotency key: its row lock serialises
 * submissions and the one-live-order-per-cart index backs that up.
 */

function toQuoteLines(lines: readonly CartLineView[]): QuoteLine[] {
  return lines.map((line) => ({
    variantId: line.variant.id,
    quantity: line.quantity,
    unitPriceInPaise: line.unitPriceInPaise,
    isOneOfAKind: line.product.isOneOfAKind,
  }));
}

/** Everything the checkout page shows, for the request's cart. */
export async function getCheckoutView(
  context: CartContext,
): Promise<CheckoutView | null> {
  const policy = getCheckoutPolicy();
  const cart =
    context.kind === "user"
      ? await cartData.findActiveUserCart(context.userId)
      : context.kind === "guest"
        ? await cartData.findActiveGuestCart(hashCartToken(context.token))
        : null;
  if (!cart) return null;
  const view = toCartView(cart);
  const lines = toQuoteLines(view.lines);
  const quotes: Record<CheckoutPaymentMethod, Quote> = {
    RAZORPAY: buildQuote(policy, lines, "RAZORPAY"),
    COD: buildQuote(policy, lines, "COD"),
  };
  const addresses =
    context.kind === "user" ? await findAddresses(context.userId) : [];
  return {
    cartId: cart.id,
    cart: view,
    lines: view.lines,
    quotes,
    codRefusal: codRefusal(
      policy.cod,
      quotes.COD.subtotalInPaise + quotes.COD.shippingInPaise,
    ),
    belowMinimum: quotes.RAZORPAY.totalInPaise < policy.payment.minOrderInPaise,
    addresses,
  };
}

type Placed = Extract<PlaceOrderOutcome, { kind: "placed" }> & {
  readonly attemptId: string | null;
};

type TransactionOutcome =
  Placed | Exclude<PlaceOrderOutcome, { kind: "placed" }>;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderOutcome> {
  const now = input.now ?? new Date();
  const guestToken =
    input.identity.kind === "guest" ? generateOrderAccessToken() : null;

  let outcome: TransactionOutcome | null = null;
  // One retry covers the two unique indexes a race can hit: the order number
  // (astronomically rare) and one-live-order-per-cart (a concurrent submit).
  for (let attempt = 0; attempt < 2 && outcome === null; attempt += 1) {
    try {
      outcome = await db.$transaction((tx) =>
        placeInTransaction(tx, input, now, guestToken),
      );
    } catch (error) {
      if (error instanceof StockUnavailableError) {
        return { kind: "not_purchasable", variantIds: [error.variantId] };
      }
      if (isUniqueViolation(error)) {
        const live = await orders.findLiveOrderForCart(input.cartId);
        if (live) return resumed(live);
        continue;
      }
      throw error;
    }
  }
  if (outcome === null) {
    throw new Error("Order placement kept colliding; please try again.");
  }

  if (outcome.kind !== "placed") return outcome;
  const { attemptId, ...placed } = outcome;
  if (attemptId === null) return placed;

  // S2/S3: the provider order, outside the transaction. Failure is recorded
  // on the attempt and the pay page offers a retry; the order stands.
  const provider = await ensureProviderOrder(attemptId, now);
  return { ...placed, providerOrderId: provider.providerOrderId };
}

function resumed(live: {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: PaymentMethod;
}): Extract<PlaceOrderOutcome, { kind: "resumed" }> {
  return {
    kind: "resumed",
    orderId: live.id,
    orderNumber: live.orderNumber,
    paymentMethod: live.paymentMethod,
    status:
      live.status === "CONFIRMED"
        ? "CONFIRMED"
        : live.status === "NEEDS_REVIEW"
          ? "NEEDS_REVIEW"
          : "PENDING_PAYMENT",
  };
}

async function placeInTransaction(
  tx: Prisma.TransactionClient,
  input: PlaceOrderInput,
  now: Date,
  guestToken: string | null,
): Promise<TransactionOutcome> {
  const policy = getCheckoutPolicy();

  // Lock order (1): the cart row.
  await cartData.lockCart(input.cartId, tx);
  const cart = await cartData.findCartById(input.cartId, tx);
  const owned =
    cart !== null &&
    (input.identity.kind === "user"
      ? cart.userId === input.identity.userId
      : cart.userId === null && cart.tokenHash === input.identity.tokenHash);
  if (!cart || !owned) throw new NotFoundError("Cart");

  const live = await orders.findLiveOrderForCart(cart.id, tx);
  if (live) return resumed(live);
  if (cart.status !== "ACTIVE") throw new NotFoundError("Cart");

  const view = toCartView(cart);
  if (!view.canCheckout) {
    return {
      kind: "not_purchasable",
      variantIds: view.lines
        .filter((line) => line.availability !== "ok")
        .map((line) => line.variant.id),
    };
  }

  const quote = buildQuote(
    policy,
    toQuoteLines(view.lines),
    input.paymentMethod,
  );
  if (quote.hash !== input.quoteHash) return { kind: "quote_changed", quote };
  const problem = quoteProblem(policy, quote);
  if (problem) return { kind: "refused", problem };

  const products = await tx.product.findMany({
    where: { id: { in: view.lines.map((line) => line.product.id) } },
    select: { id: true, taxRateBp: true, hsnCode: true },
  });
  const taxByProduct = new Map(products.map((p) => [p.id, p]));
  const lines = view.lines.map((line) => {
    const tax = taxByProduct.get(line.product.id);
    return {
      variantId: line.variant.id,
      productSlug: line.product.slug,
      productTitle: line.product.title,
      variantTitle: line.variant.title,
      sku: line.variant.sku,
      quantity: line.quantity,
      unitPriceInPaise: line.unitPriceInPaise,
      taxRateBp: tax?.taxRateBp ?? null,
      hsnCode: tax?.hsnCode ?? null,
      imageUrl: line.product.image?.url ?? null,
      imageAlt: line.product.image?.alt ?? null,
    };
  });

  // Order rows, items, stock, first attempt, event and e-mail: the shared
  // placement path (Phase 8 step 8.0), still inside the cart's lock.
  const placed = await createOrderFromLines(tx, {
    kind: "STANDARD",
    links: {
      exchangeOfOrderId: null,
      commissionRequestId: null,
      instalment: null,
    },
    paymentMethod: input.paymentMethod,
    lines,
    amounts: {
      subtotalInPaise: quote.subtotalInPaise,
      shippingInPaise: quote.shippingInPaise,
      codFeeInPaise: quote.codFeeInPaise,
      discountInPaise: quote.discountInPaise,
      totalInPaise: quote.totalInPaise,
    },
    stock: "manage",
    customer: input.customer,
    address: input.address,
    customerNote: input.customerNote,
    cartId: cart.id,
    now,
  });

  if (placed.status === "CONFIRMED") {
    await tx.cart.update({
      where: { id: cart.id },
      data: { status: "CONVERTED" },
    });
  }

  if (guestToken) {
    await orders.createAccessToken(tx, {
      orderId: placed.orderId,
      tokenHash: hashOrderAccessToken(guestToken),
      expiresAt: new Date(
        now.getTime() + daysToMs(policy.guestAccess.tokenTtlDays),
      ),
      createdAt: now,
    });
  }

  return {
    kind: "placed",
    orderId: placed.orderId,
    orderNumber: placed.orderNumber,
    paymentMethod: input.paymentMethod,
    guestToken,
    providerOrderId: null,
    attemptId: placed.attemptId,
  };
}
