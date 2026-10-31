import "server-only";

import type { RazorpayConfig } from "@/server/env-schema";

import { PaymentGatewayError } from "./gateway";
import type {
  CreateOrderInput,
  CreateRefundInput,
  GatewayPayment,
  GatewayPaymentStatus,
  GatewayRefund,
  GatewayRefundStatus,
  PaymentGateway,
} from "./gateway";
import { verifyCheckoutSignature, verifyWebhookSignature } from "./signatures";

/**
 * Razorpay over its REST API (docs/checkout.md §6). Four read-only lookups
 * and two writes; Basic auth with the key pair. No SDK: the official one adds
 * a transitive HTTP client for what is a handful of JSON calls.
 */

const API_BASE = "https://api.razorpay.com/v1";
const REQUEST_TIMEOUT_MS = 10 * 1000; // policy-literal-ok: HTTP timeout, not a business rule

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const PAYMENT_STATUSES: readonly GatewayPaymentStatus[] = [
  "created",
  "authorized",
  "captured",
  "refunded",
  "failed",
  "pending",
];

function toPayment(entity: Json): GatewayPayment {
  const status = entity.status;
  return {
    providerPaymentId: String(entity.id),
    providerOrderId: stringOrNull(entity.order_id),
    status: PAYMENT_STATUSES.find((known) => known === status) ?? "pending",
    amountInPaise: numberOrZero(entity.amount),
    currency: typeof entity.currency === "string" ? entity.currency : "",
    method: stringOrNull(entity.method),
    errorCode: stringOrNull(entity.error_code),
    errorDescription: stringOrNull(entity.error_description),
  };
}

const REFUND_STATUSES: readonly GatewayRefundStatus[] = [
  "pending",
  "processed",
  "failed",
];

function toRefund(entity: Json): GatewayRefund {
  const status = entity.status;
  return {
    providerRefundId: String(entity.id),
    providerPaymentId: String(entity.payment_id),
    reference: stringOrNull(entity.receipt),
    status: REFUND_STATUSES.find((known) => known === status) ?? "pending",
    amountInPaise: numberOrZero(entity.amount),
  };
}

export function createRazorpayGateway(config: RazorpayConfig): PaymentGateway {
  const authorization = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString("base64")}`;

  async function call(
    method: "GET" | "POST",
    path: string,
    body?: Json,
  ): Promise<Json> {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (cause) {
      throw new PaymentGatewayError("Razorpay could not be reached.", {
        code: "PAYMENT_PROVIDER_UNAVAILABLE",
        retryable: true,
        cause,
      });
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (response.ok) {
      if (!isRecord(payload)) {
        throw new PaymentGatewayError("Razorpay returned an unexpected body.", {
          code: "PAYMENT_PROVIDER_REJECTED",
          retryable: false,
        });
      }
      return payload;
    }

    // Razorpay error shape: { error: { code, description, field, reason } }.
    const error =
      isRecord(payload) && isRecord(payload.error) ? payload.error : {};
    const reason = stringOrNull(error.reason) ?? stringOrNull(error.code);
    const description =
      stringOrNull(error.description) ?? `HTTP ${response.status}`;
    const retryable = response.status >= 500 || response.status === 429;
    const duplicateReceipt =
      !retryable &&
      /receipt/i.test(description) &&
      /already|duplicate|exists/i.test(description);
    throw new PaymentGatewayError(
      `Razorpay rejected the request: ${description}`,
      {
        code: duplicateReceipt
          ? "PAYMENT_DUPLICATE_RECEIPT"
          : retryable
            ? "PAYMENT_PROVIDER_UNAVAILABLE"
            : "PAYMENT_PROVIDER_REJECTED",
        retryable,
        cause: reason,
      },
    );
  }

  function items(payload: Json): Json[] {
    return Array.isArray(payload.items) ? payload.items.filter(isRecord) : [];
  }

  return {
    name: "razorpay",
    publicKeyId: config.keyId,

    async createOrder(input: CreateOrderInput) {
      const order = await call("POST", "/orders", {
        amount: input.amountInPaise,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      });
      return { providerOrderId: String(order.id) };
    },

    async findOrderByReceipt(receipt) {
      const list = await call(
        "GET",
        `/orders?receipt=${encodeURIComponent(receipt)}&count=1`,
      );
      const first = items(list)[0];
      return first ? { providerOrderId: String(first.id) } : null;
    },

    async fetchPayment(providerPaymentId) {
      try {
        return toPayment(
          await call(
            "GET",
            `/payments/${encodeURIComponent(providerPaymentId)}`,
          ),
        );
      } catch (error) {
        if (
          error instanceof PaymentGatewayError &&
          error.code === "PAYMENT_PROVIDER_REJECTED"
        )
          return null;
        throw error;
      }
    },

    async fetchOrderPayments(providerOrderId) {
      const list = await call(
        "GET",
        `/orders/${encodeURIComponent(providerOrderId)}/payments`,
      );
      return items(list).map(toPayment);
    },

    async createRefund(providerPaymentId, input: CreateRefundInput) {
      return toRefund(
        await call(
          "POST",
          `/payments/${encodeURIComponent(providerPaymentId)}/refund`,
          {
            amount: input.amountInPaise,
            receipt: input.reference,
            notes: input.notes,
          },
        ),
      );
    },

    async listRefunds(providerPaymentId) {
      const list = await call(
        "GET",
        `/payments/${encodeURIComponent(providerPaymentId)}/refunds`,
      );
      return items(list).map(toRefund);
    },

    verifyCheckoutSignature(providerOrderId, providerPaymentId, signature) {
      return verifyCheckoutSignature({
        keySecret: config.keySecret,
        providerOrderId,
        providerPaymentId,
        signature,
      });
    },

    verifyWebhookSignature(rawBody, signature) {
      return verifyWebhookSignature({
        secrets: config.webhookSecrets,
        rawBody,
        signature,
      });
    },
  };
}
