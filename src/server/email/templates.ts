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
