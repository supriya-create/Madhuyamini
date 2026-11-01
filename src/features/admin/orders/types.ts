import type {
  CancellationReason,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from "@/generated/prisma/enums";
import { maskEmail, orderStatusLabels } from "@/features/orders/types";
import { FULFILMENT_IN_PROGRESS } from "@/features/orders/transitions";

import { maskPhone } from "../redact";
import type { AdminOrderDetailBundle, AdminOrderListRow } from "./data";

/**
 * Admin order views (docs/admin.md §5.4, §5.7). Pages render these, never
 * rows. Contact details are masked unless the order is being fulfilled.
 */

export interface AdminOrderListItem {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly statusLabel: string;
  readonly paymentMethod: PaymentMethod;
  readonly latestPaymentStatus: PaymentStatus | null;
  readonly totalInPaise: number;
  readonly placedAt: Date;
  readonly recipientName: string;
  readonly emailMasked: string;
  readonly city: string;
  readonly units: number;
  readonly carrier: string | null;
}

export function toAdminOrderListItem(
  row: AdminOrderListRow,
): AdminOrderListItem {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    statusLabel: orderStatusLabels[row.status],
    paymentMethod: row.paymentMethod,
    latestPaymentStatus: row.payments[0]?.status ?? null,
    totalInPaise: row.totalInPaise,
    placedAt: row.createdAt,
    recipientName: row.recipientName,
    emailMasked: maskEmail(row.email),
    city: row.city,
    units: row.items.reduce((sum, item) => sum + item.quantity, 0),
    carrier: row.shipment?.carrier ?? null,
  };
}

export interface AdminOrderActions {
  readonly startProcessing: boolean;
  readonly ship: boolean;
  readonly deliver: boolean;
  readonly deliveryFailed: boolean;
  readonly parcelReturned: boolean;
  readonly inspection: boolean;
  readonly carrierLoss: boolean;
  /** Which cancellation path applies, if any. */
  readonly cancel: "pending" | "confirmed" | null;
  /** COD cash can be recorded (on delivery, or at handover with a reason). */
  readonly codCollect: "delivered" | "handover" | null;
  readonly codReverse: boolean;
}

export interface AdminOrderDetail {
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
  readonly customerAccount: boolean;
  readonly customerNote: string | null;
  readonly totals: {
    readonly subtotalInPaise: number;
    readonly shippingInPaise: number;
    readonly codFeeInPaise: number;
    readonly discountInPaise: number;
    readonly totalInPaise: number;
  };
  /** Full while fulfilling (and logged), masked otherwise. */
  readonly addressExposure: "full" | "masked";
  readonly address: {
    readonly recipientName: string;
    readonly line1: string | null;
    readonly line2: string | null;
    readonly landmark: string | null;
    readonly city: string;
    readonly state: string;
    readonly postalCode: string;
  };
  readonly contact: { readonly email: string; readonly phone: string };
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly variantId: string;
    readonly productSlug: string;
    readonly productTitle: string;
    readonly variantTitle: string | null;
    readonly sku: string;
    readonly quantity: number;
    readonly unitPriceInPaise: number;
    readonly lineTotalInPaise: number;
  }>;
  readonly payments: ReadonlyArray<{
    readonly id: string;
    readonly attemptNo: number;
    readonly method: PaymentMethod;
    readonly status: PaymentStatus;
    readonly amountInPaise: number;
    readonly receipt: string;
    readonly providerOrderId: string | null;
    readonly providerPaymentId: string | null;
    readonly signatureVerified: boolean;
    readonly capturedAt: Date | null;
    readonly failedAt: Date | null;
    readonly failureCode: string | null;
    readonly failureDescription: string | null;
    readonly createdAt: Date;
  }>;
  readonly refunds: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly amountInPaise: number;
    readonly reason: string;
    readonly reference: string;
    readonly providerRefundId: string | null;
    readonly attempts: number;
    readonly lastError: string | null;
    readonly processedAt: Date | null;
    readonly createdAt: Date;
  }>;
  readonly reservations: ReadonlyArray<{
    readonly id: string;
    readonly variantId: string;
    readonly quantity: number;
    readonly status: string;
    readonly expiresAt: Date;
    readonly closedAt: Date | null;
  }>;
  readonly shipment: {
    readonly carrier: string;
    readonly trackingNumber: string | null;
    readonly trackingUrl: string | null;
    readonly shippedAt: Date;
    readonly deliveredAt: Date | null;
    readonly deliveryFailedAt: Date | null;
    readonly deliveryFailureReason: string | null;
    readonly returnedAt: Date | null;
    readonly inspectedAt: Date | null;
    readonly inspectionNote: string | null;
    readonly carrierClaimReference: string | null;
  } | null;
  readonly events: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly actor: string;
    readonly fromStatus: OrderStatus | null;
    readonly toStatus: OrderStatus | null;
    readonly note: string | null;
    readonly at: Date;
  }>;
  readonly adjustments: AdminOrderDetailBundle["adjustments"];
  readonly audit: AdminOrderDetailBundle["audit"];
  readonly actions: AdminOrderActions;
}

export function computeActions(
  row: {
    readonly status: OrderStatus;
    readonly paymentMethod: PaymentMethod;
    readonly payments: ReadonlyArray<{
      readonly method: PaymentMethod;
      readonly status: PaymentStatus;
    }>;
  },
  role: "STAFF" | "ADMIN",
): AdminOrderActions {
  const admin = role === "ADMIN";
  const codOpen = row.payments.some(
    (p) => p.method === "COD" && p.status === "CREATED",
  );
  const codCaptured = row.payments.some(
    (p) => p.method === "COD" && p.status === "CAPTURED",
  );
  const status = row.status;
  return {
    startProcessing: status === "CONFIRMED",
    ship: status === "PROCESSING",
    deliver: status === "SHIPPED",
    deliveryFailed: status === "SHIPPED",
    parcelReturned: status === "DELIVERY_FAILED",
    inspection: status === "RETURNED",
    carrierLoss: admin && status === "DELIVERY_FAILED",
    cancel:
      status === "PENDING_PAYMENT"
        ? "pending"
        : admin &&
            (status === "CONFIRMED" ||
              status === "PROCESSING" ||
              status === "NEEDS_REVIEW")
          ? "confirmed"
          : null,
    codCollect:
      row.paymentMethod === "COD" && codOpen
        ? status === "DELIVERED"
          ? "delivered"
          : status === "SHIPPED"
            ? "handover"
            : null
        : null,
    codReverse: admin && row.paymentMethod === "COD" && codCaptured,
  };
}

export function toAdminOrderDetail(
  bundle: AdminOrderDetailBundle,
  role: "STAFF" | "ADMIN",
): AdminOrderDetail {
  const row = bundle.order;
  const full = FULFILMENT_IN_PROGRESS.includes(row.status);
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
    customerAccount: row.userId !== null,
    customerNote: row.customerNote,
    totals: {
      subtotalInPaise: row.subtotalInPaise,
      shippingInPaise: row.shippingInPaise,
      codFeeInPaise: row.codFeeInPaise,
      discountInPaise: row.discountInPaise,
      totalInPaise: row.totalInPaise,
    },
    addressExposure: full ? "full" : "masked",
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
      phone: full ? row.phone : maskPhone(row.phone),
    },
    items: row.items,
    payments: row.payments.map((p) => ({
      id: p.id,
      attemptNo: p.attemptNo,
      method: p.method,
      status: p.status,
      amountInPaise: p.amountInPaise,
      receipt: p.receipt,
      providerOrderId: p.providerOrderId,
      providerPaymentId: p.providerPaymentId,
      signatureVerified: p.signatureVerifiedAt !== null,
      capturedAt: p.capturedAt,
      failedAt: p.failedAt,
      failureCode: p.failureCode,
      failureDescription: p.failureDescription,
      createdAt: p.createdAt,
    })),
    refunds: row.refunds.map((r) => ({
      id: r.id,
      status: r.status,
      amountInPaise: r.amountInPaise,
      reason: r.reason,
      reference: r.reference,
      providerRefundId: r.providerRefundId,
      attempts: r.attempts,
      lastError: r.lastError,
      processedAt: r.processedAt,
      createdAt: r.createdAt,
    })),
    reservations: row.reservations,
    shipment: row.shipment
      ? {
          carrier: row.shipment.carrier,
          trackingNumber: row.shipment.trackingNumber,
          trackingUrl: row.shipment.trackingUrl,
          shippedAt: row.shipment.shippedAt,
          deliveredAt: row.shipment.deliveredAt,
          deliveryFailedAt: row.shipment.deliveryFailedAt,
          deliveryFailureReason: row.shipment.deliveryFailureReason,
          returnedAt: row.shipment.returnedAt,
          inspectedAt: row.shipment.inspectedAt,
          inspectionNote: row.shipment.inspectionNote,
          carrierClaimReference: row.shipment.carrierClaimReference,
        }
      : null,
    events: row.events.map((event) => ({
      id: event.id,
      type: event.type,
      actor: event.actor,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      at: event.createdAt,
    })),
    adjustments: bundle.adjustments,
    audit: bundle.audit,
    actions: computeActions(row, role),
  };
}

export const DELIVERY_FAILURE_REASONS = [
  "COD_REFUSED",
  "ADDRESS_NOT_FOUND",
  "UNCLAIMED",
  "CARRIER_LOST",
  "OTHER",
] as const;

export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

export const deliveryFailureLabels: Readonly<
  Record<DeliveryFailureReason, string>
> = {
  COD_REFUSED: "Customer refused (cash on delivery)",
  ADDRESS_NOT_FOUND: "Address not found",
  UNCLAIMED: "Unclaimed",
  CARRIER_LOST: "Lost by the carrier",
  OTHER: "Other",
};
