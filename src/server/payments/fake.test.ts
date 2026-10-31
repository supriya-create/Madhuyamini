import { describe, expect, it } from "vitest";

import { createFakeGateway } from "./fake";
import { PaymentGatewayError } from "./gateway";

const order = (gateway = createFakeGateway(), receipt = "MY-TEST0001-1") =>
  gateway
    .createOrder({
      amountInPaise: 189_900,
      currency: "INR",
      receipt,
      notes: {},
    })
    .then((created) => ({ gateway, ...created }));

describe("fake payment gateway", () => {
  it("creates orders with unique receipts and finds them again by receipt", async () => {
    const { gateway, providerOrderId } = await order();
    expect(providerOrderId).toMatch(/^order_fake/);
    expect(await gateway.findOrderByReceipt("MY-TEST0001-1")).toEqual({
      providerOrderId,
    });
    expect(await gateway.findOrderByReceipt("MY-TEST0001-2")).toBeNull();
    await expect(
      gateway.createOrder({
        amountInPaise: 1,
        currency: "INR",
        receipt: "MY-TEST0001-1",
        notes: {},
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_DUPLICATE_RECEIPT" });
  });

  it("signs simulated payments the way the checkout callback would", async () => {
    const { gateway, providerOrderId } = await order();
    const { providerPaymentId, signature } = gateway.simulatePayment(
      providerOrderId,
      { status: "captured" },
    );
    expect(
      gateway.verifyCheckoutSignature(
        providerOrderId,
        providerPaymentId,
        signature,
      ),
    ).toBe(true);
    expect(
      gateway.verifyCheckoutSignature(providerOrderId, "pay_other", signature),
    ).toBe(false);
    expect(await gateway.fetchPayment(providerPaymentId)).toMatchObject({
      providerOrderId,
      status: "captured",
      amountInPaise: 189_900,
      currency: "INR",
    });
    expect(await gateway.fetchOrderPayments(providerOrderId)).toHaveLength(1);
    expect(await gateway.fetchPayment("pay_unknown")).toBeNull();
  });

  it("signs webhook bodies with the fake webhook secret", () => {
    const gateway = createFakeGateway();
    const body = '{"event":"payment.captured"}';
    expect(
      gateway.verifyWebhookSignature(body, gateway.signWebhook(body)),
    ).toBe(true);
    expect(
      gateway.verifyWebhookSignature(body + " ", gateway.signWebhook(body)),
    ).toBe(false);
  });

  it("injects failures, including a lost response after the side effect", async () => {
    const gateway = createFakeGateway();
    gateway.failNext("createOrder", { retryable: true });
    await expect(order(gateway)).rejects.toBeInstanceOf(PaymentGatewayError);
    // The failure was consumed; the next call succeeds.
    await order(gateway, "MY-TEST0002-1");

    gateway.failNext("createOrder", { afterEffect: true });
    await expect(order(gateway, "MY-TEST0003-1")).rejects.toMatchObject({
      retryable: true,
    });
    // The provider did create it, as a timed-out response would have.
    expect(await gateway.findOrderByReceipt("MY-TEST0003-1")).not.toBeNull();
  });

  it("refunds captured payments once per reference and lists them", async () => {
    const { gateway, providerOrderId } = await order();
    const { providerPaymentId } = gateway.simulatePayment(providerOrderId, {
      status: "captured",
    });
    const refund = await gateway.createRefund(providerPaymentId, {
      amountInPaise: 189_900,
      reference: "refund-1",
      notes: {},
    });
    expect(refund).toMatchObject({
      status: "processed",
      reference: "refund-1",
    });
    await expect(
      gateway.createRefund(providerPaymentId, {
        amountInPaise: 189_900,
        reference: "refund-1",
        notes: {},
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_DUPLICATE_RECEIPT" });
    expect(await gateway.listRefunds(providerPaymentId)).toEqual([refund]);
    expect((await gateway.fetchPayment(providerPaymentId))?.status).toBe(
      "refunded",
    );
  });

  it("refuses to refund a payment that was never captured", async () => {
    const { gateway, providerOrderId } = await order();
    const { providerPaymentId } = gateway.simulatePayment(providerOrderId, {
      status: "failed",
      errorCode: "BAD_REQUEST_ERROR",
    });
    await expect(
      gateway.createRefund(providerPaymentId, {
        amountInPaise: 1,
        reference: "refund-x",
        notes: {},
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_REJECTED" });
  });
});
