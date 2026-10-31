export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** Lets the provider drop a duplicate send of the same fact (outbox retries). */
  readonly idempotencyKey?: string;
}

export interface EmailTransport {
  readonly name: "file" | "log" | "resend";
  send(message: EmailMessage & { readonly from: string }): Promise<void>;
}
