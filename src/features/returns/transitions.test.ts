import { describe, expect, it } from "vitest";

import type { ReturnStatus } from "@/generated/prisma/enums";

import {
  CLOSED_RETURN_STATUSES,
  OPEN_RETURN_STATUSES,
  countsAgainstAvailability,
  isOpenReturnStatus,
  nextReturnStatus,
} from "./transitions";
import type { ReturnEventKind } from "./transitions";

const ALL_STATUSES: readonly ReturnStatus[] = [
  ...OPEN_RETURN_STATUSES,
  ...CLOSED_RETURN_STATUSES,
];

const ALL_EVENTS: readonly ReturnEventKind[] = [
  "approve",
  "reject",
  "request_info",
  "customer_replied",
  "withdraw",
  "shipped",
  "expire",
  "overdue",
  "receive",
  "inspect",
  "settle",
  "declare_lost",
];

const ALLOWED: ReadonlyArray<[ReturnStatus, ReturnEventKind, ReturnStatus]> = [
  ["REQUESTED", "approve", "APPROVED"],
  ["REQUESTED", "reject", "REJECTED"],
  ["REQUESTED", "request_info", "INFO_REQUESTED"],
  ["REQUESTED", "withdraw", "WITHDRAWN"],
  ["INFO_REQUESTED", "customer_replied", "REQUESTED"],
  ["INFO_REQUESTED", "approve", "APPROVED"],
  ["INFO_REQUESTED", "reject", "REJECTED"],
  ["INFO_REQUESTED", "withdraw", "WITHDRAWN"],
  ["APPROVED", "shipped", "IN_TRANSIT"],
  ["APPROVED", "withdraw", "WITHDRAWN"],
  ["APPROVED", "expire", "EXPIRED"],
  ["APPROVED", "receive", "RECEIVED"],
  ["IN_TRANSIT", "receive", "RECEIVED"],
  ["IN_TRANSIT", "overdue", "OVERDUE"],
  ["OVERDUE", "receive", "RECEIVED"],
  ["OVERDUE", "declare_lost", "LOST"],
  ["RECEIVED", "inspect", "INSPECTED"],
  ["INSPECTED", "settle", "CLOSED"],
];

describe("nextReturnStatus", () => {
  it("allows exactly the documented edges and nothing else", () => {
    const allowed = new Set(ALLOWED.map(([from, event]) => `${from}:${event}`));
    for (const from of ALL_STATUSES) {
      for (const event of ALL_EVENTS) {
        const expected = ALLOWED.find(
          ([f, e]) => f === from && e === event,
        )?.[2];
        expect(nextReturnStatus(from, event), `${from} + ${event}`).toBe(
          allowed.has(`${from}:${event}`) ? expected : null,
        );
      }
    }
  });

  it("never leaves a closed status", () => {
    for (const status of CLOSED_RETURN_STATUSES) {
      for (const event of ALL_EVENTS) {
        expect(nextReturnStatus(status, event)).toBeNull();
      }
      expect(isOpenReturnStatus(status)).toBe(false);
    }
  });

  it("counts units of every request except rejected, withdrawn and expired ones", () => {
    expect(countsAgainstAvailability("REJECTED")).toBe(false);
    expect(countsAgainstAvailability("WITHDRAWN")).toBe(false);
    expect(countsAgainstAvailability("EXPIRED")).toBe(false);
    expect(countsAgainstAvailability("APPROVED")).toBe(true);
    expect(countsAgainstAvailability("CLOSED")).toBe(true);
    expect(countsAgainstAvailability("LOST")).toBe(true);
  });
});
