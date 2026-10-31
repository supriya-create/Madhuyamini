import { describe, expect, it } from "vitest";

import type { OrderStatus, PaymentStatus } from "@/generated/prisma/enums";

import {
  isLiveOrderStatus,
  isOpenPaymentStatus,
  nextOrderStatus,
  nextPaymentStatus,
  nextReservationStatus,
} from "./transitions";
import type { OrderEventKind, PaymentEventKind } from "./transitions";

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CANCELLED",
  "NEEDS_REVIEW",
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

  it("allows nothing out of CONFIRMED and nothing unlisted anywhere", () => {
    for (const event of ORDER_EVENTS) {
      expect(nextOrderStatus("CONFIRMED", event)).toBeNull();
    }
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
    expect(ORDER_STATUSES.filter(isLiveOrderStatus)).toEqual([
      "PENDING_PAYMENT",
      "CONFIRMED",
      "NEEDS_REVIEW",
    ]);
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
