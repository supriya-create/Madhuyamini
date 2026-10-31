import { NextResponse } from "next/server";

import {
  ingestWebhook,
  processWebhookEvent,
} from "@/features/payments/webhook";

/**
 * Razorpay webhook receiver (docs/checkout.md §6, §5.8). No cookies, no
 * session: the raw body's signature is the only credential. 200 means
 * "stored"; applying happens inline when possible and by the
 * process-webhooks job otherwise, so a delivery is never lost or applied twice.
 */

export const dynamic = "force-dynamic";

/** Payloads are a few KB; anything larger is not from Razorpay. */
const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  const now = new Date();
  let outcome;
  try {
    outcome = await ingestWebhook({
      rawBody,
      signature: request.headers.get("x-razorpay-signature"),
      eventId: request.headers.get("x-razorpay-event-id"),
      now,
    });
  } catch (error) {
    // Could not store the delivery: ask Razorpay to retry.
    console.error("[webhook] ingest failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "try again" }, { status: 500 });
  }

  switch (outcome.status) {
    case "invalid_signature":
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    case "malformed":
      return NextResponse.json({ error: "malformed body" }, { status: 400 });
    case "duplicate":
    case "stored": {
      // Best effort inline; failures are recorded on the ledger row and retried.
      const applied = await processWebhookEvent(outcome.eventId, { now }).catch(
        (error: unknown) => {
          console.error("[webhook] apply failed", {
            eventId: outcome.eventId,
            reason: error instanceof Error ? error.message : "unknown",
          });
          return "retry_scheduled" as const;
        },
      );
      return NextResponse.json({ ok: true, applied }, { status: 200 });
    }
  }
}

export function GET(): Response {
  return NextResponse.json({ error: "method not allowed" }, { status: 405 });
}
