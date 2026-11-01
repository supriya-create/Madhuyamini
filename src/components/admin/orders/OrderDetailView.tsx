import styles from "@/components/admin/Admin.module.css";
import { TableWrap } from "@/components/admin/TableWrap";
import type { AdminOrderDetail } from "@/features/admin/orders/types";
import { deliveryFailureLabels } from "@/features/admin/orders/types";
import type { DeliveryFailureReason } from "@/features/admin/orders/types";
import { formatDateTime } from "@/lib/dates";
import { formatINR } from "@/lib/money";

import { Badge } from "./StatusBadge";

/** Read-only panels of an order (docs/admin.md §5.4 "Detail"). */

function failureLabel(reason: string | null): string | null {
  if (!reason) return null;
  return reason in deliveryFailureLabels
    ? deliveryFailureLabels[reason as DeliveryFailureReason]
    : reason;
}

export function OrderSummaryPanel({ order }: { order: AdminOrderDetail }) {
  return (
    <section className={styles.panel} aria-labelledby="order-summary">
      <h2 id="order-summary" className={styles.panelTitle}>
        Summary
      </h2>
      <dl className={styles.dl}>
        <dt>Placed</dt>
        <dd>{formatDateTime(order.placedAt)}</dd>
        <dt>Payment</dt>
        <dd>
          {order.paymentMethod === "COD"
            ? "Cash on delivery"
            : "Online (Razorpay)"}
        </dd>
        {order.confirmedAt ? (
          <>
            <dt>Confirmed</dt>
            <dd>{formatDateTime(order.confirmedAt)}</dd>
          </>
        ) : null}
        {order.pendingExpiresAt && order.status === "PENDING_PAYMENT" ? (
          <>
            <dt>Hold expires</dt>
            <dd>{formatDateTime(order.pendingExpiresAt)}</dd>
          </>
        ) : null}
        {order.cancelledAt ? (
          <>
            <dt>Cancelled</dt>
            <dd>
              {formatDateTime(order.cancelledAt)}
              {order.cancellationReason
                ? ` (${order.cancellationReason.toLowerCase().replaceAll("_", " ")})`
                : null}
            </dd>
          </>
        ) : null}
        <dt>Customer</dt>
        <dd>{order.customerAccount ? "Account holder" : "Guest"}</dd>
        {order.customerNote ? (
          <>
            <dt>Customer note</dt>
            <dd>{order.customerNote}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

export function OrderAddressPanel({ order }: { order: AdminOrderDetail }) {
  const { address, contact } = order;
  return (
    <section className={styles.panel} aria-labelledby="order-address">
      <h2 id="order-address" className={styles.panelTitle}>
        Delivery
      </h2>
      {order.addressExposure === "masked" ? (
        <p className={styles.muted}>
          Contact details are masked once an order is delivered or cancelled.
        </p>
      ) : null}
      <dl className={styles.dl}>
        <dt>Recipient</dt>
        <dd>{address.recipientName}</dd>
        <dt>Address</dt>
        <dd>
          {address.line1 ? (
            <>
              {address.line1}
              <br />
              {address.line2 ? (
                <>
                  {address.line2}
                  <br />
                </>
              ) : null}
              {address.landmark ? (
                <>
                  {address.landmark}
                  <br />
                </>
              ) : null}
            </>
          ) : null}
          {address.city}, {address.state} {address.postalCode}
        </dd>
        <dt>Email</dt>
        <dd>{contact.email}</dd>
        <dt>Phone</dt>
        <dd>{contact.phone}</dd>
      </dl>
    </section>
  );
}

export function OrderItemsPanel({ order }: { order: AdminOrderDetail }) {
  const { totals } = order;
  return (
    <section className={styles.panel} aria-labelledby="order-items">
      <h2 id="order-items" className={styles.panelTitle}>
        Items
      </h2>
      <TableWrap label="Items">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Piece</th>
              <th scope="col">SKU</th>
              <th scope="col" className={styles.num}>
                Qty
              </th>
              <th scope="col" className={styles.num}>
                Unit
              </th>
              <th scope="col" className={styles.num}>
                Line
              </th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.productTitle}
                  {item.variantTitle ? (
                    <div className={styles.muted}>{item.variantTitle}</div>
                  ) : null}
                </td>
                <td className={styles.mono}>{item.sku}</td>
                <td className={styles.num}>{item.quantity}</td>
                <td className={styles.num}>
                  {formatINR(item.unitPriceInPaise)}
                </td>
                <td className={styles.num}>
                  {formatINR(item.lineTotalInPaise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <dl className={styles.dl}>
        <dt>Subtotal</dt>
        <dd>{formatINR(totals.subtotalInPaise)}</dd>
        <dt>Shipping</dt>
        <dd>
          {totals.shippingInPaise === 0
            ? "Free"
            : formatINR(totals.shippingInPaise)}
        </dd>
        {totals.codFeeInPaise > 0 ? (
          <>
            <dt>COD fee</dt>
            <dd>{formatINR(totals.codFeeInPaise)}</dd>
          </>
        ) : null}
        {totals.discountInPaise > 0 ? (
          <>
            <dt>Discount</dt>
            <dd>−{formatINR(totals.discountInPaise)}</dd>
          </>
        ) : null}
        <dt>Total</dt>
        <dd>
          <strong>{formatINR(totals.totalInPaise)}</strong>
        </dd>
      </dl>
    </section>
  );
}

const PAYMENT_TONES: Record<string, "good" | "warn" | "bad"> = {
  CAPTURED: "good",
  AUTHORIZED: "warn",
  CREATED: "warn",
  INITIATED: "warn",
  FAILED: "bad",
  REFUNDED: "warn",
};

export function OrderPaymentsPanel({ order }: { order: AdminOrderDetail }) {
  return (
    <section className={styles.panel} aria-labelledby="order-payments">
      <h2 id="order-payments" className={styles.panelTitle}>
        Payments
      </h2>
      {order.payments.length === 0 ? (
        <p className={styles.muted}>No payment attempts yet.</p>
      ) : (
        <ul className={styles.timeline}>
          {order.payments.map((attempt) => (
            <li key={attempt.id} className={styles.timelineItem}>
              <div className={styles.inline}>
                <strong>Attempt {attempt.attemptNo}</strong>
                <Badge tone={PAYMENT_TONES[attempt.status]}>
                  {attempt.status}
                </Badge>
                <span>{formatINR(attempt.amountInPaise)}</span>
                <span className={styles.muted}>
                  {attempt.method === "COD" ? "Cash on delivery" : "Razorpay"}
                </span>
              </div>
              <dl className={styles.dl}>
                <dt>Receipt</dt>
                <dd className={styles.mono}>{attempt.receipt}</dd>
                {attempt.providerOrderId ? (
                  <>
                    <dt>Provider order</dt>
                    <dd className={styles.mono}>{attempt.providerOrderId}</dd>
                  </>
                ) : null}
                {attempt.providerPaymentId ? (
                  <>
                    <dt>Provider payment</dt>
                    <dd className={styles.mono}>
                      {attempt.providerPaymentId}
                      {attempt.signatureVerified ? " (signature verified)" : ""}
                    </dd>
                  </>
                ) : null}
                {attempt.capturedAt ? (
                  <>
                    <dt>Captured</dt>
                    <dd>{formatDateTime(attempt.capturedAt)}</dd>
                  </>
                ) : null}
                {attempt.failedAt ? (
                  <>
                    <dt>Failed</dt>
                    <dd>
                      {formatDateTime(attempt.failedAt)}
                      {attempt.failureCode ? ` · ${attempt.failureCode}` : ""}
                      {attempt.failureDescription
                        ? ` · ${attempt.failureDescription}`
                        : ""}
                    </dd>
                  </>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {order.refunds.length > 0 ? (
        <>
          <h3 className={styles.panelTitle}>Refunds</h3>
          <ul className={styles.timeline}>
            {order.refunds.map((refund) => (
              <li key={refund.id} className={styles.timelineItem}>
                <div className={styles.inline}>
                  <strong className={styles.mono}>{refund.reference}</strong>
                  <Badge
                    tone={
                      refund.status === "PROCESSED"
                        ? "good"
                        : refund.status === "FAILED"
                          ? "bad"
                          : "warn"
                    }
                  >
                    {refund.status}
                  </Badge>
                  <span>{formatINR(refund.amountInPaise)}</span>
                  <span className={styles.muted}>
                    {refund.reason.replaceAll("_", " ")}
                  </span>
                </div>
                <div className={styles.timelineMeta}>
                  Requested {formatDateTime(refund.createdAt)}
                  {refund.processedAt
                    ? ` · processed ${formatDateTime(refund.processedAt)}`
                    : ""}
                  {refund.providerRefundId
                    ? ` · ${refund.providerRefundId}`
                    : ""}
                  {refund.attempts > 0
                    ? ` · ${refund.attempts} attempt(s)`
                    : ""}
                  {refund.lastError ? ` · last error: ${refund.lastError}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export function OrderShipmentPanel({ order }: { order: AdminOrderDetail }) {
  const shipment = order.shipment;
  if (!shipment) return null;
  return (
    <section className={styles.panel} aria-labelledby="order-shipment">
      <h2 id="order-shipment" className={styles.panelTitle}>
        Shipment
      </h2>
      <dl className={styles.dl}>
        <dt>Carrier</dt>
        <dd>{shipment.carrier}</dd>
        {shipment.trackingNumber ? (
          <>
            <dt>Tracking</dt>
            <dd>
              {shipment.trackingUrl ? (
                <a href={shipment.trackingUrl} rel="noopener noreferrer">
                  {shipment.trackingNumber}
                </a>
              ) : (
                shipment.trackingNumber
              )}
            </dd>
          </>
        ) : null}
        <dt>Shipped</dt>
        <dd>{formatDateTime(shipment.shippedAt)}</dd>
        {shipment.deliveredAt ? (
          <>
            <dt>Delivered</dt>
            <dd>{formatDateTime(shipment.deliveredAt)}</dd>
          </>
        ) : null}
        {shipment.deliveryFailedAt ? (
          <>
            <dt>Delivery failed</dt>
            <dd>
              {formatDateTime(shipment.deliveryFailedAt)}
              {failureLabel(shipment.deliveryFailureReason)
                ? ` · ${failureLabel(shipment.deliveryFailureReason)}`
                : ""}
            </dd>
          </>
        ) : null}
        {shipment.returnedAt ? (
          <>
            <dt>Returned to us</dt>
            <dd>{formatDateTime(shipment.returnedAt)}</dd>
          </>
        ) : null}
        {shipment.inspectedAt ? (
          <>
            <dt>Inspected</dt>
            <dd>
              {formatDateTime(shipment.inspectedAt)}
              {shipment.inspectionNote ? ` · ${shipment.inspectionNote}` : ""}
            </dd>
          </>
        ) : null}
        {shipment.carrierClaimReference ? (
          <>
            <dt>Carrier claim</dt>
            <dd className={styles.mono}>{shipment.carrierClaimReference}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

export function OrderHistoryPanel({ order }: { order: AdminOrderDetail }) {
  return (
    <section className={styles.panel} aria-labelledby="order-history">
      <h2 id="order-history" className={styles.panelTitle}>
        History
      </h2>
      <ul className={styles.timeline}>
        {order.events.map((event) => (
          <li key={event.id} className={styles.timelineItem}>
            <div>
              <strong>
                {event.type === "note" ? "Staff note" : event.type}
              </strong>
              {event.fromStatus && event.toStatus
                ? ` · ${event.fromStatus} → ${event.toStatus}`
                : ""}
            </div>
            {event.note ? <div>{event.note}</div> : null}
            <div className={styles.timelineMeta}>
              {formatDateTime(event.at)} · {event.actor.toLowerCase()}
            </div>
          </li>
        ))}
      </ul>
      {order.adjustments.length > 0 ? (
        <>
          <h3 className={styles.panelTitle}>Stock movements</h3>
          <ul className={styles.timeline}>
            {order.adjustments.map((adjustment) => (
              <li key={adjustment.id} className={styles.timelineItem}>
                <div>
                  <strong>{adjustment.kind.replaceAll("_", " ")}</strong>{" "}
                  {adjustment.delta > 0
                    ? `+${adjustment.delta}`
                    : adjustment.delta}{" "}
                  ({adjustment.stockBefore} → {adjustment.stockAfter})
                </div>
                <div>{adjustment.reason}</div>
                <div className={styles.timelineMeta}>
                  {formatDateTime(adjustment.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {order.reservations.length > 0 ? (
        <>
          <h3 className={styles.panelTitle}>Stock holds</h3>
          <ul className={styles.timeline}>
            {order.reservations.map((hold) => (
              <li key={hold.id} className={styles.timelineItem}>
                <div>
                  {hold.quantity} unit(s) · {hold.status.toLowerCase()}
                </div>
                <div className={styles.timelineMeta}>
                  Until {formatDateTime(hold.expiresAt)}
                  {hold.closedAt
                    ? ` · closed ${formatDateTime(hold.closedAt)}`
                    : ""}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {order.audit.length > 0 ? (
        <>
          <h3 className={styles.panelTitle}>Audit</h3>
          <ul className={styles.timeline}>
            {order.audit.map((entry) => (
              <li key={entry.id} className={styles.timelineItem}>
                <div className={styles.inline}>
                  <strong>{entry.action}</strong>
                  <Badge
                    tone={
                      entry.outcome === "SUCCESS"
                        ? "good"
                        : entry.outcome === "REFUSED"
                          ? "warn"
                          : "bad"
                    }
                  >
                    {entry.outcome}
                  </Badge>
                </div>
                {entry.reason ? <div>{entry.reason}</div> : null}
                <div className={styles.timelineMeta}>
                  {formatDateTime(entry.createdAt)} · {entry.actorLabel}
                  {entry.actorRole ? ` (${entry.actorRole.toLowerCase()})` : ""}
                  {entry.errorCode ? ` · ${entry.errorCode}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
