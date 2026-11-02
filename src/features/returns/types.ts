import type {
  ReturnItemCondition,
  ReturnReason,
  ReturnResolution,
  ReturnStatus,
} from "@/generated/prisma/enums";

import type { IneligibleReason } from "./rules";

/**
 * Customer-facing views of returns (docs/phase-8-returns-custom-artwork.md
 * §3.5, §11.1). Pages render these, never rows; nothing here carries a file
 * URL, only ledger ids the private file route resolves after its own check.
 */

export const returnStatusLabels: Readonly<Record<ReturnStatus, string>> = {
  REQUESTED: "Requested",
  INFO_REQUESTED: "Waiting for your reply",
  APPROVED: "Approved: please send the parcel",
  IN_TRANSIT: "On its way to us",
  OVERDUE: "Parcel overdue",
  RECEIVED: "Received, being inspected",
  INSPECTED: "Inspected",
  CLOSED: "Closed",
  REJECTED: "Not accepted",
  WITHDRAWN: "Withdrawn",
  EXPIRED: "Expired",
  LOST: "Lost in transit",
};

export const returnReasonLabels: Readonly<Record<ReturnReason, string>> = {
  DAMAGED_ON_ARRIVAL: "Arrived damaged",
  WRONG_ITEM: "Not what I ordered",
  NOT_AS_DESCRIBED: "Not as described",
  SIZE_OR_FIT: "Size or fit",
  CHANGED_MIND: "Changed my mind",
  QUALITY: "Quality not as expected",
  OTHER: "Another reason",
};

export const returnResolutionLabels: Readonly<
  Record<ReturnResolution, string>
> = {
  REFUND: "Refund",
  EXCHANGE: "Exchange for another size or variant",
};

export const returnConditionLabels: Readonly<
  Record<ReturnItemCondition, string>
> = {
  AS_NEW: "As new",
  OPENED: "Opened, unused",
  USED: "Used",
  DAMAGED: "Damaged",
  WRONG_ITEM: "Wrong item sent",
  NOT_RECEIVED: "Not received",
};

/** Customer-visible timeline labels by event type. */
export const returnTimelineLabels: Readonly<Record<string, string>> = {
  "return.requested": "Return requested",
  "return.info_requested": "We asked you a question",
  "return.customer_replied": "You replied",
  "return.approved": "Return approved",
  "return.rejected": "Return not accepted",
  "return.withdrawn": "Request withdrawn",
  "return.shipped": "Parcel sent",
  "return.received": "Parcel received by us",
  "return.inspected": "Inspection completed",
  "return.expired": "Request expired",
  "return.overdue": "Parcel overdue",
  "return.lost": "Parcel lost in transit",
  "return.closed": "Return closed",
  "return.evidence_added": "Photographs added",
};

export interface ReturnLineOption {
  readonly orderItemId: string;
  readonly productTitle: string;
  readonly variantTitle: string | null;
  readonly sku: string;
  readonly orderedQty: number;
  readonly availableQty: number;
  readonly reasons: readonly ReturnReason[];
  readonly ineligible: IneligibleReason | null;
  readonly ineligibleMessage: string | null;
  /** Same-product alternatives a customer may ask for instead of a refund. */
  readonly exchangeOptions: ReadonlyArray<{
    readonly variantId: string;
    readonly label: string;
  }>;
}

export interface ReturnEligibilityView {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly deliveredAt: Date | null;
  readonly windowClosesAt: Date | null;
  readonly damageReportClosesAt: Date | null;
  readonly hasOpenRequest: boolean;
  readonly lines: readonly ReturnLineOption[];
  /** True when at least one unit can be requested right now. */
  readonly canRequest: boolean;
  readonly evidenceRequiredForReasons: readonly ReturnReason[];
}

export interface ReturnItemView {
  readonly id: string;
  readonly productTitle: string;
  readonly variantTitle: string | null;
  readonly sku: string;
  readonly requestedQty: number;
  readonly approvedQty: number | null;
  readonly receivedQty: number | null;
  readonly reason: ReturnReason;
  readonly reasonLabel: string;
  readonly description: string | null;
  readonly resolution: ReturnResolution;
  readonly exchangeVariantLabel: string | null;
  readonly condition: ReturnItemCondition | null;
  readonly outcome: {
    readonly restocked: number;
    readonly repair: number;
    readonly quarantine: number;
    readonly writtenOff: number;
    readonly returnedToCustomer: number;
    readonly notReceived: number;
  } | null;
}

export interface ReturnShipmentView {
  readonly id: string;
  readonly direction: "INBOUND" | "OUTBOUND_TO_CUSTOMER";
  readonly carrier: string;
  readonly trackingNumber: string | null;
  readonly trackingUrl: string | null;
  readonly shippedAt: Date;
  readonly receivedAt: Date | null;
}

export interface ReturnMessageView {
  readonly id: string;
  readonly author: "CUSTOMER" | "STAFF";
  readonly body: string;
  readonly at: Date;
}

export interface ReturnTimelineEntry {
  readonly id: string;
  readonly at: Date;
  readonly label: string;
  readonly note: string | null;
}

export interface ReturnEvidenceView {
  readonly id: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface ReturnInstructionsView {
  readonly text: string;
  readonly payer: "SHOP" | "CUSTOMER";
  readonly shipByAt: Date | null;
}

export interface ReturnView {
  readonly id: string;
  readonly requestNumber: string;
  readonly orderNumber: string;
  readonly status: ReturnStatus;
  readonly statusLabel: string;
  readonly createdAt: Date;
  readonly decisionDueAt: Date | null;
  readonly receiveByAt: Date | null;
  readonly closedAt: Date | null;
  readonly rejectionReason: string | null;
  readonly instructions: ReturnInstructionsView | null;
  readonly items: readonly ReturnItemView[];
  readonly shipments: readonly ReturnShipmentView[];
  readonly messages: readonly ReturnMessageView[];
  readonly timeline: readonly ReturnTimelineEntry[];
  readonly evidence: readonly ReturnEvidenceView[];
  readonly canWithdraw: boolean;
  readonly canReply: boolean;
  readonly canRecordShipment: boolean;
  readonly canAddEvidence: boolean;
}

export interface ReturnSummaryView {
  readonly id: string;
  readonly requestNumber: string;
  readonly orderNumber: string;
  readonly status: ReturnStatus;
  readonly statusLabel: string;
  readonly createdAt: Date;
  readonly units: number;
}
