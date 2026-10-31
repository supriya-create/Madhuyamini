import { randomBytes } from "node:crypto";

import {
  FAKE_KEY_ID,
  FAKE_KEY_SECRET,
  FAKE_WEBHOOK_SECRET,
} from "./fake-secrets";
import { PaymentGatewayError } from "./gateway";
import type {
  CreateOrderInput,
  CreateRefundInput,
  GatewayPayment,
  GatewayPaymentStatus,
  GatewayRefund,
  PaymentGateway,
} from "./gateway";
import {
  hmacSha256Hex,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./signatures";

/**
 * In-process stand-in for Razorpay (development, integration and e2e tests;
 * refused in production by the env schema). It mirrors the provider rules the
 * application relies on: unique receipts, one capture per order, signatures
 * over the same messages. Tests steer it through `simulatePayment` and
 * `failNext`; nothing here is reachable from a request unless the pay page's
 * development-only panel calls it.
 */

type FakeOrder = {
  readonly id: string;
  readonly receipt: string;
  readonly amountInPaise: number;
  readonly currency: string;
};

type Operation = "createOrder" | "fetchPayment" | "createRefund";

type InjectedFailure = {
  readonly retryable: boolean;
  /** Perform the side effect first, then fail: a lost response. */
  readonly afterEffect: boolean;
};

export interface FakePaymentGateway extends PaymentGateway {
  readonly name: "fake";
  /** Records a customer outcome for an order and returns what the checkout callback would carry. */
  simulatePayment(
    providerOrderId: string,
    outcome: {
      readonly status: Extract<
        GatewayPaymentStatus,
        "captured" | "authorized" | "failed"
      >;
      /** Defaults to the order amount; tests use it to simulate a mismatch. */
      readonly amountInPaise?: number;
      readonly errorCode?: string;
      readonly errorDescription?: string;
    },
  ): { providerPaymentId: string; signature: string };
  /** Builds the webhook signature a Razorpay delivery would carry. */
  signWebhook(rawBody: string): string;
  /** Makes the next call to `operation` fail; with `afterEffect` the side effect happens first. */
  failNext(
    operation: Operation,
    options?: { readonly retryable?: boolean; readonly afterEffect?: boolean },
  ): void;
  /** Lets a payment move from authorized to captured (late capture scenarios). */
  capturePayment(providerPaymentId: string): void;
  reset(): void;
  readonly orders: ReadonlyMap<string, FakeOrder>;
}

export function createFakeGateway(): FakePaymentGateway {
  const orders = new Map<string, FakeOrder>();
  const receipts = new Map<string, string>();
  const payments = new Map<string, GatewayPayment>();
  const refunds = new Map<string, GatewayRefund>();
  const refundReferences = new Map<string, string>();
  const failures = new Map<Operation, InjectedFailure>();
  // Ids must stay unique across server restarts (they are stored with a
  // unique index), so each gateway instance carries its own random salt.
  const salt = randomBytes(3).toString("hex");
  let sequence = 0;
  const nextId = (prefix: string) =>
    `${prefix}_fake${salt}${(sequence += 1).toString().padStart(6, "0")}`;

  function takeFailure(operation: Operation): InjectedFailure | undefined {
    const failure = failures.get(operation);
    if (failure) failures.delete(operation);
    return failure;
  }

  function fail(operation: Operation, retryable: boolean): Promise<never> {
    return Promise.reject(
      new PaymentGatewayError(`fake gateway: ${operation} failed`, {
        code: retryable
          ? "PAYMENT_PROVIDER_UNAVAILABLE"
          : "PAYMENT_PROVIDER_REJECTED",
        retryable,
      }),
    );
  }

  function reject(
    code: "PAYMENT_DUPLICATE_RECEIPT" | "PAYMENT_PROVIDER_REJECTED",
    message: string,
  ): Promise<never> {
    return Promise.reject(
      new PaymentGatewayError(`fake gateway: ${message}`, {
        code,
        retryable: false,
      }),
    );
  }

  const gateway: FakePaymentGateway = {
    name: "fake",
    publicKeyId: FAKE_KEY_ID,
    orders,

    createOrder(input: CreateOrderInput) {
      const injected = takeFailure("createOrder");
      if (injected && !injected.afterEffect)
        return fail("createOrder", injected.retryable);
      if (receipts.has(input.receipt))
        return reject("PAYMENT_DUPLICATE_RECEIPT", "receipt already used");
      const id = nextId("order");
      orders.set(id, {
        id,
        receipt: input.receipt,
        amountInPaise: input.amountInPaise,
        currency: input.currency,
      });
      receipts.set(input.receipt, id);
      if (injected) return fail("createOrder", injected.retryable);
      return Promise.resolve({ providerOrderId: id });
    },

    findOrderByReceipt(receipt) {
      const id = receipts.get(receipt);
      return Promise.resolve(id ? { providerOrderId: id } : null);
    },

    fetchPayment(providerPaymentId) {
      const injected = takeFailure("fetchPayment");
      if (injected) return fail("fetchPayment", injected.retryable);
      return Promise.resolve(payments.get(providerPaymentId) ?? null);
    },

    fetchOrderPayments(providerOrderId) {
      return Promise.resolve(
        [...payments.values()].filter(
          (payment) => payment.providerOrderId === providerOrderId,
        ),
      );
    },

    createRefund(providerPaymentId, input: CreateRefundInput) {
      const injected = takeFailure("createRefund");
      if (injected && !injected.afterEffect)
        return fail("createRefund", injected.retryable);
      // A repeated request with our reference is the "lost response" case the
      // refund job recovers from; it must look like a duplicate, not a refusal.
      if (refundReferences.has(input.reference))
        return reject(
          "PAYMENT_DUPLICATE_RECEIPT",
          "refund receipt already used",
        );
      const payment = payments.get(providerPaymentId);
      if (!payment || payment.status !== "captured")
        return reject("PAYMENT_PROVIDER_REJECTED", "payment not captured");
      const refund: GatewayRefund = {
        providerRefundId: nextId("rfnd"),
        providerPaymentId,
        reference: input.reference,
        status: "processed",
        amountInPaise: input.amountInPaise,
      };
      refunds.set(refund.providerRefundId, refund);
      refundReferences.set(input.reference, refund.providerRefundId);
      payments.set(providerPaymentId, { ...payment, status: "refunded" });
      if (injected) return fail("createRefund", injected.retryable);
      return Promise.resolve(refund);
    },

    listRefunds(providerPaymentId) {
      return Promise.resolve(
        [...refunds.values()].filter(
          (refund) => refund.providerPaymentId === providerPaymentId,
        ),
      );
    },

    verifyCheckoutSignature(providerOrderId, providerPaymentId, signature) {
      return verifyCheckoutSignature({
        keySecret: FAKE_KEY_SECRET,
        providerOrderId,
        providerPaymentId,
        signature,
      });
    },

    verifyWebhookSignature(rawBody, signature) {
      return verifyWebhookSignature({
        secrets: [FAKE_WEBHOOK_SECRET],
        rawBody,
        signature,
      });
    },

    simulatePayment(providerOrderId, outcome) {
      const order = orders.get(providerOrderId);
      if (!order)
        throw new Error(`fake gateway: unknown order ${providerOrderId}`);
      const providerPaymentId = nextId("pay");
      payments.set(providerPaymentId, {
        providerPaymentId,
        providerOrderId,
        status: outcome.status,
        amountInPaise: outcome.amountInPaise ?? order.amountInPaise,
        currency: order.currency,
        method: "upi",
        errorCode: outcome.errorCode ?? null,
        errorDescription: outcome.errorDescription ?? null,
      });
      return {
        providerPaymentId,
        signature: hmacSha256Hex(
          FAKE_KEY_SECRET,
          `${providerOrderId}|${providerPaymentId}`,
        ),
      };
    },

    signWebhook(rawBody) {
      return hmacSha256Hex(FAKE_WEBHOOK_SECRET, rawBody);
    },

    failNext(operation, options = {}) {
      failures.set(operation, {
        retryable: options.retryable ?? true,
        afterEffect: options.afterEffect ?? false,
      });
    },

    capturePayment(providerPaymentId) {
      const payment = payments.get(providerPaymentId);
      if (!payment)
        throw new Error(`fake gateway: unknown payment ${providerPaymentId}`);
      payments.set(providerPaymentId, { ...payment, status: "captured" });
    },

    reset() {
      orders.clear();
      receipts.clear();
      payments.clear();
      refunds.clear();
      refundReferences.clear();
      failures.clear();
    },
  };

  return gateway;
}
