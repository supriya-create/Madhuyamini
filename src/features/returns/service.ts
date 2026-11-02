import "server-only";

import { daysToMs, getReturnsPolicy } from "@/config/returns-policy";
import { Prisma } from "@/generated/prisma/client";
import type { ReturnStatus } from "@/generated/prisma/enums";
import * as orders from "@/features/orders/data";
import { normalizeOrderNumber } from "@/features/orders/order-number";
import type { CurrentUser } from "@/server/auth/current-user";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import type { RateLimitRule } from "@/server/auth/rate-limit-rules";
import { rateLimitKey } from "@/server/auth/rate-limit-rules";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { AppError, NotFoundError } from "@/server/errors";
import {
  enqueueNotification,
  enqueueOpsAlert,
} from "@/server/notifications/outbox";
import type { NotificationKind } from "@/server/notifications/outbox";

import * as data from "./data";
import type { EvidenceRow, ReturnRequestRow, ReturnableOrderRow } from "./data";
import { generateReturnNumber, normalizeReturnNumber } from "./request-number";
import {
  evaluateReturnRequest,
  ineligibleMessages,
  lineEligibility,
  returnWindow,
} from "./rules";
import type {
  EligibilityLine,
  EligibilityOrder,
  RequestProblem,
  RequestedLine,
} from "./rules";
import type { SubmitReturnInput } from "./schemas";
import { isOpenReturnStatus, nextReturnStatus } from "./transitions";
import type { ReturnEventKind } from "./transitions";
import {
  returnReasonLabels,
  returnStatusLabels,
  returnTimelineLabels,
} from "./types";
import type {
  ReturnEligibilityView,
  ReturnSummaryView,
  ReturnView,
} from "./types";

/**
 * Customer side of returns (docs/phase-8-returns-custom-artwork.md §3).
 * Every function takes the signed-in user and scopes its reads by user id;
 * every mutation runs in one transaction under the order lock, then the
 * request lock (§9.4), re-reads state, applies a pure transition and writes
 * the event and the outbox row with the change. Submitting changes no stock
 * and no money.
 */

type Tx = Prisma.TransactionClient;

export class ReturnError extends AppError {
  constructor(message: string, code: string, status = 409) {
    super(message, { code, status });
  }
}

export class ReturnIneligibleError extends ReturnError {
  readonly problems: readonly RequestProblem[];

  constructor(problems: readonly RequestProblem[]) {
    const first = problems[0];
    super(
      first
        ? ineligibleMessages[first.reason]
        : "This return cannot be requested.",
      "RETURN_INELIGIBLE",
      422,
    );
    this.problems = problems;
  }
}

async function limit(key: string, rule: RateLimitRule, now: Date) {
  const outcome = await consumeRateLimit(key, rule, now.getTime());
  if (!outcome.allowed) {
    throw new ReturnError(
      "Too many requests in a short time. Please try again later.",
      "RETURN_RATE_LIMITED",
      429,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

function toEligibilityOrder(
  row: ReturnableOrderRow,
  used: ReadonlyMap<string, number>,
  hasOpenRequest: boolean,
): EligibilityOrder {
  return {
    status: row.status,
    deliveredAt: row.shipment?.deliveredAt ?? null,
    hasOpenRequest,
    lines: row.items.map((item): EligibilityLine => ({
      orderItemId: item.id,
      variantId: item.variantId,
      quantity: item.quantity,
      categorySlug: item.variant.product.category.slug,
      isOneOfAKind: item.variant.product.isOneOfAKind,
      productKind: item.variant.product.kind,
      usedQty: used.get(item.id) ?? 0,
    })),
  };
}

function exchangeOptionsFor(item: ReturnableOrderRow["items"][number]) {
  const policy = getReturnsPolicy();
  if (!policy.exchanges.enabled) return [];
  return item.variant.product.variants
    .filter(
      (variant) =>
        variant.id !== item.variantId &&
        variant.inventory !== null &&
        variant.inventory.stockOnHand - variant.inventory.reserved > 0,
    )
    .map((variant) => ({
      variantId: variant.id,
      label: variant.title ?? variant.sku,
    }));
}

/** What the account order page and the request form show, for the owner only. */
export async function getReturnEligibility(
  user: CurrentUser,
  orderNumber: string,
  now = new Date(),
): Promise<ReturnEligibilityView | null> {
  const normalized = normalizeOrderNumber(orderNumber);
  if (!normalized) return null;
  const row = await data.findReturnableOrder(user.id, normalized);
  if (!row) return null;
  const policy = getReturnsPolicy();
  const [used, open] = await Promise.all([
    data.usedQuantities(db, row.id),
    data.hasOpenRequest(db, row.id),
  ]);
  const order = toEligibilityOrder(row, used, open);
  const window = order.deliveredAt
    ? returnWindow(order.deliveredAt, policy)
    : null;
  const lines = row.items.map((item, index) => {
    const line = order.lines[index];
    if (!line) throw new Error("unreachable");
    const eligibility = lineEligibility(line, order, policy, now);
    return {
      orderItemId: item.id,
      productTitle: item.productTitle,
      variantTitle: item.variantTitle,
      sku: item.sku,
      orderedQty: item.quantity,
      availableQty: eligibility.availableQty,
      reasons: eligibility.reasons,
      ineligible: eligibility.ineligible,
      ineligibleMessage: eligibility.ineligible
        ? ineligibleMessages[eligibility.ineligible]
        : null,
      exchangeOptions: eligibility.ineligible ? [] : exchangeOptionsFor(item),
    };
  });
  return {
    orderId: row.id,
    orderNumber: row.orderNumber,
    deliveredAt: order.deliveredAt,
    windowClosesAt: window?.closesAt ?? null,
    damageReportClosesAt: window?.damageClosesAt ?? null,
    hasOpenRequest: open,
    lines,
    canRequest: lines.some((line) => line.ineligible === null),
    evidenceRequiredForReasons: policy.evidence.requiredForReasons,
  };
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

async function notifyCustomer(
  tx: Tx,
  kind: NotificationKind,
  request: { id: string; orderId: string; requestNumber: string },
  recipient: string,
  payload: Record<string, string | number>,
) {
  await enqueueNotification(tx, {
    kind,
    orderId: request.orderId,
    recipient,
    dedupeKey: `${kind}:${request.id}`,
    payload: { requestNumber: request.requestNumber, ...payload },
  });
}

export async function submitReturnRequest(
  user: CurrentUser,
  input: SubmitReturnInput,
  requestIp: string,
  now = new Date(),
): Promise<{ requestNumber: string; reused: boolean }> {
  const policy = getReturnsPolicy();
  const orderNumber = normalizeOrderNumber(input.orderNumber);
  if (!orderNumber) throw new NotFoundError("Order");
  await limit(
    rateLimitKey("returns:request", user.id),
    policy.limits.requestPerUser,
    now,
  );
  await limit(
    rateLimitKey("returns:request-ip", requestIp),
    policy.limits.requestPerIp,
    now,
  );
  const preview = await data.findReturnableOrder(user.id, orderNumber);
  if (!preview) throw new NotFoundError("Order");

  try {
    return await db.$transaction(async (tx) => {
      await orders.lockOrder(tx, preview.id);
      const existing = await tx.returnRequest.findUnique({
        where: { operationKey: input.operationKey },
        select: { requestNumber: true, orderId: true, userId: true },
      });
      if (existing) {
        if (existing.orderId !== preview.id || existing.userId !== user.id) {
          throw new ReturnError(
            "This form was already used for another request. Reload the page and try again.",
            "RETURN_KEY_CONFLICT",
          );
        }
        return { requestNumber: existing.requestNumber, reused: true };
      }
      const row = await data.findReturnableOrder(user.id, orderNumber, tx);
      if (!row) throw new NotFoundError("Order");
      const [used, open] = await Promise.all([
        data.usedQuantities(tx, row.id),
        data.hasOpenRequest(tx, row.id),
      ]);
      const order = toEligibilityOrder(row, used, open);
      const evidenceIds = [...new Set(input.evidenceIds)];
      const evidence = await data.findVerifiedEvidence(
        tx,
        user.id,
        evidenceIds,
      );
      if (evidence.length !== evidenceIds.length) {
        throw new ReturnError(
          "One of the photographs could not be used. Remove it and try again.",
          "EVIDENCE_INVALID",
          422,
        );
      }
      if (evidence.length > policy.evidence.maxPerRequest) {
        throw new ReturnError(
          `At most ${policy.evidence.maxPerRequest} photographs can be attached.`,
          "EVIDENCE_TOO_MANY",
          422,
        );
      }
      const byItem = new Map(row.items.map((item) => [item.id, item]));
      const requested: RequestedLine[] = input.lines.map((line) => ({
        orderItemId: line.orderItemId,
        quantity: line.quantity,
        reason: line.reason,
        resolution: line.resolution,
        exchangeVariantId: line.exchangeVariantId
          ? line.exchangeVariantId
          : null,
      }));
      if (
        new Set(requested.map((line) => line.orderItemId)).size !==
        requested.length
      ) {
        throw new ReturnError(
          "Each item appears once in a request.",
          "RETURN_DUPLICATE_LINE",
          422,
        );
      }
      const problems = evaluateReturnRequest(order, requested, policy, now, {
        evidenceCount: evidence.length,
        exchangeVariantOk: (line) => {
          const item = byItem.get(line.orderItemId);
          if (!item || !line.exchangeVariantId) return false;
          return exchangeOptionsFor(item).some(
            (option) => option.variantId === line.exchangeVariantId,
          );
        },
      });
      if (problems.length > 0) throw new ReturnIneligibleError(problems);

      const created = await tx.returnRequest.create({
        data: {
          requestNumber: generateReturnNumber(),
          orderId: row.id,
          userId: user.id,
          status: "REQUESTED",
          operationKey: input.operationKey,
          policySnapshot: {
            windowDays: policy.windowDays,
            damageReportHours: policy.damageReportHours,
            evidenceRequiredForReasons: policy.evidence.requiredForReasons,
            faultReasons: policy.faultReasons,
            clocks: policy.clocks,
            exchanges: policy.exchanges,
            nonReturnableCategorySlugs: policy.nonReturnableCategorySlugs,
          },
          decisionDueAt: new Date(
            now.getTime() + daysToMs(policy.clocks.staffDecisionDays),
          ),
          createdAt: now,
          items: {
            createMany: {
              data: requested.map((line) => {
                const item = byItem.get(line.orderItemId);
                if (!item) throw new Error("unreachable");
                return {
                  orderItemId: line.orderItemId,
                  variantId: item.variantId,
                  requestedQty: line.quantity,
                  reason: line.reason,
                  description:
                    input.lines.find((l) => l.orderItemId === line.orderItemId)
                      ?.description || null,
                  resolutionPreference: line.resolution,
                  exchangeVariantId: line.exchangeVariantId,
                };
              }),
            },
          },
        },
        select: { id: true, requestNumber: true, orderId: true },
      });
      await data.attachEvidence(tx, user.id, evidenceIds, created.id, now);
      const units = requested.reduce((sum, line) => sum + line.quantity, 0);
      await data.recordReturnEvent(tx, {
        returnRequestId: created.id,
        type: "return.requested",
        actor: "CUSTOMER",
        actorUserId: user.id,
        toStatus: "REQUESTED",
        data: { units, lines: requested.length, evidence: evidence.length },
        at: now,
      });
      await orders.recordOrderEvent(tx, {
        orderId: row.id,
        type: "return.requested",
        actor: "CUSTOMER",
        note: `Return ${created.requestNumber} requested for ${units} unit(s).`,
        data: { requestNumber: created.requestNumber, units },
      });
      await notifyCustomer(tx, "return.requested", created, row.email, {
        orderNumber: row.orderNumber,
        units,
      });
      if (env.notifications.ownerEmail) {
        await enqueueNotification(tx, {
          kind: "owner.return_requested",
          orderId: row.id,
          recipient: env.notifications.ownerEmail,
          dedupeKey: `owner.return_requested:${created.id}`,
          payload: {
            requestNumber: created.requestNumber,
            orderNumber: row.orderNumber,
            units,
          },
        });
      }
      return { requestNumber: created.requestNumber, reused: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReturnIneligibleError([
        { orderItemId: null, reason: "REQUEST_ALREADY_OPEN" },
      ]);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Customer actions on an existing request
// ---------------------------------------------------------------------------

async function loadOwnedLocked(
  tx: Tx,
  user: CurrentUser,
  requestNumber: string,
): Promise<ReturnRequestRow> {
  const preview = await data.findRequestForUser(user.id, requestNumber, tx);
  if (!preview) throw new NotFoundError("Return request");
  await orders.lockOrder(tx, preview.orderId);
  await data.lockReturnRequest(tx, preview.id);
  const row = await data.findRequestForUser(user.id, requestNumber, tx);
  if (!row) throw new NotFoundError("Return request");
  return row;
}

function transitionOrThrow(status: ReturnStatus, event: ReturnEventKind) {
  const next = nextReturnStatus(status, event);
  if (!next) {
    throw new ReturnError(
      `This return is ${returnStatusLabels[status].toLowerCase()}; that step no longer applies.`,
      "RETURN_STATE",
    );
  }
  return next;
}

export async function withdrawReturnRequest(
  user: CurrentUser,
  requestNumberInput: string,
  now = new Date(),
): Promise<void> {
  const requestNumber = normalizeReturnNumber(requestNumberInput);
  if (!requestNumber) throw new NotFoundError("Return request");
  await limit(
    rateLimitKey("returns:withdraw", user.id),
    getReturnsPolicy().limits.withdrawPerUser,
    now,
  );
  await db.$transaction(async (tx) => {
    const row = await loadOwnedLocked(tx, user, requestNumber);
    const next = transitionOrThrow(row.status, "withdraw");
    const updated = await tx.returnRequest.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: next, closedAt: now },
    });
    if (updated.count !== 1)
      throw new ReturnError("Try again.", "RETURN_STATE");
    await data.recordReturnEvent(tx, {
      returnRequestId: row.id,
      type: "return.withdrawn",
      actor: "CUSTOMER",
      actorUserId: user.id,
      fromStatus: row.status,
      toStatus: next,
      at: now,
    });
    await notifyCustomer(tx, "return.withdrawn", row, row.order.email, {
      orderNumber: row.order.orderNumber,
    });
  });
}

export async function replyToReturnRequest(
  user: CurrentUser,
  requestNumberInput: string,
  body: string,
  now = new Date(),
): Promise<void> {
  const requestNumber = normalizeReturnNumber(requestNumberInput);
  if (!requestNumber) throw new NotFoundError("Return request");
  const policy = getReturnsPolicy();
  if (body.length > policy.messageMaxLength) {
    throw new ReturnError(
      "That message is too long.",
      "RETURN_MESSAGE_LENGTH",
      422,
    );
  }
  const preview = await data.findRequestForUser(user.id, requestNumber);
  if (!preview) throw new NotFoundError("Return request");
  await limit(
    rateLimitKey("returns:message", preview.id),
    policy.limits.messagePerRequest,
    now,
  );
  await db.$transaction(async (tx) => {
    const row = await loadOwnedLocked(tx, user, requestNumber);
    if (!isOpenReturnStatus(row.status)) {
      throw new ReturnError(
        "This return is closed; messages can no longer be added.",
        "RETURN_STATE",
      );
    }
    const message = await tx.returnMessage.create({
      data: {
        returnRequestId: row.id,
        author: "CUSTOMER",
        authorUserId: user.id,
        body,
        createdAt: now,
      },
      select: { id: true },
    });
    const next = nextReturnStatus(row.status, "customer_replied");
    if (next) {
      await tx.returnRequest.updateMany({
        where: { id: row.id, status: row.status },
        data: {
          status: next,
          decisionDueAt: new Date(
            now.getTime() + daysToMs(policy.clocks.staffDecisionDays),
          ),
        },
      });
    }
    await data.recordReturnEvent(tx, {
      returnRequestId: row.id,
      type: "return.customer_replied",
      actor: "CUSTOMER",
      actorUserId: user.id,
      fromStatus: next ? row.status : null,
      toStatus: next,
      data: { messageId: message.id },
      at: now,
    });
    await enqueueOpsAlert(tx, {
      key: `return-message:${row.id}:${message.id}`,
      orderId: row.orderId,
      payload: {
        reason: "A customer replied on a return request",
        requestNumber: row.requestNumber,
        orderNumber: row.order.orderNumber,
      },
    });
  });
}

export async function recordReturnShipment(
  user: CurrentUser,
  requestNumberInput: string,
  input: {
    readonly carrier: string;
    readonly trackingNumber: string | null;
    readonly trackingUrl: string | null;
  },
  now = new Date(),
): Promise<void> {
  const requestNumber = normalizeReturnNumber(requestNumberInput);
  if (!requestNumber) throw new NotFoundError("Return request");
  const policy = getReturnsPolicy();
  const preview = await data.findRequestForUser(user.id, requestNumber);
  if (!preview) throw new NotFoundError("Return request");
  await limit(
    rateLimitKey("returns:shipment", preview.id),
    policy.limits.shipmentPerRequest,
    now,
  );
  await db.$transaction(async (tx) => {
    const row = await loadOwnedLocked(tx, user, requestNumber);
    const next = transitionOrThrow(row.status, "shipped");
    const receiveByAt = new Date(
      now.getTime() + daysToMs(policy.clocks.receiveByDays),
    );
    const updated = await tx.returnRequest.updateMany({
      where: { id: row.id, status: row.status },
      data: { status: next, receiveByAt },
    });
    if (updated.count !== 1)
      throw new ReturnError("Try again.", "RETURN_STATE");
    await tx.returnShipment.create({
      data: {
        returnRequestId: row.id,
        direction: "INBOUND",
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl,
        shippedAt: now,
        recordedBy: "CUSTOMER",
        recordedByUserId: user.id,
        createdAt: now,
      },
    });
    await data.recordReturnEvent(tx, {
      returnRequestId: row.id,
      type: "return.shipped",
      actor: "CUSTOMER",
      actorUserId: user.id,
      fromStatus: row.status,
      toStatus: next,
      note: input.trackingNumber
        ? `${input.carrier}, ${input.trackingNumber}`
        : input.carrier,
      data: { receiveByAt: receiveByAt.toISOString() },
      at: now,
    });
  });
}

export async function addReturnEvidence(
  user: CurrentUser,
  requestNumberInput: string,
  evidenceIds: readonly string[],
  now = new Date(),
): Promise<number> {
  const requestNumber = normalizeReturnNumber(requestNumberInput);
  if (!requestNumber) throw new NotFoundError("Return request");
  const policy = getReturnsPolicy();
  return db.$transaction(async (tx) => {
    const row = await loadOwnedLocked(tx, user, requestNumber);
    if (
      !isOpenReturnStatus(row.status) ||
      row.status === "RECEIVED" ||
      row.status === "INSPECTED"
    ) {
      throw new ReturnError(
        "Photographs can be added only while the return is being reviewed or on its way.",
        "RETURN_STATE",
      );
    }
    const ids = [...new Set(evidenceIds)];
    const existing = await data.listEvidenceForRequest(row.id, tx);
    if (existing.length + ids.length > policy.evidence.maxPerRequest) {
      throw new ReturnError(
        `At most ${policy.evidence.maxPerRequest} photographs can be attached.`,
        "EVIDENCE_TOO_MANY",
        422,
      );
    }
    const attached = await data.attachEvidence(tx, user.id, ids, row.id, now);
    if (attached !== ids.length) {
      throw new ReturnError(
        "One of the photographs could not be used. Remove it and try again.",
        "EVIDENCE_INVALID",
        422,
      );
    }
    await data.recordReturnEvent(tx, {
      returnRequestId: row.id,
      type: "return.evidence_added",
      actor: "CUSTOMER",
      actorUserId: user.id,
      data: { count: attached },
      at: now,
    });
    return attached;
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function instructionsOf(row: ReturnRequestRow) {
  const snapshot = row.instructionsSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return null;
  const record = snapshot as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : null;
  const payer = record.payer === "SHOP" ? "SHOP" : "CUSTOMER";
  if (!text) return null;
  return { text, payer, shipByAt: row.shipByAt } as const;
}

export function toReturnView(
  row: ReturnRequestRow,
  evidence: readonly EvidenceRow[],
): ReturnView {
  const policy = getReturnsPolicy();
  const open = isOpenReturnStatus(row.status);
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    orderNumber: row.order.orderNumber,
    status: row.status,
    statusLabel: returnStatusLabels[row.status],
    createdAt: row.createdAt,
    decisionDueAt: row.decisionDueAt,
    receiveByAt: row.receiveByAt,
    closedAt: row.closedAt,
    rejectionReason: row.rejectionReason,
    instructions: instructionsOf(row),
    items: row.items.map((item) => ({
      id: item.id,
      productTitle: item.orderItem.productTitle,
      variantTitle: item.orderItem.variantTitle,
      sku: item.orderItem.sku,
      requestedQty: item.requestedQty,
      approvedQty: item.approvedQty,
      receivedQty: item.receivedQty,
      reason: item.reason,
      reasonLabel: returnReasonLabels[item.reason],
      description: item.description,
      resolution: item.resolutionPreference,
      exchangeVariantLabel: item.exchangeVariant
        ? (item.exchangeVariant.title ?? item.exchangeVariant.sku)
        : null,
      condition: item.condition,
      outcome: item.inspected
        ? {
            restocked: item.restockQty,
            repair: item.repairQty,
            quarantine: item.quarantineQty,
            writtenOff: item.writeOffQty,
            returnedToCustomer: item.returnToCustomerQty,
            notReceived: item.notReceivedQty,
          }
        : null,
    })),
    shipments: row.shipments.map((shipment) => ({
      id: shipment.id,
      direction: shipment.direction,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      shippedAt: shipment.shippedAt,
      receivedAt: shipment.receivedAt,
    })),
    messages: row.messages.map((message) => ({
      id: message.id,
      author: message.author,
      body: message.body,
      at: message.createdAt,
    })),
    timeline: row.events
      .filter((event) => event.visibleToCustomer)
      .map((event) => ({
        id: event.id,
        at: event.createdAt,
        label: returnTimelineLabels[event.type] ?? "Update",
        note: event.note,
      })),
    evidence: evidence.map((file) => ({
      id: file.id,
      width: file.width,
      height: file.height,
    })),
    canWithdraw: nextReturnStatus(row.status, "withdraw") !== null,
    canReply: open,
    canRecordShipment: row.status === "APPROVED",
    canAddEvidence:
      open &&
      row.status !== "RECEIVED" &&
      row.status !== "INSPECTED" &&
      evidence.length < policy.evidence.maxPerRequest,
  };
}

export async function getReturnView(
  user: CurrentUser,
  requestNumberInput: string,
): Promise<ReturnView | null> {
  const requestNumber = normalizeReturnNumber(requestNumberInput);
  if (!requestNumber) return null;
  const row = await data.findRequestForUser(user.id, requestNumber);
  if (!row) return null;
  const evidence = await data.listEvidenceForRequest(row.id);
  return toReturnView(row, evidence);
}

export async function listReturnSummaries(
  user: CurrentUser,
): Promise<ReturnSummaryView[]> {
  const rows = await data.listRequestsForUser(user.id);
  return rows.map((row) => ({
    id: row.id,
    requestNumber: row.requestNumber,
    orderNumber: row.order.orderNumber,
    status: row.status,
    statusLabel: returnStatusLabels[row.status],
    createdAt: row.createdAt,
    units: row.items.reduce((sum, item) => sum + item.requestedQty, 0),
  }));
}

export async function listReturnsForOrder(
  user: CurrentUser,
  orderId: string,
): Promise<ReturnSummaryView[]> {
  const rows = await data.listRequestsForOrder(user.id, orderId);
  return rows.map((row) => ({
    id: row.id,
    requestNumber: row.requestNumber,
    orderNumber: "",
    status: row.status,
    statusLabel: returnStatusLabels[row.status],
    createdAt: row.createdAt,
    units: row.items.reduce((sum, item) => sum + item.requestedQty, 0),
  }));
}
