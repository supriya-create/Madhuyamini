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

export function orderCancelledMessage(params: {
  to: string;
  orderNumber: string;
  reason: "timeout" | "customer";
  cartUrl: string;
}): EmailMessage {
  const why =
    params.reason === "timeout"
      ? "the payment was not completed in time, so the pieces were released"
      : "you cancelled it";
  return {
    to: params.to,
    subject: `Order ${params.orderNumber} cancelled — ${BRAND}`,
    ...layout(
      [
        `Order ${params.orderNumber} has been cancelled because ${why}.`,
        `Nothing has been charged. Your cart is still waiting if you would like to try again.`,
      ],
      { label: "Return to your cart", url: params.cartUrl },
    ),
  };
}

export function refundRequestedMessage(params: {
  to: string;
  orderNumber: string;
  amount: string;
  reason: "late_capture_no_stock" | "duplicate_payment" | string;
  trackUrl: string;
}): EmailMessage {
  const why =
    params.reason === "duplicate_payment"
      ? "a second payment reached us for an order that was already paid"
      : "the payment reached us after the pieces had been released and they are no longer available";
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
