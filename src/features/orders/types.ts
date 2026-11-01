import type {
  CancellationReason,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from "@/generated/prisma/enums";

import type { OrderDetailRow, OrderSummaryRow } from "./data";

/**
 * Customer-facing order views. Pages render these, never Prisma rows, and a
 * guest view never carries more than docs/checkout.md §10.1 allows.
 */

export interface OrderItemView {
  readonly id: string;
  readonly productSlug: string;
  readonly productTitle: string;
  readonly variantTitle: string | null;
  readonly sku: string;
  readonly quantity: number;
  readonly unitPriceInPaise: number;
  readonly lineTotalInPaise: number;
  readonly image: { readonly url: string; readonly alt: string } | null;
}

export interface OrderAddressView {
  readonly recipientName: string;
  /** Null when the view is reduced (guest lookups after the first hour). */
  readonly line1: string | null;
  readonly line2: string | null;
  readonly landmark: string | null;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
}

export interface OrderTimelineEntry {
  readonly id: string;
  readonly at: Date;
  readonly label: string;
}

export interface OrderDetailView {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly statusLabel: string;
  readonly paymentMethod: PaymentMethod;
  readonly placedAt: Date;
  readonly confirmedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancellationReason: CancellationReason | null;
  readonly pendingExpiresAt: Date | null;
  readonly items: readonly OrderItemView[];
  readonly subtotalInPaise: number;
  readonly shippingInPaise: number;
  readonly codFeeInPaise: number;
  readonly discountInPaise: number;
  readonly totalInPaise: number;
  readonly taxInPaise: number | null;
  readonly address: OrderAddressView;
  readonly contact: {
    /** Masked unless the viewer owns the account. */
    readonly email: string;
    readonly phone: string | null;
  };
  readonly customerNote: string | null;
  readonly payment: {
    readonly latestStatus: PaymentStatus | null;
    readonly attemptCount: number;
    /** Last four characters of the provider payment id, for support conversations. */
    readonly reference: string | null;
    readonly failureDescription: string | null;
  };
  readonly canPay: boolean;
  readonly canCancel: boolean;
  readonly timeline: readonly OrderTimelineEntry[];
  readonly exposure: "full" | "reduced";
}

export interface OrderSummaryView {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly statusLabel: string;
  readonly paymentMethod: PaymentMethod;
  readonly totalInPaise: number;
  readonly placedAt: Date;
  readonly itemCount: number;
  readonly firstItem: {
    readonly title: string;
    readonly image: { readonly url: string; readonly alt: string } | null;
  } | null;
  readonly awaitingPayment: boolean;
}

export const orderStatusLabels: Readonly<Record<OrderStatus, string>> = {
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  NEEDS_REVIEW: "Being checked",
  PROCESSING: "Being prepared",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  DELIVERY_FAILED: "Delivery unsuccessful",
  RETURNED: "Returned to us",
};

const timelineLabels: Readonly<Record<string, string>> = {
  "order.placed": "Order placed",
  "order.confirmed": "Payment received and order confirmed",
  "order.cancelled": "Order cancelled",
  "order.deadline_extended": "Payment window extended",
  "order.needs_review": "Payment is being checked",
  "payment.attempt_opened": "Payment attempt started",
  "payment.failed": "Payment did not go through",
  "payment.captured": "Payment received",
  "payment.late_capture": "Payment received after the deadline",
  "refund.requested": "Refund requested",
  "refund.processed": "Refund completed",
  "order.processing": "Being prepared for dispatch",
  "order.shipped": "Shipped",
  "order.delivered": "Delivered",
  "order.delivery_failed": "Delivery was unsuccessful; parcel returning to us",
  "order.returned": "Parcel received back",
  "payment.cod_collected": "Cash collected on delivery",
};

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(local.length - 1, 2))}@${domain}`;
}

export function toOrderDetailView(
  row: OrderDetailRow,
  exposure: "full" | "reduced",
  now: Date,
): OrderDetailView {
  const latest = row.payments[0] ?? null;
  const full = exposure === "full";
  const pendingOpen =
    row.status === "PENDING_PAYMENT" &&
    row.paymentMethod === "RAZORPAY" &&
    (row.pendingExpiresAt === null || row.pendingExpiresAt > now);
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    statusLabel: orderStatusLabels[row.status],
    paymentMethod: row.paymentMethod,
    placedAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    pendingExpiresAt: row.pendingExpiresAt,
    items: row.items.map((item) => ({
      id: item.id,
      productSlug: item.productSlug,
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
      sku: item.sku,
      quantity: item.quantity,
      unitPriceInPaise: item.unitPriceInPaise,
      lineTotalInPaise: item.lineTotalInPaise,
      image:
        item.imageUrl && item.imageAlt
          ? { url: item.imageUrl, alt: item.imageAlt }
          : null,
    })),
    subtotalInPaise: row.subtotalInPaise,
    shippingInPaise: row.shippingInPaise,
    codFeeInPaise: row.codFeeInPaise,
    discountInPaise: row.discountInPaise,
    totalInPaise: row.totalInPaise,
    taxInPaise: row.taxInPaise,
    address: {
      recipientName: row.recipientName,
      line1: full ? row.addressLine1 : null,
      line2: full ? row.addressLine2 : null,
      landmark: full ? row.landmark : null,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
    },
    contact: {
      email: full ? row.email : maskEmail(row.email),
      phone: full ? row.phone : null,
    },
    customerNote: full ? row.customerNote : null,
    payment: {
      latestStatus: latest?.status ?? null,
      attemptCount: row.payments.length,
      reference: latest?.providerPaymentId
        ? latest.providerPaymentId.slice(-4)
        : null,
      failureDescription: latest?.failureDescription ?? null,
    },
    canPay: pendingOpen,
    canCancel: row.status === "PENDING_PAYMENT",
    timeline: row.events
      .filter((event) => event.type in timelineLabels)
      .map((event) => ({
        id: event.id,
        at: event.createdAt,
        label: timelineLabels[event.type] ?? event.type,
      })),
    exposure,
  };
}

export function toOrderSummaryView(row: OrderSummaryRow): OrderSummaryView {
  const first = row.items[0] ?? null;
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    statusLabel: orderStatusLabels[row.status],
    paymentMethod: row.paymentMethod,
    totalInPaise: row.totalInPaise,
    placedAt: row.createdAt,
    itemCount: row.items.reduce((count, item) => count + item.quantity, 0),
    firstItem: first
      ? {
          title: first.productTitle,
          image:
            first.imageUrl && first.imageAlt
              ? { url: first.imageUrl, alt: first.imageAlt }
              : null,
        }
      : null,
    awaitingPayment:
      row.status === "PENDING_PAYMENT" && row.paymentMethod === "RAZORPAY",
  };
}
