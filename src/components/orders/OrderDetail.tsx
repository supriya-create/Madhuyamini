import Image from "next/image";
import Link from "next/link";

import { ProductImageFallback } from "@/components/catalog/ProductImageFallback";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cancelPendingOrderAction } from "@/features/checkout/actions";
import type { OrderDetailView } from "@/features/orders/types";
import { formatDateTime } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

import styles from "./OrderDetail.module.css";

const paymentLabels = {
  RAZORPAY: "Paid online",
  COD: "Cash on delivery",
  STORE_CREDIT: "Settled by exchange credit",
} as const;

/**
 * One order, as its owner may see it. `view.exposure` already decided how
 * much of the address and contact details are present.
 */
export function OrderDetail({
  view,
  showTimeline = false,
}: {
  view: OrderDetailView;
  showTimeline?: boolean;
}) {
  return (
    <article className={styles.order} aria-labelledby="order-heading">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Order</p>
          <h2 id="order-heading" className={styles.number}>
            {view.orderNumber}
          </h2>
          <p className={styles.meta}>
            Placed {formatDateTime(view.placedAt)} ·{" "}
            {view.paymentMethod === "COD"
              ? paymentLabels.COD
              : view.status === "CONFIRMED"
                ? paymentLabels.RAZORPAY
                : "Online payment"}
          </p>
        </div>
        <p className={styles.status} data-status={view.status}>
          {view.statusLabel}
        </p>
      </header>

      {view.status === "PENDING_PAYMENT" ? (
        <p className={styles.notice} role="status">
          {view.canPay
            ? "This order is waiting for payment. Your pieces are held until the deadline."
            : "The payment window for this order has closed."}
        </p>
      ) : null}
      {view.status === "NEEDS_REVIEW" ? (
        <p className={styles.notice} role="status">
          We are checking this payment by hand and will email you shortly.
          Nothing further is needed from you.
        </p>
      ) : null}
      {view.status === "CANCELLED" ? (
        <p className={styles.notice} role="status">
          This order was cancelled
          {view.cancellationReason === "PAYMENT_TIMEOUT"
            ? " because the payment was not completed in time"
            : view.cancellationReason === "CUSTOMER"
              ? " at your request"
              : ""}
          . Nothing has been charged.
        </p>
      ) : null}

      {view.canPay || view.canCancel ? (
        <div className={styles.actions}>
          {view.canPay ? (
            <ButtonLink href={routes.checkoutPay(view.id)}>Pay now</ButtonLink>
          ) : null}
          {view.canCancel ? (
            <form action={cancelPendingOrderAction}>
              <input type="hidden" name="orderId" value={view.id} />
              <Button type="submit" variant="secondary">
                Cancel this order
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="order-items-heading" className={styles.section}>
        <h3 id="order-items-heading" className={styles.sectionTitle}>
          Items
        </h3>
        <ul className={styles.lines}>
          {view.items.map((item) => (
            <li key={item.id} className={styles.line}>
              <div className={styles.media}>
                {item.image ? (
                  <Image
                    src={item.image.url}
                    alt={item.image.alt}
                    width={160}
                    height={160}
                    sizes="4rem"
                    className={styles.image}
                  />
                ) : (
                  <ProductImageFallback
                    title={item.productTitle}
                    aspect="square"
                  />
                )}
              </div>
              <div className={styles.lineBody}>
                <p className={styles.lineTitle}>
                  <Link href={routes.product(item.productSlug)}>
                    {item.productTitle}
                  </Link>
                </p>
                <p className={styles.lineMeta}>
                  {item.variantTitle ? `${item.variantTitle} · ` : ""}
                  {item.quantity} × {formatINR(item.unitPriceInPaise)}
                </p>
              </div>
              <p className={styles.lineTotal}>
                {formatINR(item.lineTotalInPaise)}
              </p>
            </li>
          ))}
        </ul>
        <dl className={styles.totals}>
          <div className={styles.row}>
            <dt>Subtotal</dt>
            <dd>{formatINR(view.subtotalInPaise)}</dd>
          </div>
          <div className={styles.row}>
            <dt>Shipping</dt>
            <dd>
              {view.shippingInPaise === 0
                ? "Free"
                : formatINR(view.shippingInPaise)}
            </dd>
          </div>
          {view.codFeeInPaise > 0 ? (
            <div className={styles.row}>
              <dt>Cash on delivery fee</dt>
              <dd>{formatINR(view.codFeeInPaise)}</dd>
            </div>
          ) : null}
          {view.discountInPaise > 0 ? (
            <div className={styles.row}>
              <dt>Discount</dt>
              <dd>−{formatINR(view.discountInPaise)}</dd>
            </div>
          ) : null}
          <div className={`${styles.row} ${styles.total}`}>
            <dt>Total</dt>
            <dd>{formatINR(view.totalInPaise)}</dd>
          </div>
          {view.taxInPaise !== null ? (
            <div className={styles.row}>
              <dt className={styles.muted}>Includes GST</dt>
              <dd className={styles.muted}>{formatINR(view.taxInPaise)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className={styles.columns}>
        <section
          aria-labelledby="order-address-heading"
          className={styles.section}
        >
          <h3 id="order-address-heading" className={styles.sectionTitle}>
            Delivery
          </h3>
          <p className={styles.address}>
            {[
              view.address.recipientName,
              view.address.line1,
              view.address.line2,
              view.address.landmark,
              `${view.address.city}, ${view.address.state} ${view.address.postalCode}`,
            ]
              .filter(Boolean)
              .join("\n")}
          </p>
          {view.contact.phone ? (
            <p className={styles.meta}>{view.contact.phone}</p>
          ) : null}
          {view.customerNote ? (
            <p className={styles.note}>
              <span className={styles.noteLabel}>Your note:</span>{" "}
              {view.customerNote}
            </p>
          ) : null}
        </section>
        <section
          aria-labelledby="order-contact-heading"
          className={styles.section}
        >
          <h3 id="order-contact-heading" className={styles.sectionTitle}>
            Updates go to
          </h3>
          <p>{view.contact.email}</p>
          {view.payment.reference ? (
            <p className={styles.meta}>
              Payment reference ending {view.payment.reference}
            </p>
          ) : null}
          {view.payment.failureDescription &&
          view.status === "PENDING_PAYMENT" ? (
            <p className={styles.meta}>
              Last attempt: {view.payment.failureDescription}
            </p>
          ) : null}
        </section>
      </div>

      {showTimeline && view.timeline.length > 0 ? (
        <section
          aria-labelledby="order-timeline-heading"
          className={styles.section}
        >
          <h3 id="order-timeline-heading" className={styles.sectionTitle}>
            Progress
          </h3>
          <ol className={styles.timeline}>
            {view.timeline.map((entry) => (
              <li key={entry.id}>
                <span className={styles.timelineLabel}>{entry.label}</span>
                <time dateTime={entry.at.toISOString()} className={styles.meta}>
                  {formatDateTime(entry.at)}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}
