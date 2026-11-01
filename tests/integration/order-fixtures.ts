import { addToCart } from "@/features/cart/service";
import { getCheckoutView, placeOrder } from "@/features/checkout/service";
import type { AddressSnapshot } from "@/features/checkout/types";
import { applyCapture } from "@/features/payments/capture";

import {
  createCategory,
  createProduct,
  createUser,
  createVariant,
  testDb,
} from "./db";

/** Orders in the states the admin operates on, placed through the real checkout. */

export const fixtureAddress: AddressSnapshot = {
  recipientName: "Asha Devi",
  line1: "12 Station Road",
  line2: null,
  landmark: null,
  city: "Madhubani",
  state: "Bihar",
  postalCode: "847211",
  country: "IN",
};

export interface PlacedOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly variantId: string;
  readonly attemptId: string;
  readonly totalInPaise: number;
  readonly userId: string;
}

export async function placeTestOrder(
  method: "RAZORPAY" | "COD",
  options: {
    readonly stock?: number;
    readonly quantity?: number;
    readonly price?: number;
    readonly sku?: string;
    readonly email?: string;
  } = {},
): Promise<PlacedOrder> {
  const sku = options.sku ?? "ADM-1";
  const category = await createCategory(`cat-${sku}`);
  const product = await createProduct(category.id, `product-${sku}`);
  const variant = await createVariant(
    product.id,
    sku,
    options.price ?? 129_900,
  );
  await testDb.inventory.update({
    where: { variantId: variant.id },
    data: { stockOnHand: options.stock ?? 5 },
  });
  const email = options.email ?? `shopper-${sku.toLowerCase()}@example.com`;
  const user = await createUser(email);
  const context = { kind: "user" as const, userId: user.id };
  await addToCart(context, {
    variantId: variant.id,
    quantity: options.quantity ?? 1,
  });
  const view = await getCheckoutView(context);
  if (!view) throw new Error("no checkout view");
  const outcome = await placeOrder({
    cartId: view.cartId,
    identity: { kind: "user", userId: user.id },
    customer: { userId: user.id, email, phone: "+919876543210" },
    address: fixtureAddress,
    paymentMethod: method,
    quoteHash: view.quotes[method].hash,
    customerNote: null,
  });
  if (outcome.kind !== "placed")
    throw new Error(`placement failed: ${outcome.kind}`);
  const attempt = await testDb.payment.findFirstOrThrow({
    where: { orderId: outcome.orderId },
    orderBy: { attemptNo: "desc" },
  });
  return {
    orderId: outcome.orderId,
    orderNumber: outcome.orderNumber,
    variantId: variant.id,
    attemptId: attempt.id,
    totalInPaise: view.quotes[method].totalInPaise,
    userId: user.id,
  };
}

/** A paid online order: placed, then captured through the Phase 6 path. */
export async function confirmedOnlineOrder(
  options: Parameters<typeof placeTestOrder>[1] = {},
): Promise<PlacedOrder> {
  const placed = await placeTestOrder("RAZORPAY", options);
  const outcome = await applyCapture({
    attemptId: placed.attemptId,
    providerPaymentId: `pay_${placed.orderNumber}`,
    amountInPaise: placed.totalInPaise,
    currency: "INR",
    actor: "WEBHOOK",
    signatureVerified: true,
    now: new Date(),
  });
  if (outcome !== "confirmed") throw new Error(`capture outcome ${outcome}`);
  return placed;
}

export async function stockOf(variantId: string) {
  return testDb.inventory.findUniqueOrThrow({
    where: { variantId },
    select: { stockOnHand: true, reserved: true },
  });
}

export async function orderSnapshot(orderId: string) {
  const order = await testDb.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      payments: { orderBy: { attemptNo: "asc" } },
      refunds: { orderBy: { createdAt: "asc" } },
      reservations: true,
      shipment: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  const [outbox, adjustments, audit] = await Promise.all([
    testDb.notificationOutbox.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    }),
    testDb.inventoryAdjustment.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    }),
    testDb.adminAuditLog.findMany({
      where: { targetType: "order", targetId: orderId },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  return {
    order,
    outbox,
    adjustments,
    audit,
    eventTypes: order.events.map((event) => event.type),
    outboxKinds: outbox.map((row) => row.kind),
    auditOutcomes: audit.map((row) => [row.action, row.outcome] as const),
  };
}
