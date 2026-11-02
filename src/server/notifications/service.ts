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
  orderDeliveredMessage,
  orderDeliveryFailedMessage,
  orderShippedMessage,
  ownerNewOrderMessage,
  ownerReturnRequestedMessage,
  recoveryCodeUsedMessage,
  refundRequestedMessage,
  returnUpdateMessage,
} from "@/server/email/templates";
import type {
  CancellationEmailReason,
  OrderEmailSummary,
} from "@/server/email/templates";
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
      const reason = field(row.payload, "reason");
      const known: readonly CancellationEmailReason[] = [
        "timeout",
        "customer",
        "shop",
        "returned",
        "lost",
      ];
      return orderCancelledMessage({
        to: row.recipient,
        orderNumber,
        reason: known.find((value) => value === reason) ?? "timeout",
        cartUrl: absolute(routes.cart),
        refundQueued: field(row.payload, "refundQueued") === "yes",
      });
    }
    case "order.shipped": {
      const orderNumber = field(row.payload, "orderNumber");
      const carrier = field(row.payload, "carrier");
      if (!orderNumber || !carrier)
        throw new NotificationRenderError("shipment payload incomplete");
      return orderShippedMessage({
        to: row.recipient,
        orderNumber,
        carrier,
        trackingNumber: field(row.payload, "trackingNumber"),
        trackingUrl: field(row.payload, "trackingUrl"),
        trackUrl: absolute(routes.trackOrder),
      });
    }
    case "order.delivered": {
      const orderNumber = field(row.payload, "orderNumber");
      if (!orderNumber) throw new NotificationRenderError("no order number");
      return orderDeliveredMessage({
        to: row.recipient,
        orderNumber,
        trackUrl: absolute(routes.trackOrder),
      });
    }
    case "order.delivery_failed": {
      const orderNumber = field(row.payload, "orderNumber");
      if (!orderNumber) throw new NotificationRenderError("no order number");
      return orderDeliveryFailedMessage({
        to: row.recipient,
        orderNumber,
        trackUrl: absolute(routes.trackOrder),
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
    case "return.requested":
    case "return.info_requested":
    case "return.approved":
    case "return.rejected":
    case "return.received":
    case "return.inspected":
    case "return.expired":
    case "return.withdrawn": {
      const requestNumber = field(row.payload, "requestNumber");
      const orderNumber = field(row.payload, "orderNumber");
      if (!requestNumber || !orderNumber)
        throw new NotificationRenderError("return payload incomplete");
      const returnUrl = absolute(routes.accountReturn(requestNumber));
      const common = {
        to: row.recipient,
        requestNumber,
        orderNumber,
        returnUrl,
      };
      switch (row.kind) {
        case "return.requested":
          return returnUpdateMessage({
            ...common,
            subject: `We have your return request ${requestNumber}`,
            paragraphs: [
              `We will review it and reply within a few days. Nothing needs to be sent yet; wait for our instructions.`,
            ],
          });
        case "return.info_requested":
          return returnUpdateMessage({
            ...common,
            subject: `A question about your return ${requestNumber}`,
            paragraphs: [
              "We need a little more information before we can decide. Please read our question on the return page and reply there.",
            ],
          });
        case "return.approved": {
          const instructions = field(row.payload, "instructions") ?? "";
          const shipBy = field(row.payload, "shipByAt");
          const payer = field(row.payload, "payer");
          return returnUpdateMessage({
            ...common,
            subject: `Your return ${requestNumber} is approved`,
            paragraphs: [
              `Please send the approved items back to us${shipBy ? ` by ${shipBy.slice(0, 10)}` : ""}.`,
              payer === "SHOP"
                ? "Return shipping is on us; the instructions below explain how."
                : "Return shipping is arranged and paid by you; the instructions below explain how.",
              instructions,
              "Once you have sent the parcel, record the carrier and tracking number on the return page.",
            ],
          });
        }
        case "return.rejected":
          return returnUpdateMessage({
            ...common,
            subject: `Your return ${requestNumber} was not accepted`,
            paragraphs: [
              `Reason: ${field(row.payload, "reason") ?? "see the return page"}.`,
              "If you think this is a mistake, reply on the return page and we will look again.",
            ],
          });
        case "return.received": {
          const received = numberField(row.payload, "received") ?? 0;
          const missing = numberField(row.payload, "missing") ?? 0;
          return returnUpdateMessage({
            ...common,
            subject: `We have received your return ${requestNumber}`,
            paragraphs: [
              `${received} unit${received === 1 ? "" : "s"} arrived and will be inspected.`,
              ...(missing > 0
                ? [
                    `${missing} approved unit${missing === 1 ? " was" : "s were"} not in the parcel; only what arrived can be inspected.`,
                  ]
                : []),
            ],
          });
        }
        case "return.inspected": {
          const restocked = numberField(row.payload, "restocked") ?? 0;
          const held = numberField(row.payload, "held") ?? 0;
          const writtenOff = numberField(row.payload, "writtenOff") ?? 0;
          const back = numberField(row.payload, "returnedToCustomer") ?? 0;
          return returnUpdateMessage({
            ...common,
            subject: `Your return ${requestNumber} has been inspected`,
            paragraphs: [
              `Accepted in good condition: ${restocked}. Set aside for repair or checks: ${held}. Not accepted: ${writtenOff + back}.`,
              "What happens next (a refund or a replacement) will follow on the return page.",
            ],
          });
        }
        case "return.expired":
          return returnUpdateMessage({
            ...common,
            subject: `Your return ${requestNumber} has expired`,
            paragraphs: [
              "The parcel was not sent by the ship-by date, so the request has closed. You can start a new request while the return window is open.",
            ],
          });
        default:
          return returnUpdateMessage({
            ...common,
            subject: `Your return ${requestNumber} was withdrawn`,
            paragraphs: [
              "You withdrew this request; nothing else changes on your order.",
            ],
          });
      }
    }
    case "owner.return_requested": {
      const requestNumber = field(row.payload, "requestNumber");
      const orderNumber = field(row.payload, "orderNumber");
      if (!requestNumber || !orderNumber)
        throw new NotificationRenderError("return payload incomplete");
      return ownerReturnRequestedMessage({
        to: row.recipient,
        requestNumber,
        orderNumber,
        units: numberField(row.payload, "units") ?? 0,
        adminUrl: absolute(routes.adminReturns),
      });
    }
    case "security.recovery_code_used": {
      const remaining = numberField(row.payload, "remaining");
      if (remaining === null)
        throw new NotificationRenderError("recovery payload incomplete");
      return recoveryCodeUsedMessage({
        to: row.recipient,
        remaining,
        securityUrl: absolute(routes.accountTwoFactor),
      });
    }
    default:
      throw new NotificationRenderError(
        `unknown notification kind ${row.kind}`,
      );
  }
}
