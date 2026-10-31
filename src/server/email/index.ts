import "server-only";

import { after } from "next/server";

import { env } from "../env";
import { fileTransport, logTransport, resendTransport } from "./transports";
import type { EmailMessage, EmailTransport } from "./types";

function createTransport(): EmailTransport {
  switch (env.email.transport) {
    case "file":
      return fileTransport(env.email.outboxDir);
    case "log":
      return logTransport();
    case "resend":
      return resendTransport(env.email.resendApiKey);
  }
}

let transport: EmailTransport | undefined;

/** Sends one message through the configured transport. Never logs bodies. */
export async function sendEmail(message: EmailMessage): Promise<void> {
  transport ??= createTransport();
  await transport.send({ ...message, from: env.email.from });
}

/**
 * Queues a message to be sent after the current response has been returned,
 * so the time a request takes does not reveal whether an email was sent
 * (account enumeration through timing). Outside a Next.js request scope
 * (integration tests, scripts) `after` is unavailable and the send is awaited.
 */
export async function sendEmailAfterResponse(
  message: EmailMessage,
): Promise<void> {
  const task = () =>
    sendEmail(message).catch((error: unknown) => {
      console.error("[email] deferred send failed", {
        subject: message.subject,
        reason: error instanceof Error ? error.message : "unknown",
      });
    });
  try {
    after(task);
  } catch {
    await task();
  }
}
