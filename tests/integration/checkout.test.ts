import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { checkoutPolicy } from "@/config/checkout-policy";
import * as cartData from "@/features/cart/data";
import { addToCart } from "@/features/cart/service";
import { getCheckoutView, placeOrder } from "@/features/checkout/service";
import type {
  AddressSnapshot,
  PlaceOrderInput,
} from "@/features/checkout/types";
import {
  OrderNotCancellableError,
  cancelPendingOrder,
  getOrderView,
  trackOrder,
} from "@/features/orders/service";
import {
  PaymentNotAllowedError,
  ensureProviderOrder,
  startPaymentAttempt,
} from "@/features/payments/service";
import { hashCartToken, generateCartToken } from "@/server/cart/token";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { hashOrderAccessToken } from "@/server/orders/token";
import { getFakeGateway } from "@/server/payments";

import {
  createCategory,
  createProduct,
  createUser,
  createVariant,
  resetDatabase,
  testDb,
} from "./db";

/**
 * Placement (T1/T2 + S2/S3), idempotency, provider recovery, attempts and
 * order access, against the real database and the fake gateway
 * (docs/checkout.md §5.5–§5.7, §10.1).
 */

const gateway = getFakeGateway();

beforeEach(async () => {
  await resetDatabase();
  gateway.reset();
});
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

const address: AddressSnapshot = {
  recipientName: "Asha Devi",
  line1: "12 Station Road",
  line2: null,
  landmark: null,
  city: "Madhubani",
  state: "Bihar",
  postalCode: "847211",
  country: "IN",
};

async function catalog(priceInPaise = 189_900, stockOnHand = 5, sku = "DUP-1") {
  const category = await createCategory(`cat-${sku}`);
  const product = await createProduct(category.id, `product-${sku}`);
  const variant = await createVariant(product.id, sku, priceInPaise);
  await testDb.inventory.update({
    where: { variantId: variant.id },
    data: { stockOnHand },
  });
  return { product, variant };
}

type Shopper =
  | {
      kind: "user";
      userId: string;
      token?: undefined;
      context: { kind: "user"; userId: string };
    }
  | {
      kind: "guest";
      userId?: undefined;
      token: string;
      context: { kind: "guest"; token: string };
    };

async function signedIn(email = "asha@example.com"): Promise<Shopper> {
  const user = await createUser(email);
  return {
    kind: "user",
    userId: user.id,
    context: { kind: "user", userId: user.id },
  };
}

function guest(): Shopper {
  const token = generateCartToken();
  return { kind: "guest", token, context: { kind: "guest", token } };
}

async function cartWith(
  shopper: Shopper,
  variantId: string,
  quantity = 1,
): Promise<string> {
  await addToCart(shopper.context, { variantId, quantity });
  const cart =
    shopper.kind === "user"
      ? await cartData.findActiveUserCart(shopper.userId)
      : await cartData.findActiveGuestCart(hashCartToken(shopper.token));
  if (!cart) throw new Error("cart missing");
  return cart.id;
}

async function placeInput(
  shopper: Shopper,
  paymentMethod: "RAZORPAY" | "COD",
  overrides: Partial<PlaceOrderInput> = {},
): Promise<PlaceOrderInput> {
  const view = await getCheckoutView(shopper.context);
  if (!view) throw new Error("checkout view missing");
  return {
    cartId: view.cartId,
    identity:
      shopper.kind === "user"
        ? { kind: "user", userId: shopper.userId }
        : { kind: "guest", tokenHash: hashCartToken(shopper.token) },
    customer: {
      userId: shopper.kind === "user" ? shopper.userId : null,
      email: shopper.kind === "user" ? "asha@example.com" : "guest@example.com",
      phone: "+919876543210",
    },
    address,
    paymentMethod,
    quoteHash: view.quotes[paymentMethod].hash,
    customerNote: null,
    ...overrides,
  };
}

async function levels(variantId: string) {
  const row = await testDb.inventory.findUniqueOrThrow({
    where: { variantId },
  });
  return { stockOnHand: row.stockOnHand, reserved: row.reserved };
}

describe("placing an online order", () => {
  it("snapshots the lines, holds stock, opens an attempt and gets a provider order", async () => {
    const { variant } = await catalog();
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 2);
    const now = new Date("2026-11-01T10:00:00Z");

    const outcome = await placeOrder(
      await placeInput(shopper, "RAZORPAY", { now }),
    );
    expect(outcome.kind).toBe("placed");
    if (outcome.kind !== "placed") return;
    expect(outcome.guestToken).toBeNull();
    expect(outcome.providerOrderId).toMatch(/^order_fake/);

    const order = await testDb.order.findUniqueOrThrow({
      where: { id: outcome.orderId },
      include: {
        items: true,
        payments: true,
        events: true,
        reservations: true,
      },
    });
    expect(order).toMatchObject({
      status: "PENDING_PAYMENT",
      paymentMethod: "RAZORPAY",
      userId: shopper.kind === "user" ? shopper.userId : null,
      email: "asha@example.com",
      subtotalInPaise: 379_800,
      shippingInPaise: 0, // ≥ ₹1,999
      totalInPaise: 379_800,
      taxInPaise: null, // D7c: no rates
      recipientName: "Asha Devi",
      postalCode: "847211",
    });
    expect(order.pendingExpiresAt?.getTime()).toBe(
      now.getTime() + checkoutPolicy.reservation.ttlMinutes * 60 * 1000,
    );
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({
      variantId: variant.id,
      sku: "DUP-1",
      quantity: 2,
      unitPriceInPaise: 189_900,
      lineTotalInPaise: 379_800,
    });
    expect(order.reservations).toHaveLength(1);
    expect(order.reservations[0]).toMatchObject({
      quantity: 2,
      status: "ACTIVE",
    });
    expect(await levels(variant.id)).toEqual({ stockOnHand: 5, reserved: 2 });
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]).toMatchObject({
      attemptNo: 1,
      method: "RAZORPAY",
      status: "CREATED",
      amountInPaise: 379_800,
      receipt: `${order.orderNumber}-1`,
      providerOrderId: outcome.providerOrderId,
    });
    expect(gateway.orders.get(outcome.providerOrderId!)).toMatchObject({
      amountInPaise: 379_800,
      receipt: `${order.orderNumber}-1`,
    });
    expect(order.events.map((e) => e.type)).toEqual([
      "order.placed",
      "payment.provider_order_created",
    ]);
    // The cart stays until the payment is confirmed.
    expect(
      (await testDb.cart.findUniqueOrThrow({ where: { id: order.cartId! } }))
        .status,
    ).toBe("ACTIVE");
    expect(await testDb.notificationOutbox.count()).toBe(0);
  });

  it("prices from the database at placement, never from the cart's seen price", async () => {
    const { variant } = await catalog(100_000);
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    await testDb.productVariant.update({
      where: { id: variant.id },
      data: { priceInPaise: 120_000 },
    });
    const outcome = await placeOrder(await placeInput(shopper, "RAZORPAY"));
    expect(outcome.kind).toBe("placed");
    const item = await testDb.orderItem.findFirstOrThrow();
    expect(item.unitPriceInPaise).toBe(120_000);
    const order = await testDb.order.findFirstOrThrow();
    expect(order.subtotalInPaise).toBe(120_000);
    expect(order.shippingInPaise).toBe(9_900);
    expect(order.totalInPaise).toBe(129_900);
  });

  it("refuses a quote the page no longer matches", async () => {
    const { variant } = await catalog();
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    const input = await placeInput(shopper, "RAZORPAY");
    await testDb.productVariant.update({
      where: { id: variant.id },
      data: { priceInPaise: 199_900 },
    });
    const outcome = await placeOrder(input);
    expect(outcome.kind).toBe("quote_changed");
    if (outcome.kind === "quote_changed")
      expect(outcome.quote.subtotalInPaise).toBe(199_900);
    expect(await testDb.order.count()).toBe(0);
  });

  it("refuses what can no longer be bought, and the last unit goes to one order", async () => {
    const { product, variant } = await catalog(189_900, 1);
    const asha = await signedIn("asha@example.com");
    const ravi = await signedIn("ravi@example.com");
    await cartWith(asha, variant.id, 1);
    await cartWith(ravi, variant.id, 1);
    const [first, second] = await Promise.all([
      placeInput(asha, "RAZORPAY"),
      placeInput(ravi, "RAZORPAY"),
    ]);
    const outcomes = await Promise.all([placeOrder(first), placeOrder(second)]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual([
      "not_purchasable",
      "placed",
    ]);
    expect(await levels(variant.id)).toEqual({ stockOnHand: 1, reserved: 1 });
    expect(await testDb.order.count()).toBe(1);

    await testDb.product.update({
      where: { id: product.id },
      data: { status: "ARCHIVED" },
    });
    const loser = outcomes[0].kind === "not_purchasable" ? asha : ravi;
    const again = await placeOrder(await placeInput(loser, "RAZORPAY"));
    expect(again.kind).toBe("not_purchasable");
  });

  it("refuses cash on delivery above the ceiling but not online payment", async () => {
    const { variant } = await catalog(600_000);
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    expect(await placeOrder(await placeInput(shopper, "COD"))).toEqual({
      kind: "refused",
      problem: "cod_over_limit",
    });
    expect((await placeOrder(await placeInput(shopper, "RAZORPAY"))).kind).toBe(
      "placed",
    );
  });
});

describe("placing a cash-on-delivery order as a guest", () => {
  it("confirms at once, sells the stock, converts the cart, queues the email and issues a token", async () => {
    const { variant } = await catalog(99_900);
    const shopper = guest();
    await cartWith(shopper, variant.id, 1);
    const now = new Date("2026-11-01T10:00:00Z");
    const outcome = await placeOrder(await placeInput(shopper, "COD", { now }));
    expect(outcome.kind).toBe("placed");
    if (outcome.kind !== "placed") return;
    expect(outcome.guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(outcome.providerOrderId).toBeNull();

    const order = await testDb.order.findUniqueOrThrow({
      where: { id: outcome.orderId },
      include: { payments: true, accessTokens: true, reservations: true },
    });
    expect(order).toMatchObject({
      status: "CONFIRMED",
      paymentMethod: "COD",
      userId: null,
      email: "guest@example.com",
      subtotalInPaise: 99_900,
      shippingInPaise: 9_900,
      codFeeInPaise: 0,
      totalInPaise: 109_800,
      confirmedAt: now,
      pendingExpiresAt: null,
    });
    expect(order.reservations).toHaveLength(0);
    expect(await levels(variant.id)).toEqual({ stockOnHand: 4, reserved: 0 });
    expect(order.payments[0]).toMatchObject({
      method: "COD",
      status: "CREATED",
    });
    expect(
      (await testDb.cart.findUniqueOrThrow({ where: { id: order.cartId! } }))
        .status,
    ).toBe("CONVERTED");
    const outbox = await testDb.notificationOutbox.findMany();
    expect(outbox.map((n) => [n.kind, n.recipient, n.dedupeKey])).toEqual([
      ["order.confirmed", "guest@example.com", `order.confirmed:${order.id}`],
      ["owner.new_order", "owner@example.com", `owner.new_order:${order.id}`],
    ]);
    expect(order.accessTokens).toHaveLength(1);
    expect(order.accessTokens[0]).toMatchObject({
      tokenHash: hashOrderAccessToken(outcome.guestToken!),
    });
    expect(order.accessTokens[0]!.tokenHash).not.toBe(outcome.guestToken);
    expect(order.accessTokens[0]!.expiresAt.getTime()).toBe(
      now.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
  });
});

describe("idempotency", () => {
  it("resumes the live order on a second submit, sequential or concurrent", async () => {
    const { variant } = await catalog(189_900, 10);
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    const input = await placeInput(shopper, "RAZORPAY");

    const first = await placeOrder(input);
    expect(first.kind).toBe("placed");
    const second = await placeOrder(input);
    expect(second).toMatchObject({
      kind: "resumed",
      orderId: first.kind === "placed" ? first.orderId : "",
      status: "PENDING_PAYMENT",
    });

    const concurrent = await Promise.all([
      placeOrder(input),
      placeOrder(input),
      placeOrder(input),
    ]);
    expect(concurrent.every((o) => o.kind === "resumed")).toBe(true);
    expect(await testDb.order.count()).toBe(1);
    expect(await testDb.inventoryReservation.count()).toBe(1);
    expect(await levels(variant.id)).toEqual({ stockOnHand: 10, reserved: 1 });
  });

  it("creates exactly one order when fresh submissions race", async () => {
    const { variant } = await catalog(189_900, 10);
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    const input = await placeInput(shopper, "RAZORPAY");
    const outcomes = await Promise.all([
      placeOrder(input),
      placeOrder(input),
      placeOrder(input),
    ]);
    expect(outcomes.filter((o) => o.kind === "placed")).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === "resumed")).toHaveLength(2);
    expect(await testDb.order.count()).toBe(1);
    expect(await testDb.payment.count()).toBe(1);
  });

  it("allows a new order for the cart once the pending one is cancelled", async () => {
    const { variant } = await catalog(189_900, 10);
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    const first = await placeOrder(await placeInput(shopper, "RAZORPAY"));
    if (first.kind !== "placed") throw new Error(first.kind);
    await cancelPendingOrder(
      { kind: "user", userId: shopper.userId! },
      first.orderId,
    );
    expect(await levels(variant.id)).toEqual({ stockOnHand: 10, reserved: 0 });

    const next = await placeOrder(await placeInput(shopper, "COD"));
    expect(next.kind).toBe("placed");
    expect(await testDb.order.count()).toBe(2);
  });

  it("rejects a cart that does not belong to the caller", async () => {
    const { variant } = await catalog();
    const asha = await signedIn("asha@example.com");
    const ravi = await signedIn("ravi@example.com");
    await cartWith(asha, variant.id, 1);
    const input = await placeInput(asha, "RAZORPAY");
    await expect(
      placeOrder({
        ...input,
        identity: { kind: "user", userId: ravi.userId! },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      placeOrder({
        ...input,
        identity: {
          kind: "guest",
          tokenHash: hashCartToken(generateCartToken()),
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await testDb.order.count()).toBe(0);
  });
});

describe("provider order recovery (S2/S3)", () => {
  it("keeps the order when the provider is down and recovers on the next try", async () => {
    const { variant } = await catalog();
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    gateway.failNext("createOrder", { retryable: true });
    const outcome = await placeOrder(await placeInput(shopper, "RAZORPAY"));
    expect(outcome.kind).toBe("placed");
    if (outcome.kind !== "placed") return;
    expect(outcome.providerOrderId).toBeNull();

    let attempt = await testDb.payment.findFirstOrThrow();
    expect(attempt).toMatchObject({
      status: "INITIATED",
      providerAttempts: 1,
      providerOrderId: null,
    });
    expect(attempt.lastError).toMatch(/createOrder failed/);
    expect(await levels(variant.id)).toEqual({ stockOnHand: 5, reserved: 1 });

    const recovered = await ensureProviderOrder(attempt.id);
    expect(recovered.status).toBe("CREATED");
    attempt = await testDb.payment.findFirstOrThrow();
    expect(attempt.providerOrderId).toBe(recovered.providerOrderId);
    expect(gateway.orders.size).toBe(1);
  });

  it("finds the provider order by receipt when the response was lost", async () => {
    const { variant } = await catalog();
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    gateway.failNext("createOrder", { retryable: true, afterEffect: true });
    const outcome = await placeOrder(await placeInput(shopper, "RAZORPAY"));
    if (outcome.kind !== "placed") throw new Error(outcome.kind);
    expect(outcome.providerOrderId).toBeNull();
    expect(gateway.orders.size).toBe(1);

    const attempt = await testDb.payment.findFirstOrThrow();
    const recovered = await ensureProviderOrder(attempt.id);
    const atProvider = await gateway.findOrderByReceipt(attempt.receipt);
    expect(recovered).toEqual({
      status: "CREATED",
      providerOrderId: atProvider?.providerOrderId,
    });
    // No second provider order was created for the same receipt.
    expect(gateway.orders.size).toBe(1);
    // And repeating the step is a no-op.
    expect(await ensureProviderOrder(attempt.id)).toEqual(recovered);
  });

  it("gives up on a non-retryable rejection and records why", async () => {
    const { variant } = await catalog();
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    gateway.failNext("createOrder", { retryable: false });
    const outcome = await placeOrder(await placeInput(shopper, "RAZORPAY"));
    if (outcome.kind !== "placed") throw new Error(outcome.kind);
    const attempt = await testDb.payment.findFirstOrThrow();
    expect(attempt.status).toBe("FAILED");
    const order = await testDb.order.findUniqueOrThrow({
      where: { id: outcome.orderId },
      include: { events: true },
    });
    expect(order.status).toBe("PENDING_PAYMENT");
    expect(order.events.map((e) => e.type)).toContain(
      "payment.provider_order_failed",
    );
  });
});

describe("further payment attempts", () => {
  it("opens the next attempt, extends the deadline once, and reuses an open one", async () => {
    const { variant } = await catalog();
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    const now = new Date("2026-11-01T10:00:00Z");
    const outcome = await placeOrder(
      await placeInput(shopper, "RAZORPAY", { now }),
    );
    if (outcome.kind !== "placed") throw new Error(outcome.kind);
    const first = await testDb.payment.findFirstOrThrow();

    // With an open attempt, nothing new is opened.
    const same = await startPaymentAttempt(outcome.orderId, now);
    expect(same.attemptId).toBe(first.id);
    expect(await testDb.payment.count()).toBe(1);

    await testDb.payment.update({
      where: { id: first.id },
      data: { status: "FAILED", failedAt: now },
    });
    const later = new Date(now.getTime() + 5 * 60 * 1000);
    const second = await startPaymentAttempt(outcome.orderId, later);
    expect(second.status).toBe("CREATED");
    expect(second.attemptId).not.toBe(first.id);
    const order = await testDb.order.findUniqueOrThrow({
      where: { id: outcome.orderId },
      include: {
        reservations: true,
        payments: { orderBy: { attemptNo: "asc" } },
      },
    });
    const extendedTo = now.getTime() + 30 * 60 * 1000; // 15 min TTL + one 15 min extension
    expect(order.pendingExpiresAt?.getTime()).toBe(extendedTo);
    expect(order.deadlineExtensions).toBe(1);
    expect(order.reservations[0]?.expiresAt.getTime()).toBe(extendedTo);
    expect(order.payments.map((p) => p.receipt)).toEqual([
      `${order.orderNumber}-1`,
      `${order.orderNumber}-2`,
    ]);

    await testDb.payment.update({
      where: { id: second.attemptId },
      data: { status: "FAILED", failedAt: later },
    });
    await startPaymentAttempt(outcome.orderId, later);
    const after = await testDb.order.findUniqueOrThrow({
      where: { id: outcome.orderId },
    });
    expect(after.deadlineExtensions).toBe(1);
    expect(after.pendingExpiresAt?.getTime()).toBe(extendedTo);
  });

  it("refuses once the window closed or the order is no longer pending", async () => {
    const { variant } = await catalog(99_900);
    const shopper = await signedIn();
    await cartWith(shopper, variant.id, 1);
    const now = new Date("2026-11-01T10:00:00Z");
    const online = await placeOrder(
      await placeInput(shopper, "RAZORPAY", { now }),
    );
    if (online.kind !== "placed") throw new Error(online.kind);
    await expect(
      startPaymentAttempt(
        online.orderId,
        new Date(now.getTime() + 60 * 60 * 1000),
      ),
    ).rejects.toBeInstanceOf(PaymentNotAllowedError);

    await cancelPendingOrder(
      { kind: "user", userId: shopper.userId! },
      online.orderId,
    );
    await expect(
      startPaymentAttempt(online.orderId, now),
    ).rejects.toBeInstanceOf(PaymentNotAllowedError);
  });
});

describe("who can see an order", () => {
  it("shows an order to its account owner only", async () => {
    const { variant } = await catalog();
    const asha = await signedIn("asha@example.com");
    const ravi = await signedIn("ravi@example.com");
    await cartWith(asha, variant.id, 1);
    const outcome = await placeOrder(await placeInput(asha, "RAZORPAY"));
    if (outcome.kind !== "placed") throw new Error(outcome.kind);

    const mine = await getOrderView(
      { kind: "user", userId: asha.userId! },
      outcome.orderId,
    );
    expect(mine).toMatchObject({
      orderNumber: outcome.orderNumber,
      exposure: "full",
      canPay: true,
      canCancel: true,
      contact: { email: "asha@example.com", phone: "+919876543210" },
    });
    expect(mine?.address.line1).toBe("12 Station Road");
    expect(
      await getOrderView(
        { kind: "user", userId: ravi.userId! },
        outcome.orderId,
      ),
    ).toBeNull();
    expect(
      await getOrderView({ kind: "anonymous" }, outcome.orderId),
    ).toBeNull();
    expect(
      await getOrderView(
        { kind: "guest", tokenHash: hashOrderAccessToken(generateCartToken()) },
        outcome.orderId,
      ),
    ).toBeNull();
  });

  it("gives guests full details for an hour, reduced details after, nothing when expired", async () => {
    const { variant } = await catalog(99_900);
    const shopper = guest();
    await cartWith(shopper, variant.id, 1);
    const now = new Date("2026-11-01T10:00:00Z");
    const outcome = await placeOrder(await placeInput(shopper, "COD", { now }));
    if (outcome.kind !== "placed" || !outcome.guestToken)
      throw new Error("no token");
    const access = {
      kind: "guest" as const,
      tokenHash: hashOrderAccessToken(outcome.guestToken),
    };

    const fresh = await getOrderView(access, outcome.orderId, now);
    expect(fresh).toMatchObject({
      exposure: "full",
      contact: { email: "guest@example.com", phone: "+919876543210" },
    });
    expect(fresh?.address.line1).toBe("12 Station Road");

    const later = await getOrderView(
      access,
      outcome.orderId,
      new Date(now.getTime() + 2 * 60 * 60 * 1000),
    );
    expect(later).toMatchObject({
      exposure: "reduced",
      contact: { email: "g****@example.com", phone: null },
      address: { line1: null, city: "Madhubani", postalCode: "847211" },
      customerNote: null,
    });
    expect(later?.items).toHaveLength(1);

    expect(
      await getOrderView(
        access,
        outcome.orderId,
        new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000),
      ),
    ).toBeNull();
  });

  it("tracks by number and email, rotating the token and revoking the old one", async () => {
    const { variant } = await catalog(99_900);
    const shopper = guest();
    await cartWith(shopper, variant.id, 1);
    const outcome = await placeOrder(await placeInput(shopper, "COD"));
    if (outcome.kind !== "placed" || !outcome.guestToken)
      throw new Error("no token");

    expect(
      await trackOrder({
        orderNumber: outcome.orderNumber,
        email: "other@example.com",
      }),
    ).toBeNull();
    expect(
      await trackOrder({
        orderNumber: "MY-ZZZZZZZZ",
        email: "guest@example.com",
      }),
    ).toBeNull();
    expect(
      await trackOrder({ orderNumber: "nonsense", email: "guest@example.com" }),
    ).toBeNull();

    const tracked = await trackOrder({
      orderNumber: outcome.orderNumber.toLowerCase(),
      email: "Guest@Example.com",
    });
    expect(tracked?.orderId).toBe(outcome.orderId);
    expect(tracked?.token).not.toBe(outcome.guestToken);

    const oldAccess = {
      kind: "guest" as const,
      tokenHash: hashOrderAccessToken(outcome.guestToken),
    };
    const newAccess = {
      kind: "guest" as const,
      tokenHash: hashOrderAccessToken(tracked!.token),
    };
    expect(await getOrderView(oldAccess, outcome.orderId)).toBeNull();
    expect((await getOrderView(newAccess, outcome.orderId))?.orderNumber).toBe(
      outcome.orderNumber,
    );
    const tokens = await testDb.orderAccessToken.findMany({
      where: { orderId: outcome.orderId },
      orderBy: { createdAt: "asc" },
    });
    expect(tokens.map((t) => t.revokedAt !== null)).toEqual([true, false]);
  });

  it("lets only the owner cancel, and only while payment is pending", async () => {
    const { variant } = await catalog(99_900);
    const asha = await signedIn("asha@example.com");
    const ravi = await signedIn("ravi@example.com");
    await cartWith(asha, variant.id, 1);
    const online = await placeOrder(await placeInput(asha, "RAZORPAY"));
    if (online.kind !== "placed") throw new Error(online.kind);

    await expect(
      cancelPendingOrder(
        { kind: "user", userId: ravi.userId! },
        online.orderId,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await cancelPendingOrder(
      { kind: "user", userId: asha.userId! },
      online.orderId,
    );
    const cancelled = await testDb.order.findUniqueOrThrow({
      where: { id: online.orderId },
      include: { reservations: true },
    });
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "CUSTOMER",
    });
    expect(cancelled.reservations[0]?.status).toBe("RELEASED");
    expect(await levels(variant.id)).toEqual({ stockOnHand: 5, reserved: 0 });
    expect(
      (
        await testDb.cart.findUniqueOrThrow({
          where: { id: cancelled.cartId! },
        })
      ).status,
    ).toBe("ACTIVE");
    await expect(
      cancelPendingOrder(
        { kind: "user", userId: asha.userId! },
        online.orderId,
      ),
    ).rejects.toBeInstanceOf(OrderNotCancellableError);

    const cod = await placeOrder(await placeInput(asha, "COD"));
    if (cod.kind !== "placed") throw new Error(cod.kind);
    await expect(
      cancelPendingOrder({ kind: "user", userId: asha.userId! }, cod.orderId),
    ).rejects.toBeInstanceOf(OrderNotCancellableError);
  });
});
