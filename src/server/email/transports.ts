import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { EmailTransport } from "./types";

/** Writes each message as JSON into a directory; tests and local development read it. */
export function fileTransport(directory: string): EmailTransport {
  return {
    name: "file",
    async send(message) {
      await mkdir(directory, { recursive: true });
      const file = join(directory, `${Date.now()}-${randomUUID()}.json`);
      await writeFile(
        file,
        JSON.stringify(
          { ...message, sentAt: new Date().toISOString() },
          null,
          2,
        ),
      );
    },
  };
}

/** Prints the subject and recipient only; bodies may contain one-time links. */
export function logTransport(): EmailTransport {
  return {
    name: "log",
    send(message) {
      console.warn(
        `[email:log] to=${message.to} subject=${JSON.stringify(message.subject)}`,
      );
      return Promise.resolve();
    },
  };
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Resend over its REST API (no SDK needed for one endpoint). The key is read
 * at send time, so a deployment without it builds fine and fails only when
 * an email is actually attempted, with a clear error.
 */
export function resendTransport(apiKey: string | null): EmailTransport {
  return {
    name: "resend",
    async send(message) {
      if (!apiKey) {
        throw new Error(
          "RESEND_API_KEY is not configured; cannot send email in production.",
        );
      }
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!response.ok) {
        // Never include the response body: it could echo the recipient address.
        throw new Error(
          `Resend rejected the message (HTTP ${response.status}).`,
        );
      }
    },
  };
}
