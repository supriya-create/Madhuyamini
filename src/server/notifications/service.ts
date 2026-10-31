import "server-only";

import { findOrderById } from "@/features/orders/data";
import { toOrderDetailView } from "@/features/orders/types";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";
import { env } from "@/server/env";
import {
  opsAlertMessage,
  orderCancelledMessage,
  orderConfirmedMessage,
  ownerNewOrderMessage,
  refundRequestedMessage,
} from "@/server/email/templates";
import type { OrderEmailSummary } from "@/server/email/templates";
import type { EmailMessage } from "@/server/email/types";

/**
 * Turns an outbox row into an email. Order facts are read from the order's
 * immutable snapshot at send time; the row's payload carries what the
 * snapshot cannot (reasons, amounts of a refund, alert text).
 */

export interface OutboxRow {
  readonly id: string;
  readonly kind: string;
  readonly orderId: string | null;
  readonly recipient: string;
  readonly payload: unknown;
  readonly dedupeKey: string;
}

export class NotificationRenderError extends Error {}

function field(payload: unknown, key: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function numberField(payload: unknown, key: string): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

function absolute(path: string): string {
  return new URL(path, env.siteUrl).toString();
}

async function orderSummary(orderId: string): Promise<{
  summary: OrderEmailSummary;
  customerEmail: string;
}> {
  const row = await findOrderById(orderId);
  if (!row) throw new NotificationRenderError(`order ${orderId} not found`);
  const view = toOrderDetailView(row, "full", new Date());
  return {
    customerEmail: row.email,
    summary: {
      orderNumber: view.orderNumber,
      recipientName: view.address.recipientName,
      paymentMethod: view.paymentMethod,
      lines: view.items.map((item) => ({
        title: item.productTitle,
        variantTitle: item.variantTitle,
        quantity: item.quantity,
        lineTotal: formatINR(item.lineTotalInPaise),
      })),
      subtotal: formatINR(view.subtotalInPaise),
      shipping:
        view.shippingInPaise === 0 ? "free" : formatINR(view.shippingInPaise),
      codFee: view.codFeeInPaise > 0 ? formatINR(view.codFeeInPaise) : null,
      total: formatINR(view.totalInPaise),
      addressLines: [
        view.address.line1,
        view.address.line2,
        view.address.landmark,
        `${view.address.city}, ${view.address.state} ${view.address.postalCode}`,
      ].filter((line): line is string => Boolean(line)),
      trackUrl: absolute(routes.trackOrder),
    },
  };
}

export async function renderNotification(
  row: OutboxRow,
): Promise<EmailMessage> {
  switch (row.kind) {
    case "order.confirmed": {
      if (!row.orderId) throw new NotificationRenderError("no order");
      const { summary } = await orderSummary(row.orderId);
      return orderConfirmedMessage({ to: row.recipient, summary });
    }
    case "owner.new_order": {
      if (!row.orderId) throw new NotificationRenderError("no order");
      const { summary, customerEmail } = await orderSummary(row.orderId);
      return ownerNewOrderMessage({
        to: row.recipient,
        summary,
        customerEmail,
      });
    }
    case "order.cancelled": {
      const orderNumber = field(row.payload, "orderNumber");
      if (!orderNumber) throw new NotificationRenderError("no order number");
      return orderCancelledMessage({
        to: row.recipient,
        orderNumber,
        reason:
          field(row.payload, "reason") === "customer" ? "customer" : "timeout",
        cartUrl: absolute(routes.cart),
      });
    }
    case "order.refund_requested": {
      const orderNumber = field(row.payload, "orderNumber");
      const amount = numberField(row.payload, "amountInPaise");
      if (!orderNumber || amount === null)
        throw new NotificationRenderError("refund payload incomplete");
      return refundRequestedMessage({
        to: row.recipient,
        orderNumber,
        amount: formatINR(amount),
        reason: field(row.payload, "reason") ?? "late_capture_no_stock",
        trackUrl: absolute(routes.trackOrder),
      });
    }
    case "ops.alert": {
      const payload =
        typeof row.payload === "object" && row.payload !== null
          ? (row.payload as Record<string, unknown>)
          : {};
      const details = Object.entries(payload)
        .filter(
          ([, value]) => typeof value === "string" || typeof value === "number",
        )
        .map(([key, value]) => `${key}: ${String(value)}`);
      return opsAlertMessage({
        to: row.recipient,
        title:
          field(row.payload, "reason") ??
          field(row.payload, "title") ??
          "Attention needed",
        details,
      });
    }
    default:
      throw new NotificationRenderError(
        `unknown notification kind ${row.kind}`,
      );
  }
}
