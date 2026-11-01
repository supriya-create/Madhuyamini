import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor, PaymentStatus } from "@/generated/prisma/enums";
import * as orders from "@/features/orders/data";
import { nextCodPaymentStatus } from "@/features/orders/transitions";
import type { CodPaymentEventKind } from "@/features/orders/transitions";
import { AppError } from "@/server/errors";

import * as data from "./data";

/**
 * Cash-on-delivery payment transitions (docs/admin.md §5.10). Explicit,
 * audited by the caller, and entirely separate from fulfilment: nothing here
 * reads or writes `orders.status` or inventory. Runs inside the caller's
 * transaction, which already holds the order lock.
 */

export class CodEventError extends AppError {
  constructor(message: string, code: string) {
    super(message, { code, status: 409 });
  }
}

export interface CodEventFacts {
  readonly attemptId: string;
  readonly event: CodPaymentEventKind;
  readonly actor: OrderActor;
  readonly actorUserId: string | null;
  /** Required for `cod_collected`: must equal the attempt amount exactly. */
  readonly amountInPaise?: number;
  readonly reason?: string | null;
  readonly now: Date;
}

export async function applyCodEvent(
  tx: Prisma.TransactionClient,
  facts: CodEventFacts,
): Promise<{ readonly status: PaymentStatus }> {
  const attempt = await data.findAttempt(facts.attemptId, tx);
  if (!attempt)
    throw new CodEventError(
      "Payment attempt not found.",
      "COD_ATTEMPT_NOT_FOUND",
    );
  if (attempt.method !== "COD") {
    throw new CodEventError(
      "Not a cash-on-delivery payment.",
      "COD_WRONG_METHOD",
    );
  }
  const next = nextCodPaymentStatus(attempt.status, facts.event);
  if (!next) {
    throw new CodEventError(
      `Cannot ${facts.event.replaceAll("_", " ")} a payment that is ${attempt.status.toLowerCase()}.`,
      "COD_TRANSITION_NOT_ALLOWED",
    );
  }

  if (facts.event === "cod_collected") {
    if (facts.amountInPaise !== attempt.amountInPaise) {
      throw new CodEventError(
        "The amount collected must match the order total exactly.",
        "COD_AMOUNT_MISMATCH",
      );
    }
    await tx.payment.updateMany({
      where: { id: attempt.id, status: attempt.status },
      data: {
        status: "CAPTURED",
        capturedAt: facts.now,
        failedAt: null,
        failureCode: null,
        failureDescription: null,
      },
    });
  } else if (facts.event === "cod_refused") {
    await tx.payment.updateMany({
      where: { id: attempt.id, status: attempt.status },
      data: {
        status: "FAILED",
        failedAt: facts.now,
        failureCode: "COD_REFUSED",
        failureDescription: facts.reason ?? null,
      },
    });
  } else {
    await tx.payment.updateMany({
      where: { id: attempt.id, status: attempt.status },
      data: { status: "CREATED", capturedAt: null },
    });
  }

  await orders.recordOrderEvent(tx, {
    orderId: attempt.orderId,
    type: `payment.${facts.event}`,
    actor: facts.actor,
    note: facts.reason ?? null,
    data: {
      attemptNo: attempt.attemptNo,
      amountInPaise: facts.amountInPaise ?? attempt.amountInPaise,
      actorUserId: facts.actorUserId,
    },
  });
  return { status: next };
}
