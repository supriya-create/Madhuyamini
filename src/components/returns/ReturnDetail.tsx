import Link from "next/link";

import type { ReturnView } from "@/features/returns/types";
import { formatDate, formatDateTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

import {
  AddEvidenceForm,
  ReplyForm,
  ShipmentForm,
  WithdrawForm,
} from "./ReturnDetailForms";
import styles from "./Returns.module.css";

const TONES: Partial<Record<ReturnView["status"], "good" | "warn" | "bad">> = {
  APPROVED: "good",
  IN_TRANSIT: "good",
  RECEIVED: "good",
  INSPECTED: "good",
  CLOSED: "good",
  INFO_REQUESTED: "warn",
  OVERDUE: "warn",
  REJECTED: "bad",
  EXPIRED: "bad",
  LOST: "bad",
};

/** One return request, as its owner sees it (docs/phase-8-returns-custom-artwork.md §11.1). */
export function ReturnDetail({
  view,
  maxEvidence,
  uploadsAvailable,
}: {
  view: ReturnView;
  maxEvidence: number;
  uploadsAvailable: boolean;
}) {
  return (
    <article aria-labelledby="return-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Return</p>
          <h2 id="return-heading" className={styles.number}>
            {view.requestNumber}
          </h2>
          <p className={styles.muted}>
            For order{" "}
            <Link href={routes.accountOrder(view.orderNumber)}>
              {view.orderNumber}
            </Link>{" "}
            · requested {formatDate(view.createdAt)}
          </p>
        </div>
        <p className={styles.status} data-tone={TONES[view.status]}>
          {view.statusLabel}
        </p>
      </header>

      {view.status === "REQUESTED" && view.decisionDueAt ? (
        <p className={styles.notice} role="status">
          We will reply by {formatDate(view.decisionDueAt)}. Nothing needs to be
          sent yet.
        </p>
      ) : null}
      {view.status === "INFO_REQUESTED" ? (
        <p className={styles.notice} role="status">
          We have a question for you; please read the messages below and reply.
        </p>
      ) : null}
      {view.rejectionReason ? (
        <p className={styles.notice} role="status">
          Not accepted: {view.rejectionReason}
        </p>
      ) : null}

      {view.instructions ? (
        <section
          className={styles.section}
          aria-labelledby="return-instructions"
        >
          <h3 id="return-instructions" className={styles.sectionTitle}>
            How to send it back
          </h3>
          <div className={styles.instructions}>
            <p>{view.instructions.text}</p>
            <p className={styles.muted}>
              {view.instructions.payer === "SHOP"
                ? "Return shipping is on us."
                : "Return shipping is arranged and paid by you."}
              {view.instructions.shipByAt
                ? ` Please send it by ${formatDate(view.instructions.shipByAt)}.`
                : ""}
            </p>
          </div>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="return-items">
        <h3 id="return-items" className={styles.sectionTitle}>
          Items
        </h3>
        <ul className={styles.lines}>
          {view.items.map((item) => (
            <li key={item.id} className={styles.line}>
              <div className={styles.lineHead}>
                <span className={styles.lineTitle}>
                  {item.productTitle}
                  {item.variantTitle ? ` · ${item.variantTitle}` : ""}
                </span>
                <span className={styles.muted}>{item.sku}</span>
              </div>
              <dl className={styles.dl}>
                <dt>Requested</dt>
                <dd>{item.requestedQty}</dd>
                {item.approvedQty !== null ? (
                  <>
                    <dt>Approved</dt>
                    <dd>{item.approvedQty}</dd>
                  </>
                ) : null}
                {item.receivedQty !== null ? (
                  <>
                    <dt>Received</dt>
                    <dd>{item.receivedQty}</dd>
                  </>
                ) : null}
                <dt>Reason</dt>
                <dd>{item.reasonLabel}</dd>
                {item.description ? (
                  <>
                    <dt>Details</dt>
                    <dd>{item.description}</dd>
                  </>
                ) : null}
                <dt>Preference</dt>
                <dd>
                  {item.resolution === "EXCHANGE"
                    ? `Exchange${item.exchangeVariantLabel ? ` for ${item.exchangeVariantLabel}` : ""}`
                    : "Refund"}
                </dd>
                {item.outcome ? (
                  <>
                    <dt>After inspection</dt>
                    <dd>
                      {item.outcome.restocked} accepted
                      {item.outcome.repair + item.outcome.quarantine > 0
                        ? `, ${item.outcome.repair + item.outcome.quarantine} set aside for checks`
                        : ""}
                      {item.outcome.writtenOff > 0
                        ? `, ${item.outcome.writtenOff} not accepted`
                        : ""}
                      {item.outcome.returnedToCustomer > 0
                        ? `, ${item.outcome.returnedToCustomer} being sent back to you`
                        : ""}
                      {item.outcome.notReceived > 0
                        ? `, ${item.outcome.notReceived} not received`
                        : ""}
                    </dd>
                  </>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      </section>

      {view.evidence.length > 0 ? (
        <section className={styles.section} aria-labelledby="return-photos">
          <h3 id="return-photos" className={styles.sectionTitle}>
            Your photographs
          </h3>
          <ul className={styles.gallery}>
            {view.evidence.map((file, index) => (
              <li key={file.id} className={styles.thumb}>
                <a href={routes.privateFile(file.id)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- private route, not a CDN image */}
                  <img
                    src={routes.privateFile(file.id, 320)}
                    alt={`Photograph ${index + 1}`}
                    width={320}
                    height={320}
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.shipments.length > 0 ? (
        <section className={styles.section} aria-labelledby="return-parcels">
          <h3 id="return-parcels" className={styles.sectionTitle}>
            Parcels
          </h3>
          <ul className={styles.list}>
            {view.shipments.map((shipment) => (
              <li key={shipment.id} className={styles.item}>
                <span>
                  {shipment.direction === "INBOUND"
                    ? "Sent to us"
                    : "Sent back to you"}{" "}
                  with {shipment.carrier}
                  {shipment.trackingNumber
                    ? `, ${shipment.trackingNumber}`
                    : ""}
                </span>
                <span className={styles.muted}>
                  {formatDateTime(shipment.shippedAt)}
                  {shipment.receivedAt
                    ? ` · received ${formatDateTime(shipment.receivedAt)}`
                    : ""}
                  {shipment.trackingUrl ? (
                    <>
                      {" · "}
                      <a href={shipment.trackingUrl} rel="noreferrer">
                        Track
                      </a>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="return-messages">
        <h3 id="return-messages" className={styles.sectionTitle}>
          Messages
        </h3>
        {view.messages.length === 0 ? (
          <p className={styles.muted}>No messages yet.</p>
        ) : (
          <ul className={styles.messages}>
            {view.messages.map((message) => (
              <li
                key={message.id}
                className={styles.message}
                data-author={message.author}
              >
                <p className={styles.muted}>
                  {message.author === "CUSTOMER" ? "You" : "Madhuyamini"} ·{" "}
                  {formatDateTime(message.at)}
                </p>
                <p>{message.body}</p>
              </li>
            ))}
          </ul>
        )}
        {view.canReply ? (
          <ReplyForm requestNumber={view.requestNumber} />
        ) : null}
      </section>

      {view.canRecordShipment ? (
        <section className={styles.section} aria-labelledby="return-ship">
          <h3 id="return-ship" className={styles.sectionTitle}>
            Sent the parcel?
          </h3>
          <ShipmentForm requestNumber={view.requestNumber} />
        </section>
      ) : null}

      {view.canAddEvidence ? (
        <section className={styles.section} aria-labelledby="return-add-photos">
          <h3 id="return-add-photos" className={styles.sectionTitle}>
            Add photographs
          </h3>
          <AddEvidenceForm
            requestNumber={view.requestNumber}
            existingCount={view.evidence.length}
            max={maxEvidence}
            available={uploadsAvailable}
          />
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="return-timeline">
        <h3 id="return-timeline" className={styles.sectionTitle}>
          Progress
        </h3>
        <ol className={styles.timeline}>
          {view.timeline.map((entry) => (
            <li key={entry.id} className={styles.timelineItem}>
              <span>{entry.label}</span>
              {entry.note ? <span>{entry.note}</span> : null}
              <span className={styles.timelineMeta}>
                {formatDateTime(entry.at)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {view.canWithdraw ? (
        <section className={styles.section} aria-labelledby="return-withdraw">
          <h3 id="return-withdraw" className={styles.sectionTitle}>
            Changed your mind?
          </h3>
          <WithdrawForm requestNumber={view.requestNumber} />
        </section>
      ) : null}
    </article>
  );
}
