import "server-only";

import { releaseOrderHolds } from "@/features/inventory/service";
import * as orders from "@/features/orders/data";
import { findAccessibleOrder } from "@/features/orders/service";
import { nextOrderStatus } from "@/features/orders/transitions";
import type { OrderActor } from "@/generated/prisma/enums";
import type { OrderAccess } from "@/server/orders/context";
import { db } from "@/server/db";
import { describeError } from "@/server/jobs/queue";
import {
  enqueueNotification,
  enqueueOpsAlert,
} from "@/server/notifications/outbox";
import { PaymentGatewayError } from "@/server/payments/gateway";

import type { CaptureOutcome } from "./capture";
import * as data from "./data";
import { reconcileAttempt } from "./service";

/**
 * Expiry of one overdue online order (docs/checkout.md §5.6, T8): ask the
 * provider about every attempt that has a provider order, then either
 * confirm (a capture was found), leave the order alone (the provider could
 * not be asked, so a capture may exist) or release the stock and cancel.
 * The scheduled sweep and the customer's own pay and confirmation pages
 * call the same function; the order row lock and the re-check under it make
 * any second caller a no-op.
 *
 * Two kinds of "could not finish" are kept apart. The provider not answering
 * (`PaymentGatewayError`) is `unverified`: expected now and then, retried by
 * the next run. Anything else, a database or application error in the
 * pre-check or in T8, is our own failure: it is thrown, never passed off as
 * an outage, and the caller reports it with `reportExpiryFailure`. In both
 * cases the stock stays held: it is released only inside T8, after the
 * provider has answered that no capture exists.
 */

export type ExpiryOutcome =
  /** Holds released, order cancelled, customer emailed. */
  | { readonly kind: "cancelled"; readonly released: number }
  /** The pre-check found a capture and applied it; nothing was released. */
  | { readonly kind: "confirmed"; readonly capture: CaptureOutcome }
  /** The provider could not be asked (`PaymentGatewayError`); the holds stay until it can be. */
  | { readonly kind: "unverified" }
  /** Not pending, not overdue, or settled by someone else meanwhile. */
  | { readonly kind: "skipped" };

/**
 * What the customer's own page is told: the same, or `failed` when the
 * expiry hit an internal error. That error has been reported, the order is
 * still pending and its stock still held; the page must not say otherwise.
 */
export type CustomerExpiryOutcome = ExpiryOutcome | { readonly kind: "failed" };

/**
 * Throws on any internal failure (see above); returns `unverified` only
 * when the provider itself could not be asked.
 */
export async function expireOverdueOrder(
  orderId: string,
  now: Date,
  actor: OrderActor = "CRON",
): Promise<ExpiryOutcome> {
  // One read, no lock: callers that are not overdue stop here without a
  // provider call.
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { status: true, pendingExpiresAt: true },
  });
  if (
    !order ||
    order.status !== "PENDING_PAYMENT" ||
    !order.pendingExpiresAt ||
    order.pendingExpiresAt >= now
  ) {
    return { kind: "skipped" };
  }

  // Network first, outside any transaction. Every attempt with a provider
  // order is asked about, including ones a modal error marked FAILED: the
  // customer may have paid on a later try within the same provider order.
  for (const attempt of await data.findReconcilableAttempts(orderId)) {
    let outcome;
    try {
      outcome = await reconcileAttempt(attempt.id, now);
    } catch (error) {
      // The provider could not be asked: a capture may exist that we cannot
      // see right now, so stock is never released on a guess and the next
      // run asks again.
      if (error instanceof PaymentGatewayError) return { kind: "unverified" };
      // Anything else is ours (a database error while applying a capture
      // the provider did report, say). It must not pass for an outage: it
      // goes to the caller to be counted and reported. Nothing was
      // released; T8 below is never reached.
      throw error;
    }
    if (outcome.kind === "captured") {
      return { kind: "confirmed", capture: outcome.capture };
    }
  }

  const released = await db.$transaction(async (tx) => {
    await orders.lockOrder(tx, orderId);
    const current = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        pendingExpiresAt: true,
        email: true,
        orderNumber: true,
      },
    });
    if (
      !current ||
      current.status !== "PENDING_PAYMENT" ||
      !current.pendingExpiresAt ||
      current.pendingExpiresAt >= now ||
      nextOrderStatus(current.status, "payment_timeout") !== "CANCELLED"
    ) {
      return null;
    }
    const units = await releaseOrderHolds(tx, orderId, now, "EXPIRED");
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancellationReason: "PAYMENT_TIMEOUT",
        cancelledAt: now,
      },
    });
    await orders.recordOrderEvent(tx, {
      orderId,
      type: "order.cancelled",
      actor,
      fromStatus: "PENDING_PAYMENT",
      toStatus: "CANCELLED",
      note: `Payment deadline passed; ${units} unit(s) released.`,
    });
    await enqueueNotification(tx, {
      kind: "order.cancelled",
      orderId,
      recipient: current.email,
      payload: {
        orderId,
        orderNumber: current.orderNumber,
        reason: "timeout",
      },
    });
    return units;
  });
  return released === null
    ? { kind: "skipped" }
    : { kind: "cancelled", released };
}

/**
 * The customer-facing entry: acts only on an order the caller can already
 * see (account scope or guest token), and only when it is overdue. The
 * customer's page still has to render when the expiry fails internally, so
 * the failure is reported here, exactly as the sweep reports it, and the
 * page is told `failed`.
 */
export async function expireOverdueOrderFor(
  access: OrderAccess,
  orderId: string,
  now = new Date(),
): Promise<CustomerExpiryOutcome> {
  const found = await findAccessibleOrder(access, orderId, now);
  if (!found) return { kind: "skipped" };
  try {
    return await expireOverdueOrder(orderId, now, "SYSTEM");
  } catch (error) {
    await reportExpiryFailure(orderId, error, now);
    return { kind: "failed" };
  }
}

/**
 * Makes one order's failed expiry visible; never throws. The durable record
 * is an operations alert, one per order and day of the caller's clock, so a
 * failure that persists raises a fresh alert every day until it is fixed.
 * When the alert itself cannot be written, the failure goes to the server
 * log instead.
 *
 * That log line is built from an allowlist: the order id, the alert key, a
 * fixed sentence, and the class and code of each error. No exception message
 * is ever logged, masked or not: a message can quote a row, a credential, a
 * connection string or a provider payload, and no pattern can promise to
 * catch them all. The order id and alert key say where to look; the classes
 * and codes say what kind of failure it was.
 */
export async function reportExpiryFailure(
  orderId: string,
  error: unknown,
  now: Date,
): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const alertKey = `expire-failed:${orderId}:${day}`;
  try {
    await db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { orderNumber: true },
      });
      await enqueueOpsAlert(tx, {
        key: alertKey,
        orderId,
        payload: {
          reason:
            "An overdue order could not be expired; its stock holds are still active and need manual review",
          orderNumber: order?.orderNumber ?? "",
          lastError: describeError(error),
        },
      });
    });
  } catch (alertError) {
    console.error("[expiry] failure alert not recorded", {
      orderId,
      alertKey,
      message: ALERT_NOT_RECORDED,
      failure: errorIdentity(error),
      alertFailure: errorIdentity(alertError),
    });
  }
}

const ALERT_NOT_RECORDED =
  "An overdue order could not be expired, and the operations alert for it could not be written. Its stock holds are still active.";

/** A class name: letters, digits and underscores, as an identifier is. */
const ERROR_CLASS = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** A code as libraries write them: `P2002`, `23514`, `ECONNREFUSED`, `INVENTORY_INCONSISTENT`. */
const ERROR_CODE = /^[A-Z0-9_]{1,40}$/;

/**
 * All the server log may say about an error: its class and its code, and
 * each only when it is a string shaped like one. A name that is not a string
 * identifier becomes `Error`; a code that is not a code is left out. Nothing
 * is ever turned into a string to be tested or logged: an object whose
 * `toString()` returns something identifier-like is not a name. The message,
 * the stack and the cause chain are never read.
 */
function errorIdentity(error: unknown): {
  readonly errorClass: string;
  readonly code?: string;
} {
  if (!(error instanceof Error)) return { errorClass: "Unknown" };
  // Typed as a string, but nothing stops code from assigning anything.
  const name: unknown = error.name;
  const raw: unknown = "code" in error ? error.code : undefined;
  const code =
    typeof raw === "number" && Number.isInteger(raw) ? String(raw) : raw;
  return {
    errorClass:
      typeof name === "string" && ERROR_CLASS.test(name) ? name : "Error",
    ...(typeof code === "string" && ERROR_CODE.test(code) ? { code } : {}),
  };
}
