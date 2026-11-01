import type { EmailMessage } from "./types";

/**
 * Plain-text first, with a minimal HTML twin. No images or tracking. Tokens
 * only ever appear inside the one-time URL, never in subjects.
 */

const BRAND = "Madhuyamini";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(
  paragraphs: readonly string[],
  action?: { label: string; url: string },
) {
  const text = [
    ...paragraphs,
    ...(action ? [`${action.label}: ${action.url}`] : []),
    `— ${BRAND}`,
  ].join("\n\n");

  const html = [
    `<div style="font-family: Georgia, serif; color: #231a15; max-width: 36em; line-height: 1.5">`,
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    ...(action
      ? [
          `<p><a href="${escapeHtml(action.url)}" style="color: #9b2d20">${escapeHtml(action.label)}</a></p>`,
          `<p style="font-size: 0.875em; color: #5a4335">If the link does not open, copy this address into your browser:<br>${escapeHtml(action.url)}</p>`,
        ]
      : []),
    `<p>— ${BRAND}</p>`,
    `</div>`,
  ].join("\n");

  return { text, html };
}

export function verifyEmailMessage(params: {
  to: string;
  name: string;
  url: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `Confirm your email address for ${BRAND}`,
    ...layout(
      [
        `Hello ${params.name},`,
        `Please confirm this email address so we can send order updates to the right place. The link works for 24 hours.`,
        `If you did not create an account with ${BRAND}, you can ignore this message.`,
      ],
      { label: "Confirm email address", url: params.url },
    ),
  };
}

export function resetPasswordMessage(params: {
  to: string;
  name: string;
  url: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `Reset your ${BRAND} password`,
    ...layout(
      [
        `Hello ${params.name},`,
        `Someone asked to reset the password for this address. If that was you, use the link below within 30 minutes. If it was not, nothing has changed and you can ignore this message.`,
      ],
      { label: "Choose a new password", url: params.url },
    ),
  };
}

export function passwordChangedMessage(params: {
  to: string;
  name: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `Your ${BRAND} password was changed`,
    ...layout([
      `Hello ${params.name},`,
      `The password for your ${BRAND} account was just changed and other devices were signed out. If you did this, there is nothing more to do.`,
      `If you did not change it, reset your password straight away from the sign-in page and contact us.`,
    ]),
  };
}

// ---------------------------------------------------------------------------
// Orders (Phase 6). Amounts arrive formatted; templates never do arithmetic.
// ---------------------------------------------------------------------------

export interface OrderEmailLine {
  readonly title: string;
  readonly variantTitle: string | null;
  readonly quantity: number;
  readonly lineTotal: string;
}

export interface OrderEmailSummary {
  readonly orderNumber: string;
  readonly recipientName: string;
  readonly paymentMethod: "RAZORPAY" | "COD";
  readonly lines: readonly OrderEmailLine[];
  readonly subtotal: string;
  readonly shipping: string;
  readonly codFee: string | null;
  readonly total: string;
  readonly addressLines: readonly string[];
  readonly trackUrl: string;
}

function describeLines(summary: OrderEmailSummary): string[] {
  return [
    ...summary.lines.map(
      (line) =>
        `${line.quantity} × ${line.title}${line.variantTitle ? ` (${line.variantTitle})` : ""} — ${line.lineTotal}`,
    ),
    `Subtotal ${summary.subtotal} · Shipping ${summary.shipping}${summary.codFee ? ` · Cash on delivery fee ${summary.codFee}` : ""} · Total ${summary.total}`,
  ];
}

export function orderConfirmedMessage(params: {
  to: string;
  summary: OrderEmailSummary;
}): EmailMessage {
  const { summary } = params;
  const payment =
    summary.paymentMethod === "COD"
      ? `Please keep ${summary.total} ready to pay on delivery.`
      : `Your payment of ${summary.total} has been received.`;
  return {
    to: params.to,
    subject: `Order ${summary.orderNumber} confirmed — ${BRAND}`,
    ...layout(
      [
        `Hello ${summary.recipientName},`,
        `Thank you for your order ${summary.orderNumber}. ${payment}`,
        ...describeLines(summary),
        `Delivery to: ${summary.addressLines.join(", ")}`,
        `We will write again when it is on its way.`,
      ],
      { label: "View your order", url: summary.trackUrl },
    ),
  };
}

export type CancellationEmailReason =
  "timeout" | "customer" | "shop" | "returned" | "lost";

export function orderCancelledMessage(params: {
  to: string;
  orderNumber: string;
  reason: CancellationEmailReason;
  cartUrl: string;
  /** True when a refund has been queued for a payment that reached us. */
  refundQueued?: boolean;
}): EmailMessage {
  const why: Record<CancellationEmailReason, string> = {
    timeout:
      "the payment was not completed in time, so the pieces were released",
    customer: "you cancelled it",
    shop: "we were unable to fulfil it",
    returned: "the parcel could not be delivered and has come back to us",
    lost: "the parcel was lost in transit and the carrier has confirmed it",
  };
  const money = params.refundQueued
    ? "A refund of the amount you paid has been requested with our payment provider; you will receive a separate email about it."
    : params.reason === "timeout" || params.reason === "customer"
      ? "Nothing has been charged. Your cart is still waiting if you would like to try again."
      : "Nothing further is owed. We are sorry for the trouble.";
  return {
    to: params.to,
    subject: `Order ${params.orderNumber} cancelled — ${BRAND}`,
    ...layout(
      [
        `Order ${params.orderNumber} has been cancelled because ${why[params.reason]}.`,
        money,
      ],
      { label: "Return to your cart", url: params.cartUrl },
    ),
  };
}

export function orderShippedMessage(params: {
  to: string;
  orderNumber: string;
  carrier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  trackUrl: string;
}): EmailMessage {
  const tracking = params.trackingNumber
    ? `It was handed to ${params.carrier} with tracking number ${params.trackingNumber}.`
    : `It was handed to ${params.carrier}.`;
  return {
    to: params.to,
    subject: `Order ${params.orderNumber} is on its way — ${BRAND}`,
    ...layout(
      [`Good news: order ${params.orderNumber} has been shipped.`, tracking],
      params.trackingUrl
        ? { label: "Track the parcel", url: params.trackingUrl }
        : { label: "View your order", url: params.trackUrl },
    ),
  };
}

export function orderDeliveredMessage(params: {
  to: string;
  orderNumber: string;
  trackUrl: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `Order ${params.orderNumber} has been delivered — ${BRAND}`,
    ...layout(
      [
        `Order ${params.orderNumber} has been delivered.`,
        "We hope the pieces bring you joy. If anything is not as expected, reply to this email with your order number.",
      ],
      { label: "View your order", url: params.trackUrl },
    ),
  };
}

export function orderDeliveryFailedMessage(params: {
  to: string;
  orderNumber: string;
  trackUrl: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `Order ${params.orderNumber} could not be delivered — ${BRAND}`,
    ...layout(
      [
        `The carrier could not deliver order ${params.orderNumber}, and the parcel is being returned to us.`,
        "Once it is back and checked we will close the order, and any payment that reached us will be refunded. If you would like the pieces re-sent, reply to this email with your order number.",
      ],
      { label: "View your order", url: params.trackUrl },
    ),
  };
}

export function refundRequestedMessage(params: {
  to: string;
  orderNumber: string;
  amount: string;
  reason: string;
  trackUrl: string;
}): EmailMessage {
  const reasons: Record<string, string> = {
    duplicate_payment:
      "a second payment reached us for an order that was already paid",
    late_capture_no_stock:
      "the payment reached us after the pieces had been released and they are no longer available",
    cancelled_by_shop: "we were unable to fulfil your order",
    review_cancelled:
      "we could not complete your order after checking the payment",
    delivery_failed:
      "the parcel could not be delivered and has come back to us",
    carrier_lost: "the parcel was lost in transit",
    partial_refund: "part of your order is being refunded",
  };
  const why = reasons[params.reason] ?? "your order could not be completed";
  return {
    to: params.to,
    subject: `Refund of ${params.amount} for order ${params.orderNumber} — ${BRAND}`,
    ...layout(
      [
        `We are sorry: ${why}.`,
        `A refund of ${params.amount} has been requested with our payment provider. It usually reaches the original payment method within 5–7 working days.`,
        `If you have any questions, reply to this email with your order number ${params.orderNumber}.`,
      ],
      { label: "View your order", url: params.trackUrl },
    ),
  };
}

export function ownerNewOrderMessage(params: {
  to: string;
  summary: OrderEmailSummary;
  customerEmail: string;
}): EmailMessage {
  const { summary } = params;
  return {
    to: params.to,
    subject: `New order ${summary.orderNumber} (${summary.total}, ${summary.paymentMethod === "COD" ? "cash on delivery" : "paid online"})`,
    ...layout([
      `A new order was placed by ${params.customerEmail}.`,
      ...describeLines(summary),
      `Deliver to: ${summary.recipientName}, ${summary.addressLines.join(", ")}`,
    ]),
  };
}

export function opsAlertMessage(params: {
  to: string;
  title: string;
  details: readonly string[];
}): EmailMessage {
  return {
    to: params.to,
    subject: `[${BRAND} ops] ${params.title}`,
    ...layout([params.title, ...params.details]),
  };
}

export function recoveryCodeUsedMessage(params: {
  to: string;
  remaining: number;
  securityUrl: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `A recovery code was used to sign in to ${BRAND}`,
    ...layout(
      [
        "One of your recovery codes was just used to pass two-factor sign-in on your staff account.",
        params.remaining === 0
          ? "You have no recovery codes left. Ask an admin to reset your second factor so you can set it up again with new codes."
          : `You have ${params.remaining} recovery ${params.remaining === 1 ? "code" : "codes"} left.`,
        "If this was not you, ask an admin to reset your second factor and change your password straight away.",
      ],
      { label: "Review your sign-in security", url: params.securityUrl },
    ),
  };
}
