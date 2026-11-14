import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod, PaymentStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";

/**
 * Payment attempts and refunds. Attempts are addressed with their order so a
 * caller can never move another order's attempt.
 */

type Tx = Prisma.TransactionClient;

export const attemptSelect = {
  id: true,
  orderId: true,
  attemptNo: true,
  method: true,
  status: true,
  amountInPaise: true,
  currency: true,
  receipt: true,
  providerOrderId: true,
  providerPaymentId: true,
  providerAttempts: true,
  lastError: true,
  capturedAt: true,
  failedAt: true,
  createdAt: true,
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalInPaise: true,
      currency: true,
      pendingExpiresAt: true,
    },
  },
} satisfies Prisma.PaymentSelect;

export type AttemptRow = Prisma.PaymentGetPayload<{
  select: typeof attemptSelect;
}>;

export function findAttempt(attemptId: string, tx: Tx = db) {
  return tx.payment.findUnique({
    where: { id: attemptId },
    select: attemptSelect,
  });
}

export function findAttemptByProviderOrderId(
  providerOrderId: string,
  tx: Tx = db,
) {
  return tx.payment.findUnique({
    where: { providerOrderId },
    select: attemptSelect,
  });
}

export function findOpenAttempt(orderId: string, tx: Tx = db) {
  return tx.payment.findFirst({
    where: { orderId, status: { in: ["INITIATED", "CREATED", "AUTHORIZED"] } },
    select: attemptSelect,
  });
}

export function createAttempt(
  tx: Tx,
  input: {
    orderId: string;
    attemptNo: number;
    method: PaymentMethod;
    status: PaymentStatus;
    amountInPaise: number;
    receipt: string;
  },
) {
  return tx.payment.create({ data: input, select: attemptSelect });
}

/** INITIATED → CREATED with the provider order; 0 rows means it already moved. */
export async function markAttemptCreated(
  tx: Tx,
  attemptId: string,
  providerOrderId: string,
): Promise<boolean> {
  const result = await tx.payment.updateMany({
    where: { id: attemptId, status: "INITIATED" },
    data: { status: "CREATED", providerOrderId },
  });
  return result.count === 1;
}

export async function recordProviderFailure(
  tx: Tx,
  attemptId: string,
  input: { error: string; giveUp: boolean; now: Date },
): Promise<boolean> {
  const result = await tx.payment.updateMany({
    where: { id: attemptId, status: "INITIATED" },
    data: {
      providerAttempts: { increment: 1 },
      lastError: input.error,
      ...(input.giveUp ? { status: "FAILED", failedAt: input.now } : {}),
    },
  });
  return result.count === 1;
}

export async function markAttemptCaptured(
  tx: Tx,
  attemptId: string,
  input: { providerPaymentId: string; now: Date; signatureVerified: boolean },
): Promise<boolean> {
  const result = await tx.payment.updateMany({
    where: {
      id: attemptId,
      status: { in: ["CREATED", "AUTHORIZED", "FAILED"] },
    },
    data: {
      status: "CAPTURED",
      providerPaymentId: input.providerPaymentId,
      capturedAt: input.now,
      ...(input.signatureVerified ? { signatureVerifiedAt: input.now } : {}),
    },
  });
  return result.count === 1;
}

export async function markAttemptAuthorized(
  tx: Tx,
  attemptId: string,
  input: { providerPaymentId: string; now: Date },
): Promise<boolean> {
  const result = await tx.payment.updateMany({
    where: { id: attemptId, status: "CREATED" },
    data: {
      status: "AUTHORIZED",
      providerPaymentId: input.providerPaymentId,
      authorizedAt: input.now,
    },
  });
  return result.count === 1;
}

export async function markAttemptFailed(
  tx: Tx,
  attemptId: string,
  input: {
    providerPaymentId: string | null;
    failureCode: string | null;
    failureDescription: string | null;
    now: Date;
  },
): Promise<boolean> {
  const result = await tx.payment.updateMany({
    where: { id: attemptId, status: { in: ["CREATED", "AUTHORIZED"] } },
    data: {
      status: "FAILED",
      failedAt: input.now,
      failureCode: input.failureCode,
      failureDescription: input.failureDescription,
      // A failed payment id is still worth keeping; never overwrite a capture's.
      ...(input.providerPaymentId
        ? { providerPaymentId: input.providerPaymentId }
        : {}),
    },
  });
  return result.count === 1;
}

export async function markAttemptRefunded(
  tx: Tx,
  attemptId: string,
): Promise<boolean> {
  const result = await tx.payment.updateMany({
    where: { id: attemptId, status: "CAPTURED" },
    data: { status: "REFUNDED" },
  });
  return result.count === 1;
}

/** Attempts still waiting for a provider order (the recover-payments job's candidates). */
export function findStaleInitiatedAttempts(
  olderThan: Date,
  limit: number,
  tx: Tx = db,
) {
  return tx.payment.findMany({
    where: {
      status: "INITIATED",
      method: "RAZORPAY",
      updatedAt: { lt: olderThan },
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
}

/**
 * Statuses the provider may still have captured against: open attempts, and
 * attempts marked FAILED from a modal error or an earlier try on the same
 * provider order, which can still be paid (`FAILED → CAPTURED`).
 */
export const RECONCILABLE_STATUSES: readonly PaymentStatus[] = [
  "CREATED",
  "AUTHORIZED",
  "FAILED",
];

/**
 * Online attempts of pending orders old enough to reconcile with the
 * provider. FAILED attempts are included while they carry a provider order:
 * a browser-reported failure is not evidence that no capture followed.
 */
export function findAttemptsToReconcile(
  olderThan: Date,
  limit: number,
  tx: Tx = db,
) {
  return tx.payment.findMany({
    where: {
      status: { in: [...RECONCILABLE_STATUSES] },
      method: "RAZORPAY",
      providerOrderId: { not: null },
      updatedAt: { lt: olderThan },
      order: { status: "PENDING_PAYMENT" },
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
}

/**
 * Uncaptured attempts of online orders cancelled within the window
 * (docs/checkout.md §9 #28): a capture the provider never announced is
 * found here and refunded. Ordered by cancellation so the oldest are seen
 * first; the job decides which are due for a check.
 */
export function findCancelledAttemptsToReconcile(
  cancelledSince: Date,
  limit: number,
  tx: Tx = db,
) {
  return tx.payment.findMany({
    where: {
      method: "RAZORPAY",
      status: { in: [...RECONCILABLE_STATUSES] },
      providerOrderId: { not: null },
      order: {
        status: "CANCELLED",
        paymentMethod: "RAZORPAY",
        cancelledAt: { gte: cancelledSince },
      },
    },
    select: {
      id: true,
      orderId: true,
      attemptNo: true,
      order: { select: { cancelledAt: true } },
    },
    orderBy: { order: { cancelledAt: "asc" } },
    take: limit,
  });
}

/** Every attempt of an order the provider could have captured (the sweep's pre-check). */
export function findReconcilableAttempts(orderId: string, tx: Tx = db) {
  return tx.payment.findMany({
    where: {
      orderId,
      method: "RAZORPAY",
      status: { in: [...RECONCILABLE_STATUSES] },
      providerOrderId: { not: null },
    },
    select: attemptSelect,
    orderBy: { attemptNo: "desc" },
  });
}
