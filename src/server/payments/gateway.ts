import { AppError } from "@/server/errors";

/**
 * The payment provider as the application sees it (docs/checkout.md §6).
 * Services and jobs depend only on this interface; `razorpay.ts` talks to
 * the real API and `fake.ts` is deterministic for development and tests.
 * Amounts are integer paise throughout.
 */

export type GatewayPaymentStatus =
  "created" | "authorized" | "captured" | "refunded" | "failed" | "pending";

export interface GatewayPayment {
  readonly providerPaymentId: string;
  readonly providerOrderId: string | null;
  readonly status: GatewayPaymentStatus;
  readonly amountInPaise: number;
  readonly currency: string;
  readonly method: string | null;
  readonly errorCode: string | null;
  readonly errorDescription: string | null;
}

export type GatewayRefundStatus = "pending" | "processed" | "failed";

export interface GatewayRefund {
  readonly providerRefundId: string;
  readonly providerPaymentId: string;
  /** Our `refunds.reference`, echoed back as the provider's receipt. */
  readonly reference: string | null;
  readonly status: GatewayRefundStatus;
  readonly amountInPaise: number;
}

export interface CreateOrderInput {
  readonly amountInPaise: number;
  readonly currency: "INR";
  /** Unique per attempt; the provider rejects a duplicate, which makes retries safe. */
  readonly receipt: string;
  readonly notes: Readonly<Record<string, string>>;
}

export interface CreateRefundInput {
  readonly amountInPaise: number;
  readonly reference: string;
  readonly notes: Readonly<Record<string, string>>;
}

export interface PaymentGateway {
  readonly name: "razorpay" | "fake";
  /** Public key id for the hosted checkout. */
  readonly publicKeyId: string;
  createOrder(input: CreateOrderInput): Promise<{ providerOrderId: string }>;
  /** Recovery: the provider order created for a receipt whose response was lost. */
  findOrderByReceipt(
    receipt: string,
  ): Promise<{ providerOrderId: string } | null>;
  fetchPayment(providerPaymentId: string): Promise<GatewayPayment | null>;
  fetchOrderPayments(providerOrderId: string): Promise<GatewayPayment[]>;
  createRefund(
    providerPaymentId: string,
    input: CreateRefundInput,
  ): Promise<GatewayRefund>;
  listRefunds(providerPaymentId: string): Promise<GatewayRefund[]>;
  verifyCheckoutSignature(
    providerOrderId: string,
    providerPaymentId: string,
    signature: unknown,
  ): boolean;
  verifyWebhookSignature(rawBody: string, signature: unknown): boolean;
}

export type GatewayErrorCode =
  | "PAYMENT_NOT_CONFIGURED"
  | "PAYMENT_PROVIDER_UNAVAILABLE"
  | "PAYMENT_PROVIDER_REJECTED"
  | "PAYMENT_DUPLICATE_RECEIPT";

/** Provider failures; `retryable` tells the jobs whether backing off makes sense. */
export class PaymentGatewayError extends AppError {
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code: GatewayErrorCode; retryable: boolean; cause?: unknown },
  ) {
    super(message, {
      code: options.code,
      status: options.retryable ? 503 : 502,
      cause: options.cause,
    });
    this.retryable = options.retryable;
  }
}
