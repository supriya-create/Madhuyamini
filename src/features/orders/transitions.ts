import type {
  OrderStatus,
  PaymentStatus,
  ReservationStatus,
} from "@/generated/prisma/enums";

/**
 * Pure state machines for orders, payment attempts and stock holds
 * (docs/checkout.md §5). Services apply a transition only after locking the
 * row and re-reading its status, so these tables are the single source of
 * which moves exist; everything else is "not allowed".
 */

export type OrderEventKind =
  | "payment_captured"
  | "payment_mismatch"
  | "late_capture_restocked"
  | "late_capture_no_stock"
  | "payment_timeout"
  | "customer_cancelled"
  | "stock_lost"
  | "admin_confirmed"
  | "admin_cancelled";

const ORDER_TRANSITIONS: Readonly<
  Record<OrderStatus, Readonly<Partial<Record<OrderEventKind, OrderStatus>>>>
> = {
  PENDING_PAYMENT: {
    payment_captured: "CONFIRMED",
    payment_mismatch: "NEEDS_REVIEW",
    payment_timeout: "CANCELLED",
    customer_cancelled: "CANCELLED",
    stock_lost: "CANCELLED",
    admin_cancelled: "CANCELLED",
  },
  // A capture that lands after the deadline cancelled the order (P8).
  CANCELLED: {
    late_capture_restocked: "CONFIRMED",
    late_capture_no_stock: "NEEDS_REVIEW",
  },
  NEEDS_REVIEW: {
    admin_confirmed: "CONFIRMED",
    admin_cancelled: "CANCELLED",
  },
  // Fulfilment states arrive in Phase 7/8.
  CONFIRMED: {},
};

/** The status an order moves to, or null when the move is not allowed. */
export function nextOrderStatus(
  current: OrderStatus,
  event: OrderEventKind,
): OrderStatus | null {
  return ORDER_TRANSITIONS[current][event] ?? null;
}

export type PaymentEventKind =
  | "provider_order_created"
  | "provider_creation_failed"
  | "authorized"
  | "captured"
  | "failed"
  | "refunded";

const PAYMENT_TRANSITIONS: Readonly<
  Record<
    PaymentStatus,
    Readonly<Partial<Record<PaymentEventKind, PaymentStatus>>>
  >
> = {
  INITIATED: {
    provider_order_created: "CREATED",
    provider_creation_failed: "FAILED",
  },
  CREATED: { authorized: "AUTHORIZED", captured: "CAPTURED", failed: "FAILED" },
  AUTHORIZED: { captured: "CAPTURED", failed: "FAILED" },
  // Terminal except for a refund; a late "failed" can never undo a capture.
  CAPTURED: { refunded: "REFUNDED" },
  // One provider order can carry several payment tries: a capture may land
  // after we recorded a failure, and money taken is never ignored.
  FAILED: { captured: "CAPTURED" },
  REFUNDED: {},
};

export function nextPaymentStatus(
  current: PaymentStatus,
  event: PaymentEventKind,
): PaymentStatus | null {
  return PAYMENT_TRANSITIONS[current][event] ?? null;
}

/** Attempts the customer can still pay against (one at a time per order). */
export const OPEN_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "INITIATED",
  "CREATED",
  "AUTHORIZED",
];

export function isOpenPaymentStatus(status: PaymentStatus): boolean {
  return OPEN_PAYMENT_STATUSES.includes(status);
}

export type ReservationEventKind = "consumed" | "released" | "expired";

const RESERVATION_TRANSITIONS: Readonly<
  Record<ReservationEventKind, ReservationStatus>
> = {
  consumed: "CONSUMED",
  released: "RELEASED",
  expired: "EXPIRED",
};

/** Only an ACTIVE hold can move; closed holds stay closed. */
export function nextReservationStatus(
  current: ReservationStatus,
  event: ReservationEventKind,
): ReservationStatus | null {
  return current === "ACTIVE" ? RESERVATION_TRANSITIONS[event] : null;
}

/** Statuses in which an order still belongs to a cart that may be re-used. */
export function isLiveOrderStatus(status: OrderStatus): boolean {
  return status !== "CANCELLED";
}
