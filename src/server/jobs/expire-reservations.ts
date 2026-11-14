import "server-only";

import { releaseOrderHolds } from "@/features/inventory/service";
import * as orders from "@/features/orders/data";
import { nextOrderStatus } from "@/features/orders/transitions";
import * as payments from "@/features/payments/data";
import { reconcileAttempt } from "@/features/payments/service";
import { db } from "@/server/db";
import { enqueueNotification } from "@/server/notifications/outbox";

/**
 * The expiry sweep (docs/checkout.md T8, §5.6): for each pending online
 * order past its deadline, first ask the provider whether it was paid
 * (missed webhook), then either confirm it or release the stock and cancel.
 * Two sweeps may run at once: the order row lock and the re-check inside it
 * make the second a no-op.
 */

export async function runExpireReservations(
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<Record<string, number>> {
  const now = options.now ?? new Date();
  const summary = { examined: 0, cancelled: 0, confirmed: 0, skipped: 0 };

  const candidates = await orders.findExpiredPendingOrderIds(
    now,
    options.limit ?? 50,
  );
  for (const { id } of candidates) {
    summary.examined += 1;

    // Network first, outside any transaction. Every attempt with a provider
    // order is asked about, including ones a modal error marked FAILED: the
    // customer may have paid on a later try within the same provider order.
    let captured = false;
    for (const attempt of await payments.findReconcilableAttempts(id)) {
      const outcome = await reconcileAttempt(attempt.id, now).catch(() => null);
      if (outcome?.kind === "captured") {
        captured = true;
        break;
      }
    }
    if (captured) {
      summary.confirmed += 1;
      continue;
    }

    const cancelled = await db.$transaction(async (tx) => {
      await orders.lockOrder(tx, id);
      const order = await tx.order.findUnique({
        where: { id },
        select: {
          status: true,
          pendingExpiresAt: true,
          email: true,
          orderNumber: true,
        },
      });
      if (
        !order ||
        order.status !== "PENDING_PAYMENT" ||
        !order.pendingExpiresAt ||
        order.pendingExpiresAt >= now ||
        nextOrderStatus(order.status, "payment_timeout") !== "CANCELLED"
      ) {
        return false;
      }
      const released = await releaseOrderHolds(tx, id, now, "EXPIRED");
      await tx.order.update({
        where: { id },
        data: {
          status: "CANCELLED",
          cancellationReason: "PAYMENT_TIMEOUT",
          cancelledAt: now,
        },
      });
      await orders.recordOrderEvent(tx, {
        orderId: id,
        type: "order.cancelled",
        actor: "CRON",
        fromStatus: "PENDING_PAYMENT",
        toStatus: "CANCELLED",
        note: `Payment deadline passed; ${released} unit(s) released.`,
      });
      await enqueueNotification(tx, {
        kind: "order.cancelled",
        orderId: id,
        recipient: order.email,
        payload: {
          orderId: id,
          orderNumber: order.orderNumber,
          reason: "timeout",
        },
      });
      return true;
    });
    if (cancelled) summary.cancelled += 1;
    else summary.skipped += 1;
  }
  return summary;
}
