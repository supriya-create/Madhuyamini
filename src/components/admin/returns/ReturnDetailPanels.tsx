import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import type { AdminReturnDetail } from "@/features/admin/returns/types";
import { returnConditionLabels } from "@/features/returns/types";
import { formatDateTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

/** Read-only panels of the admin return page (docs/phase-8-returns-custom-artwork.md §11.2). */

export function ReturnSummaryPanel({ item }: { item: AdminReturnDetail }) {
  return (
    <section className={styles.panel} aria-labelledby="return-summary">
      <h2 id="return-summary" className={styles.panelTitle}>
        Summary
      </h2>
      <dl className={styles.dl}>
        <dt>Order</dt>
        <dd>
          <Link href={routes.adminOrder(item.orderId)}>{item.orderNumber}</Link>{" "}
          <span className={styles.muted}>
            ({item.orderStatus.toLowerCase()})
          </span>
        </dd>
        <dt>Requested</dt>
        <dd>{formatDateTime(item.createdAt)}</dd>
        {item.decisionDueAt ? (
          <>
            <dt>Decide by</dt>
            <dd>{formatDateTime(item.decisionDueAt)}</dd>
          </>
        ) : null}
        {item.shipByAt ? (
          <>
            <dt>Customer ships by</dt>
            <dd>{formatDateTime(item.shipByAt)}</dd>
          </>
        ) : null}
        {item.receiveByAt ? (
          <>
            <dt>Expected by</dt>
            <dd>{formatDateTime(item.receiveByAt)}</dd>
          </>
        ) : null}
        {item.receivedAt ? (
          <>
            <dt>Received</dt>
            <dd>
              {formatDateTime(item.receivedAt)}
              {item.receivedNote ? ` · ${item.receivedNote}` : ""}
            </dd>
          </>
        ) : null}
        {item.inspectedAt ? (
          <>
            <dt>Inspected</dt>
            <dd>
              {formatDateTime(item.inspectedAt)}
              {item.inspectionNote ? ` · ${item.inspectionNote}` : ""}
            </dd>
          </>
        ) : null}
        {item.rejectionReason ? (
          <>
            <dt>Rejected</dt>
            <dd>{item.rejectionReason}</dd>
          </>
        ) : null}
        {item.instructions ? (
          <>
            <dt>Instructions</dt>
            <dd>
              {item.instructions.text}
              <div className={styles.muted}>
                Return shipping paid by{" "}
                {item.instructions.payer === "SHOP"
                  ? "the shop"
                  : "the customer"}
              </div>
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

export function ReturnCustomerPanel({ item }: { item: AdminReturnDetail }) {
  return (
    <section className={styles.panel} aria-labelledby="return-customer">
      <h2 id="return-customer" className={styles.panelTitle}>
        Customer
      </h2>
      <dl className={styles.dl}>
        <dt>Name</dt>
        <dd>{item.customer.recipientName}</dd>
        <dt>Email</dt>
        <dd>{item.customer.emailMasked}</dd>
        <dt>Phone</dt>
        <dd>{item.customer.phoneMasked}</dd>
        <dt>Where</dt>
        <dd>
          {item.customer.city}, {item.customer.state}
        </dd>
      </dl>
      <p className={styles.muted}>
        Contact details are masked; reveal them from the customer page with a
        grant if a conversation needs them.
      </p>
    </section>
  );
}

export function ReturnItemsPanel({ item }: { item: AdminReturnDetail }) {
  return (
    <section className={styles.panel} aria-labelledby="return-items">
      <h2 id="return-items" className={styles.panelTitle}>
        Items
      </h2>
      <ul className={styles.timeline}>
        {item.items.map((line) => (
          <li key={line.id} className={styles.timelineItem}>
            <div>
              <strong>{line.productTitle}</strong>
              {line.variantTitle ? ` · ${line.variantTitle}` : ""}{" "}
              <span className={styles.muted}>{line.sku}</span>
            </div>
            <div>
              Requested {line.requestedQty} of {line.orderedQty}
              {line.approvedQty !== null
                ? ` · approved ${line.approvedQty}`
                : ""}
              {line.receivedQty !== null
                ? ` · received ${line.receivedQty}`
                : ""}
            </div>
            <div>
              {line.reasonLabel}
              {line.resolution === "EXCHANGE"
                ? ` · wants an exchange${line.exchangeVariantLabel ? ` for ${line.exchangeVariantLabel}` : ""}`
                : " · wants a refund"}
            </div>
            {line.description ? <div>{line.description}</div> : null}
            {line.inspected ? (
              <div className={styles.timelineMeta}>
                {line.condition ? returnConditionLabels[line.condition] : ""} ·
                restocked {line.restockQty}, repair {line.repairQty}, quarantine{" "}
                {line.quarantineQty}, written off {line.writeOffQty}, back to
                customer {line.returnToCustomerQty}
                {line.heldQty > 0 ? ` · ${line.heldQty} held` : ""}
                {line.inspectionNote ? ` · ${line.inspectionNote}` : ""}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReturnEvidencePanel({ item }: { item: AdminReturnDetail }) {
  if (item.evidence.length === 0) return null;
  return (
    <section className={styles.panel} aria-labelledby="return-evidence">
      <h2 id="return-evidence" className={styles.panelTitle}>
        Customer photographs
      </h2>
      <ul className={styles.inline}>
        {item.evidence.map((file, index) => (
          <li key={file.id}>
            <a href={routes.privateFile(file.id)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- private route, not a CDN image */}
              <img
                src={routes.privateFile(file.id, 320)}
                alt={`Customer photograph ${index + 1}`}
                width={160}
                height={160}
              />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReturnParcelsPanel({ item }: { item: AdminReturnDetail }) {
  if (item.shipments.length === 0) return null;
  return (
    <section className={styles.panel} aria-labelledby="return-parcels">
      <h2 id="return-parcels" className={styles.panelTitle}>
        Parcels
      </h2>
      <ul className={styles.timeline}>
        {item.shipments.map((shipment) => (
          <li key={shipment.id} className={styles.timelineItem}>
            <div>
              <strong>
                {shipment.direction === "INBOUND" ? "Inbound" : "Outbound"}
              </strong>{" "}
              {shipment.carrier}
              {shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : ""}
              {shipment.trackingUrl ? (
                <>
                  {" · "}
                  <a href={shipment.trackingUrl} rel="noreferrer">
                    Track
                  </a>
                </>
              ) : null}
            </div>
            <div className={styles.timelineMeta}>
              Sent {formatDateTime(shipment.shippedAt)} · recorded by{" "}
              {shipment.recordedBy.toLowerCase()}
              {shipment.receivedAt
                ? ` · received ${formatDateTime(shipment.receivedAt)}`
                : ""}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReturnMessagesPanel({ item }: { item: AdminReturnDetail }) {
  return (
    <section className={styles.panel} aria-labelledby="return-messages">
      <h2 id="return-messages" className={styles.panelTitle}>
        Messages
      </h2>
      {item.messages.length === 0 ? (
        <p className={styles.muted}>No messages.</p>
      ) : (
        <ul className={styles.timeline}>
          {item.messages.map((message) => (
            <li key={message.id} className={styles.timelineItem}>
              <div>
                <strong>
                  {message.author === "CUSTOMER" ? "Customer" : "Staff"}
                </strong>
              </div>
              <div>{message.body}</div>
              <div className={styles.timelineMeta}>
                {formatDateTime(message.at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReturnHistoryPanel({ item }: { item: AdminReturnDetail }) {
  return (
    <section className={styles.panel} aria-labelledby="return-history">
      <h2 id="return-history" className={styles.panelTitle}>
        History
      </h2>
      <ul className={styles.timeline}>
        {item.events.map((event) => (
          <li key={event.id} className={styles.timelineItem}>
            <div>
              <strong>{event.type}</strong>
              {event.fromStatus && event.toStatus
                ? ` · ${event.fromStatus} → ${event.toStatus}`
                : ""}
              {!event.visibleToCustomer ? " · internal" : ""}
            </div>
            {event.note ? <div>{event.note}</div> : null}
            <div className={styles.timelineMeta}>
              {formatDateTime(event.at)} · {event.actor.toLowerCase()}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
