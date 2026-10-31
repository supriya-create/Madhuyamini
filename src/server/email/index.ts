import "server-only";

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
