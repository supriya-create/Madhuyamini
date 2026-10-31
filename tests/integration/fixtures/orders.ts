import { addToCart } from "@/features/cart/service";
import { getCheckoutView, placeOrder } from "@/features/checkout/service";
import type { AddressSnapshot } from "@/features/checkout/types";
import { generateCartToken, hashCartToken } from "@/server/cart/token";

import {
  createCategory,
  createProduct,
  createUser,
  createVariant,
  testDb,
} from "../db";

/** Shared order fixtures for the payments and jobs suites. */

export const testAddress: AddressSnapshot = {
  recipientName: "Asha Devi",
  line1: "12 Station Road",
  line2: null,
  landmark: null,
  city: "Madhubani",
  state: "Bihar",
  postalCode: "847211",
  country: "IN",
};

let sequence = 0;

export async function stockedVariant(
  options: { price?: number; stock?: number } = {},
) {
  sequence += 1;
  const sku = `SKU-${sequence}`;
  const category = await createCategory(`cat-${sku}`);
  const product = await createProduct(category.id, `product-${sku}`);
  const variant = await createVariant(
    product.id,
    sku,
    options.price ?? 189_900,
  );
  await testDb.inventory.update({
    where: { variantId: variant.id },
    data: { stockOnHand: options.stock ?? 5 },
  });
  return { productId: product.id, variantId: variant.id };
}

export interface PlacedFixture {
  readonly userId: string | null;
  readonly guestToken: string | null;
  readonly variantId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly providerOrderId: string | null;
  readonly attemptId: string;
  readonly cartId: string;
  readonly totalInPaise: number;
  readonly email: string;
}

/** A signed-in customer's pending online order with its provider order (unless placement was made to fail). */
export async function placePendingOrder(
  options: {
    stock?: number;
    price?: number;
    email?: string;
    quantity?: number;
  } = {},
): Promise<PlacedFixture> {
  const { variantId } = await stockedVariant(options);
  const email = options.email ?? `asha-${sequence}@example.com`;
  const user = await createUser(email);
  const context = { kind: "user" as const, userId: user.id };
  await addToCart(context, { variantId, quantity: options.quantity ?? 1 });
  const view = await getCheckoutView(context);
  if (!view) throw new Error("no checkout view");
  const outcome = await placeOrder({
    cartId: view.cartId,
    identity: { kind: "user", userId: user.id },
    customer: { userId: user.id, email, phone: "+919876543210" },
    address: testAddress,
    paymentMethod: "RAZORPAY",
    quoteHash: view.quotes.RAZORPAY.hash,
    customerNote: null,
  });
  if (outcome.kind !== "placed") throw new Error(`placement: ${outcome.kind}`);
  const attempt = await testDb.payment.findFirstOrThrow({
    where: { orderId: outcome.orderId },
  });
  return {
    userId: user.id,
    guestToken: null,
    variantId,
    orderId: outcome.orderId,
    orderNumber: outcome.orderNumber,
    providerOrderId: outcome.providerOrderId,
    attemptId: attempt.id,
    cartId: view.cartId,
    totalInPaise: view.quotes.RAZORPAY.totalInPaise,
    email,
  };
}

/** A guest's cash-on-delivery order (confirmed at once, emails queued). */
export async function placeCodGuestOrder(
  options: { price?: number; stock?: number } = {},
): Promise<PlacedFixture> {
  const { variantId } = await stockedVariant({ price: 99_900, ...options });
  const token = generateCartToken();
  const context = { kind: "guest" as const, token };
  await addToCart(context, { variantId, quantity: 1 });
  const view = await getCheckoutView(context);
  if (!view) throw new Error("no checkout view");
  const email = `guest-${sequence}@example.com`;
  const outcome = await placeOrder({
    cartId: view.cartId,
    identity: { kind: "guest", tokenHash: hashCartToken(token) },
    customer: { userId: null, email, phone: "+919876543210" },
    address: testAddress,
    paymentMethod: "COD",
    quoteHash: view.quotes.COD.hash,
    customerNote: null,
  });
  if (outcome.kind !== "placed") throw new Error(`placement: ${outcome.kind}`);
  const attempt = await testDb.payment.findFirstOrThrow({
    where: { orderId: outcome.orderId },
  });
  return {
    userId: null,
    guestToken: outcome.guestToken,
    variantId,
    orderId: outcome.orderId,
    orderNumber: outcome.orderNumber,
    providerOrderId: null,
    attemptId: attempt.id,
    cartId: view.cartId,
    totalInPaise: view.quotes.COD.totalInPaise,
    email,
  };
}
