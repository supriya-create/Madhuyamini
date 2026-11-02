import type {
  ReturnItemCondition,
  ReturnReason,
  ReturnResolution,
  ReturnStatus,
} from "@/generated/prisma/enums";
import { maskEmail } from "@/features/orders/types";
import { nextReturnStatus } from "@/features/returns/transitions";
import {
  returnReasonLabels,
  returnStatusLabels,
} from "@/features/returns/types";

import { maskPhone } from "../redact";
import type { AdminReturnBundle, AdminReturnListRow } from "./data";

/**
 * Admin return views (docs/phase-8-returns-custom-artwork.md §11.2). Pages
 * render these, never rows; the customer stays masked as on the customer
 * pages, and files are referenced by ledger id only.
 */

export interface AdminReturnListItem {
  readonly id: string;
  readonly requestNumber: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: ReturnStatus;
  readonly statusLabel: string;
  readonly createdAt: Date;
  readonly dueAt: Date | null;
  readonly dueLabel: string | null;
  readonly units: number;
  readonly recipientName: string;
  readonly emailMasked: string;
}

export function toAdminReturnListItem(
  row: AdminReturnListRow,
): AdminReturnListItem {
  const due =
    row.status === "REQUESTED"
      ? { at: row.decisionDueAt, label: "Decide by" }
      : row.status === "APPROVED"
        ? { at: row.shipByAt, label: "Customer ships by" }
        : row.status === "IN_TRANSIT" || row.status === "OVERDUE"
          ? { at: row.receiveByAt, label: "Expected by" }
          : { at: null, label: null };
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    orderId: row.orderId,
    orderNumber: row.order.orderNumber,
    status: row.status,
    statusLabel: returnStatusLabels[row.status],
    createdAt: row.createdAt,
    dueAt: due.at,
    dueLabel: due.at ? due.label : null,
    units: row.items.reduce(
      (sum, item) => sum + (item.approvedQty ?? item.requestedQty),
      0,
    ),
    recipientName: row.order.recipientName,
    emailMasked: maskEmail(row.order.email),
  };
}

export interface AdminReturnItem {
  readonly id: string;
  readonly orderItemId: string;
  readonly variantId: string;
  readonly productTitle: string;
  readonly variantTitle: string | null;
  readonly sku: string;
  readonly orderedQty: number;
  readonly requestedQty: number;
  readonly approvedQty: number | null;
  readonly receivedQty: number | null;
  readonly reason: ReturnReason;
  readonly reasonLabel: string;
  readonly description: string | null;
  readonly resolution: ReturnResolution;
  readonly exchangeVariantLabel: string | null;
  readonly condition: ReturnItemCondition | null;
  readonly inspectionNote: string | null;
  readonly inspected: boolean;
  readonly restockQty: number;
  readonly repairQty: number;
  readonly quarantineQty: number;
  readonly writeOffQty: number;
  readonly returnToCustomerQty: number;
  readonly notReceivedQty: number;
  readonly heldQty: number;
}

export interface AdminReturnActions {
  readonly requestInfo: boolean;
  readonly approve: boolean;
  readonly reject: boolean;
  readonly recordShipment: boolean;
  readonly receive: boolean;
  readonly inspect: boolean;
}

export interface AdminReturnDetail {
  readonly id: string;
  readonly requestNumber: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly orderStatus: string;
  readonly status: ReturnStatus;
  readonly statusLabel: string;
  readonly createdAt: Date;
  readonly decisionDueAt: Date | null;
  readonly shipByAt: Date | null;
  readonly receiveByAt: Date | null;
  readonly receivedAt: Date | null;
  readonly receivedNote: string | null;
  readonly inspectedAt: Date | null;
  readonly inspectionNote: string | null;
  readonly closedAt: Date | null;
  readonly rejectionReason: string | null;
  readonly instructions: {
    readonly text: string;
    readonly payer: string;
  } | null;
  readonly customer: {
    readonly recipientName: string;
    readonly emailMasked: string;
    readonly phoneMasked: string;
    readonly city: string;
    readonly state: string;
  };
  readonly items: readonly AdminReturnItem[];
  readonly shipments: ReadonlyArray<{
    readonly id: string;
    readonly direction: string;
    readonly carrier: string;
    readonly trackingNumber: string | null;
    readonly trackingUrl: string | null;
    readonly shippedAt: Date;
    readonly receivedAt: Date | null;
    readonly recordedBy: string;
  }>;
  readonly messages: ReadonlyArray<{
    readonly id: string;
    readonly author: string;
    readonly body: string;
    readonly at: Date;
  }>;
  readonly events: ReadonlyArray<{
    readonly id: string;
    readonly type: string;
    readonly actor: string;
    readonly fromStatus: ReturnStatus | null;
    readonly toStatus: ReturnStatus | null;
    readonly visibleToCustomer: boolean;
    readonly note: string | null;
    readonly at: Date;
  }>;
  readonly evidence: ReadonlyArray<{
    readonly id: string;
    readonly width: number | null;
    readonly height: number | null;
  }>;
  readonly actions: AdminReturnActions;
}

export function toAdminReturnDetail(
  bundle: AdminReturnBundle,
): AdminReturnDetail {
  const { row, evidence } = bundle;
  const snapshot = row.instructionsSnapshot;
  const instructions =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (() => {
          const record = snapshot as Record<string, unknown>;
          return typeof record.text === "string"
            ? {
                text: record.text,
                payer: record.payer === "SHOP" ? "SHOP" : "CUSTOMER",
              }
            : null;
        })()
      : null;
  const can = (event: Parameters<typeof nextReturnStatus>[1]) =>
    nextReturnStatus(row.status, event) !== null;
  return {
    id: row.id,
    requestNumber: row.requestNumber,
    orderId: row.order.id,
    orderNumber: row.order.orderNumber,
    orderStatus: row.order.status,
    status: row.status,
    statusLabel: returnStatusLabels[row.status],
    createdAt: row.createdAt,
    decisionDueAt: row.decisionDueAt,
    shipByAt: row.shipByAt,
    receiveByAt: row.receiveByAt,
    receivedAt: row.receivedAt,
    receivedNote: row.receivedNote,
    inspectedAt: row.inspectedAt,
    inspectionNote: row.inspectionNote,
    closedAt: row.closedAt,
    rejectionReason: row.rejectionReason,
    instructions,
    customer: {
      recipientName: row.order.recipientName,
      emailMasked: maskEmail(row.order.email),
      phoneMasked: maskPhone(row.order.phone),
      city: row.order.city,
      state: row.order.state,
    },
    items: row.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      variantId: item.variantId,
      productTitle: item.orderItem.productTitle,
      variantTitle: item.orderItem.variantTitle,
      sku: item.orderItem.sku,
      orderedQty: item.orderItem.quantity,
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
      inspectionNote: item.inspectionNote,
      inspected: item.inspected,
      restockQty: item.restockQty,
      repairQty: item.repairQty,
      quarantineQty: item.quarantineQty,
      writeOffQty: item.writeOffQty,
      returnToCustomerQty: item.returnToCustomerQty,
      notReceivedQty: item.notReceivedQty,
      heldQty: item.heldQty,
    })),
    shipments: row.shipments.map((shipment) => ({
      id: shipment.id,
      direction: shipment.direction,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
      shippedAt: shipment.shippedAt,
      receivedAt: shipment.receivedAt,
      recordedBy: shipment.recordedBy,
    })),
    messages: row.messages.map((message) => ({
      id: message.id,
      author: message.author,
      body: message.body,
      at: message.createdAt,
    })),
    events: row.events.map((event) => ({
      id: event.id,
      type: event.type,
      actor: event.actor,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      visibleToCustomer: event.visibleToCustomer,
      note: event.note,
      at: event.createdAt,
    })),
    evidence: evidence.map((file) => ({
      id: file.id,
      width: file.width,
      height: file.height,
    })),
    actions: {
      requestInfo: can("request_info"),
      approve: can("approve"),
      reject: can("reject"),
      recordShipment: can("shipped"),
      receive: can("receive"),
      inspect: can("inspect"),
    },
  };
}
