import { describe, expect, it } from "vitest";

import type { OrderStatus, PaymentStatus } from "@/generated/prisma/enums";

import {
  FULFILMENT_IN_PROGRESS,
  isLiveOrderStatus,
  isOpenPaymentStatus,
  nextCodPaymentStatus,
  nextOrderStatus,
  nextPaymentStatus,
  nextReservationStatus,
} from "./transitions";
import type {
  CodPaymentEventKind,
  OrderEventKind,
  PaymentEventKind,
} from "./transitions";

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "NEEDS_REVIEW",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "DELIVERY_FAILED",
  "RETURNED",
];
const ORDER_EVENTS: OrderEventKind[] = [
  "payment_captured",
  "payment_mismatch",
  "late_capture_restocked",
  "late_capture_no_stock",
  "payment_timeout",
  "customer_cancelled",
  "stock_lost",
  "admin_confirmed",
  "admin_cancelled",
  "start_processing",
  "ship",
  "deliver",
  "delivery_failed",
  "parcel_returned",
  "inspection_completed",
  "carrier_lost_confirmed",
];
const PAYMENT_STATUSES: PaymentStatus[] = [
  "INITIATED",
  "CREATED",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
];

describe("order transitions", () => {
  it.each<[OrderStatus, OrderEventKind, OrderStatus]>([
    ["PENDING_PAYMENT", "payment_captured", "CONFIRMED"],
    ["PENDING_PAYMENT", "payment_mismatch", "NEEDS_REVIEW"],
    ["PENDING_PAYMENT", "payment_timeout", "CANCELLED"],
    ["PENDING_PAYMENT", "customer_cancelled", "CANCELLED"],
    ["PENDING_PAYMENT", "stock_lost", "CANCELLED"],
    ["CANCELLED", "late_capture_restocked", "CONFIRMED"],
    ["CANCELLED", "late_capture_no_stock", "NEEDS_REVIEW"],
    ["NEEDS_REVIEW", "admin_confirmed", "CONFIRMED"],
    ["NEEDS_REVIEW", "admin_cancelled", "CANCELLED"],
  ])("%s + %s → %s", (from, event, to) => {
    expect(nextOrderStatus(from, event)).toBe(to);
  });

  // Fulfilment and return to origin (docs/admin.md §5.4, §5.11).
  it.each<[OrderStatus, OrderEventKind, OrderStatus]>([
    ["CONFIRMED", "start_processing", "PROCESSING"],
    ["CONFIRMED", "admin_cancelled", "CANCELLED"],
    ["PROCESSING", "ship", "SHIPPED"],
    ["PROCESSING", "admin_cancelled", "CANCELLED"],
    ["SHIPPED", "deliver", "DELIVERED"],
    ["SHIPPED", "delivery_failed", "DELIVERY_FAILED"],
    ["DELIVERY_FAILED", "parcel_returned", "RETURNED"],
    ["DELIVERY_FAILED", "carrier_lost_confirmed", "CANCELLED"],
    ["RETURNED", "inspection_completed", "CANCELLED"],
  ])("%s + %s → %s", (from, event, to) => {
    expect(nextOrderStatus(from, event)).toBe(to);
  });

  it("never cancels after shipping (A7) and never restocks before inspection", () => {
    expect(nextOrderStatus("SHIPPED", "admin_cancelled")).toBeNull();
    expect(nextOrderStatus("SHIPPED", "customer_cancelled")).toBeNull();
    expect(nextOrderStatus("DELIVERY_FAILED", "admin_cancelled")).toBeNull();
    expect(nextOrderStatus("RETURNED", "admin_cancelled")).toBeNull();
    // A refusal is a delivery failure, not a cancellation: stock stays out.
    expect(
      nextOrderStatus("DELIVERY_FAILED", "inspection_completed"),
    ).toBeNull();
    expect(nextOrderStatus("DELIVERED", "admin_cancelled")).toBeNull();
    for (const event of ORDER_EVENTS) {
      expect(nextOrderStatus("DELIVERED", event)).toBeNull();
    }
    expect(FULFILMENT_IN_PROGRESS).toEqual([
      "CONFIRMED",
      "PROCESSING",
      "SHIPPED",
      "DELIVERY_FAILED",
      "RETURNED",
    ]);
  });

  it("allows nothing unlisted anywhere", () => {
    expect(nextOrderStatus("CONFIRMED", "payment_captured")).toBeNull();
    expect(nextOrderStatus("CONFIRMED", "ship")).toBeNull();
    expect(nextOrderStatus("CANCELLED", "payment_captured")).toBeNull();
    expect(nextOrderStatus("CANCELLED", "customer_cancelled")).toBeNull();
    expect(nextOrderStatus("NEEDS_REVIEW", "payment_captured")).toBeNull();
    expect(nextOrderStatus("PENDING_PAYMENT", "admin_confirmed")).toBeNull();
    // Every status has an entry, so an unknown pair is null rather than a crash.
    for (const status of ORDER_STATUSES) {
      for (const event of ORDER_EVENTS) {
        expect(() => nextOrderStatus(status, event)).not.toThrow();
      }
    }
  });

  it("treats everything but CANCELLED as live for the cart index", () => {
    expect(ORDER_STATUSES.filter(isLiveOrderStatus)).toEqual(
      ORDER_STATUSES.filter((status) => status !== "CANCELLED"),
    );
  });
});

describe("cash-on-delivery payment transitions", () => {
  const COD_EVENTS: CodPaymentEventKind[] = [
    "cod_collected",
    "cod_refused",
    "cod_collection_reversed",
  ];

  it("collects or refuses from CREATED, and reverses only a collection", () => {
    expect(nextCodPaymentStatus("CREATED", "cod_collected")).toBe("CAPTURED");
    expect(nextCodPaymentStatus("CREATED", "cod_refused")).toBe("FAILED");
    expect(nextCodPaymentStatus("CAPTURED", "cod_collection_reversed")).toBe(
      "CREATED",
    );
  });

  it("allows nothing else: no double collection, no reversal of a refusal", () => {
    expect(nextCodPaymentStatus("CAPTURED", "cod_collected")).toBeNull();
    expect(
      nextCodPaymentStatus("FAILED", "cod_collection_reversed"),
    ).toBeNull();
    expect(nextCodPaymentStatus("FAILED", "cod_collected")).toBeNull();
    expect(
      nextCodPaymentStatus("CREATED", "cod_collection_reversed"),
    ).toBeNull();
    for (const status of ["INITIATED", "AUTHORIZED", "REFUNDED"] as const) {
      for (const event of COD_EVENTS) {
        expect(nextCodPaymentStatus(status, event)).toBeNull();
      }
    }
    for (const status of PAYMENT_STATUSES) {
      for (const event of COD_EVENTS) {
        expect(() => nextCodPaymentStatus(status, event)).not.toThrow();
      }
    }
  });
});

describe("payment attempt transitions", () => {
  it.each<[PaymentStatus, PaymentEventKind, PaymentStatus]>([
    ["INITIATED", "provider_order_created", "CREATED"],
    ["INITIATED", "provider_creation_failed", "FAILED"],
    ["CREATED", "authorized", "AUTHORIZED"],
    ["CREATED", "captured", "CAPTURED"],
    ["CREATED", "failed", "FAILED"],
    ["AUTHORIZED", "captured", "CAPTURED"],
    ["AUTHORIZED", "failed", "FAILED"],
    ["CAPTURED", "refunded", "REFUNDED"],
  ])("%s + %s → %s", (from, event, to) => {
    expect(nextPaymentStatus(from, event)).toBe(to);
  });

  it("never lets a failure overwrite a capture, and keeps terminals terminal", () => {
    expect(nextPaymentStatus("CAPTURED", "failed")).toBeNull();
    expect(nextPaymentStatus("CAPTURED", "captured")).toBeNull();
    expect(nextPaymentStatus("CAPTURED", "authorized")).toBeNull();
    expect(nextPaymentStatus("FAILED", "captured")).toBe("CAPTURED");
    expect(nextPaymentStatus("FAILED", "authorized")).toBeNull();
    expect(nextPaymentStatus("REFUNDED", "captured")).toBeNull();
    expect(nextPaymentStatus("INITIATED", "captured")).toBeNull();
  });

  it("counts INITIATED, CREATED and AUTHORIZED as open", () => {
    const open = (
      [
        "INITIATED",
        "CREATED",
        "AUTHORIZED",
        "CAPTURED",
        "FAILED",
        "REFUNDED",
      ] as PaymentStatus[]
    ).filter(isOpenPaymentStatus);
    expect(open).toEqual(["INITIATED", "CREATED", "AUTHORIZED"]);
  });
});

describe("reservation transitions", () => {
  it("moves only ACTIVE holds", () => {
    expect(nextReservationStatus("ACTIVE", "consumed")).toBe("CONSUMED");
    expect(nextReservationStatus("ACTIVE", "released")).toBe("RELEASED");
    expect(nextReservationStatus("ACTIVE", "expired")).toBe("EXPIRED");
    expect(nextReservationStatus("CONSUMED", "released")).toBeNull();
    expect(nextReservationStatus("EXPIRED", "consumed")).toBeNull();
    expect(nextReservationStatus("RELEASED", "expired")).toBeNull();
  });
});
