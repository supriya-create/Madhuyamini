import type { ReturnStatus } from "@/generated/prisma/enums";

/**
 * The return request state machine (docs/phase-8-returns-custom-artwork.md
 * §3.2), table-driven like the order machine. Money (settlement) arrives in
 * step 8.2; lost parcels and corrections in 8.4.
 */

export type ReturnEventKind =
  | "approve"
  | "reject"
  | "request_info"
  | "customer_replied"
  | "withdraw"
  | "shipped"
  | "expire"
  | "overdue"
  | "receive"
  | "inspect"
  | "settle"
  | "declare_lost";

const RETURN_TRANSITIONS: Readonly<
  Record<ReturnStatus, Readonly<Partial<Record<ReturnEventKind, ReturnStatus>>>>
> = {
  REQUESTED: {
    approve: "APPROVED",
    reject: "REJECTED",
    request_info: "INFO_REQUESTED",
    withdraw: "WITHDRAWN",
  },
  INFO_REQUESTED: {
    customer_replied: "REQUESTED",
    approve: "APPROVED",
    reject: "REJECTED",
    withdraw: "WITHDRAWN",
  },
  // Staff may record receipt straight from APPROVED when the parcel simply arrives.
  APPROVED: {
    shipped: "IN_TRANSIT",
    withdraw: "WITHDRAWN",
    expire: "EXPIRED",
    receive: "RECEIVED",
  },
  IN_TRANSIT: { receive: "RECEIVED", overdue: "OVERDUE" },
  OVERDUE: { receive: "RECEIVED", declare_lost: "LOST" },
  RECEIVED: { inspect: "INSPECTED" },
  INSPECTED: { settle: "CLOSED" },
  CLOSED: {},
  REJECTED: {},
  WITHDRAWN: {},
  EXPIRED: {},
  LOST: {},
};

/** The status a request moves to, or null when the move is not allowed. */
export function nextReturnStatus(
  current: ReturnStatus,
  event: ReturnEventKind,
): ReturnStatus | null {
  return RETURN_TRANSITIONS[current][event] ?? null;
}

/** Statuses that count as "open" for the one-open-request-per-order rule. */
export const OPEN_RETURN_STATUSES: readonly ReturnStatus[] = [
  "REQUESTED",
  "INFO_REQUESTED",
  "APPROVED",
  "IN_TRANSIT",
  "OVERDUE",
  "RECEIVED",
  "INSPECTED",
];

export const CLOSED_RETURN_STATUSES: readonly ReturnStatus[] = [
  "CLOSED",
  "REJECTED",
  "WITHDRAWN",
  "EXPIRED",
  "LOST",
];

export function isOpenReturnStatus(status: ReturnStatus): boolean {
  return OPEN_RETURN_STATUSES.includes(status);
}

/** Units of a closed request that were accepted (received and inspected) are permanent. */
export function countsAgainstAvailability(status: ReturnStatus): boolean {
  return (
    status !== "REJECTED" && status !== "WITHDRAWN" && status !== "EXPIRED"
  );
}
