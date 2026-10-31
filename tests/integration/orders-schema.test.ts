import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";

import {
  createCategory,
  createProduct,
  createUser,
  createVariant,
  resetDatabase,
  testDb,
} from "./db";

/**
 * Migration 6 invariants (docs/checkout.md §3): amounts, state/timestamp
 * pairs, snapshots, one live order per cart, one open attempt per order, and
 * the queue tables' bounds. Each test aims one write at one rule.
 */

beforeEach(resetDatabase);
afterAll(() => testDb.$disconnect());

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

function orderData(
  overrides: Partial<Prisma.OrderUncheckedCreateInput> = {},
): Prisma.OrderUncheckedCreateInput {
  return {
    orderNumber: "MY-TEST0001",
    email: "asha@example.com",
    phone: "+919876543210",
    status: "PENDING_PAYMENT",
    paymentMethod: "RAZORPAY",
    subtotalInPaise: 189_900,
    shippingInPaise: 9_900,
    codFeeInPaise: 0,
    discountInPaise: 0,
    totalInPaise: 199_800,
    recipientName: "Asha Devi",
    addressLine1: "12 Station Road",
    city: "Madhubani",
    state: "Bihar",
    postalCode: "847211",
    pendingExpiresAt: inAnHour(),
    ...overrides,
  };
}

const createOrder = (overrides?: Partial<Prisma.OrderUncheckedCreateInput>) =>
  testDb.order.create({ data: orderData(overrides), select: { id: true } });

describe("orders", () => {
  it("rejects totals that do not add up and negative amounts", async () => {
    await expect(createOrder({ totalInPaise: 199_801 })).rejects.toThrow(
      /orders_total_consistent/,
    );
    await expect(
      createOrder({ shippingInPaise: -1, totalInPaise: 189_899 }),
    ).rejects.toThrow(/orders_amounts_non_negative/);
    await expect(createOrder({ taxInPaise: 199_801 })).rejects.toThrow(
      /orders_tax_within_total/,
    );
  });

  it("ties statuses to their timestamps and reasons", async () => {
    await expect(createOrder({ pendingExpiresAt: null })).rejects.toThrow(
      /orders_pending_has_deadline/,
    );
    await expect(
      createOrder({ status: "CONFIRMED", pendingExpiresAt: null }),
    ).rejects.toThrow(/orders_confirmed_has_timestamp/);
    await expect(
      createOrder({ status: "CANCELLED", pendingExpiresAt: null }),
    ).rejects.toThrow(/orders_cancelled_has_reason/);
    await expect(
      createOrder({ cancellationReason: "CUSTOMER" }),
    ).rejects.toThrow(/orders_cancelled_has_reason/);
    await createOrder({
      status: "CANCELLED",
      cancellationReason: "PAYMENT_TIMEOUT",
      cancelledAt: new Date(),
      pendingExpiresAt: null,
    });
  });

  it("stores emails lower-cased only", async () => {
    await expect(createOrder({ email: "Asha@Example.com" })).rejects.toThrow(
      /orders_email_lowercase/,
    );
  });

  it("allows one live order per cart, and a new one once the old is cancelled", async () => {
    const user = await createUser();
    const cart = await testDb.cart.create({
      data: { userId: user.id },
      select: { id: true },
    });
    const first = await createOrder({ cartId: cart.id, userId: user.id });
    await expect(
      createOrder({
        cartId: cart.id,
        userId: user.id,
        orderNumber: "MY-TEST0002",
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await testDb.order.update({
      where: { id: first.id },
      data: {
        status: "CANCELLED",
        cancellationReason: "CUSTOMER",
        cancelledAt: new Date(),
      },
    });
    await createOrder({
      cartId: cart.id,
      userId: user.id,
      orderNumber: "MY-TEST0002",
    });
    // A confirmed order still counts as live.
    await expect(
      createOrder({
        cartId: cart.id,
        userId: user.id,
        orderNumber: "MY-TEST0003",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("keeps the order when its customer account is deleted", async () => {
    const user = await createUser();
    const order = await createOrder({ userId: user.id });
    await testDb.user.delete({ where: { id: user.id } });
    const kept = await testDb.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(kept.userId).toBeNull();
  });
});

describe("order items", () => {
  it("snapshot a positive quantity and a consistent line total, and pin the variant", async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const variant = await createVariant(product.id);
    const order = await createOrder();
    const item = (overrides: Partial<Prisma.OrderItemUncheckedCreateInput>) =>
      testDb.orderItem.create({
        data: {
          orderId: order.id,
          variantId: variant.id,
          productSlug: "test-product",
          productTitle: "Test product",
          sku: "TEST-SKU-1",
          quantity: 2,
          unitPriceInPaise: 100_000,
          lineTotalInPaise: 200_000,
          ...overrides,
        },
      });
    await expect(item({ quantity: 0, lineTotalInPaise: 0 })).rejects.toThrow(
      /order_items_quantity_positive/,
    );
    await expect(item({ lineTotalInPaise: 199_999 })).rejects.toThrow(
      /order_items_prices_consistent/,
    );
    await expect(item({ taxRateBp: 10_001 })).rejects.toThrow(
      /order_items_tax_rate_range/,
    );
    await item({});
    await expect(
      testDb.productVariant.delete({ where: { id: variant.id } }),
    ).rejects.toThrow();
  });
});

describe("payments", () => {
  const payment = async (
    orderId: string,
    overrides: Partial<Prisma.PaymentUncheckedCreateInput> = {},
  ) =>
    testDb.payment.create({
      data: {
        orderId,
        attemptNo: 1,
        method: "RAZORPAY",
        status: "INITIATED",
        amountInPaise: 199_800,
        receipt: "MY-TEST0001-1",
        ...overrides,
      },
      select: { id: true },
    });

  it("needs a positive amount and attempt number", async () => {
    const order = await createOrder();
    await expect(payment(order.id, { amountInPaise: 0 })).rejects.toThrow(
      /payments_amount_positive/,
    );
    await expect(payment(order.id, { attemptNo: 0 })).rejects.toThrow(
      /payments_attempt_no_positive/,
    );
  });

  it("requires provider ids once an online attempt advances, and forbids them for COD", async () => {
    const order = await createOrder();
    await expect(payment(order.id, { status: "CREATED" })).rejects.toThrow(
      /payments_created_has_provider_order/,
    );
    await expect(
      payment(order.id, { status: "CAPTURED", providerOrderId: "order_x" }),
    ).rejects.toThrow(/payments_captured_has_payment_id/);
    await expect(
      payment(order.id, { method: "COD", providerOrderId: "order_x" }),
    ).rejects.toThrow(/payments_cod_has_no_provider_ids/);
    await payment(order.id, {
      status: "CAPTURED",
      providerOrderId: "order_x",
      providerPaymentId: "pay_x",
    });
  });

  it("allows one open attempt per order at a time", async () => {
    const order = await createOrder();
    const first = await payment(order.id);
    await expect(
      payment(order.id, { attemptNo: 2, receipt: "MY-TEST0001-2" }),
    ).rejects.toMatchObject({ code: "P2002" });
    await testDb.payment.update({
      where: { id: first.id },
      data: { status: "FAILED", failedAt: new Date() },
    });
    await payment(order.id, { attemptNo: 2, receipt: "MY-TEST0001-2" });
    await expect(
      payment(order.id, { attemptNo: 2, receipt: "MY-TEST0001-3" }),
    ).rejects.toMatchObject({ code: "P2002" }); // attempt numbers are unique too
  });
});

describe("queues and tokens", () => {
  it("bounds attempts on the outbox, webhook ledger and refunds", async () => {
    const order = await createOrder();
    await expect(
      testDb.notificationOutbox.create({
        data: {
          kind: "order.confirmed",
          dedupeKey: `order.confirmed:${order.id}`,
          orderId: order.id,
          recipient: "asha@example.com",
          payload: {},
          attempts: 11,
        },
      }),
    ).rejects.toThrow(/notification_outbox_attempts_bounded/);
    await expect(
      testDb.paymentWebhookEvent.create({
        data: {
          id: "evt_1",
          eventType: "payment.captured",
          payload: {},
          attempts: 11,
        },
      }),
    ).rejects.toThrow(/webhook_events_attempts_bounded/);
    const pay = await testDb.payment.create({
      data: {
        orderId: order.id,
        attemptNo: 1,
        method: "RAZORPAY",
        status: "CAPTURED",
        amountInPaise: 199_800,
        receipt: "MY-TEST0001-1",
        providerOrderId: "order_x",
        providerPaymentId: "pay_x",
      },
    });
    await expect(
      testDb.refund.create({
        data: {
          orderId: order.id,
          paymentId: pay.id,
          amountInPaise: 0,
          reason: "test",
          reference: "rf-1",
        },
      }),
    ).rejects.toThrow(/refunds_amount_positive/);
    await expect(
      testDb.refund.create({
        data: {
          orderId: order.id,
          paymentId: pay.id,
          amountInPaise: 1,
          reason: "test",
          reference: "rf-1",
          status: "REQUESTED",
        },
      }),
    ).rejects.toThrow(/refunds_requested_has_provider_id/);
  });

  it("dedupes notifications by key and webhook events by id", async () => {
    const order = await createOrder();
    const row = {
      kind: "order.confirmed",
      dedupeKey: `order.confirmed:${order.id}`,
      orderId: order.id,
      recipient: "asha@example.com",
      payload: {},
    };
    await testDb.notificationOutbox.create({ data: row });
    await expect(
      testDb.notificationOutbox.create({ data: row }),
    ).rejects.toMatchObject({ code: "P2002" });
    const event = { id: "evt_dup", eventType: "payment.captured", payload: {} };
    await testDb.paymentWebhookEvent.create({ data: event });
    await expect(
      testDb.paymentWebhookEvent.create({ data: event }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("requires access tokens to expire after they are issued", async () => {
    const order = await createOrder();
    await expect(
      testDb.orderAccessToken.create({
        data: {
          orderId: order.id,
          tokenHash: "h".repeat(43),
          expiresAt: new Date(Date.now() - 1000),
        },
      }),
    ).rejects.toThrow(/order_access_tokens_expiry_after_issue/);
  });
});
