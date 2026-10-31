import Image from "next/image";

import { ProductImageFallback } from "@/components/catalog/ProductImageFallback";
import type { CartLineView } from "@/features/cart/types";
import type { Quote } from "@/features/checkout/rules";
import { formatINR } from "@/lib/money";

import styles from "./OrderSummaryPanel.module.css";

/** What is about to be bought, priced by the server. */
export function OrderSummaryPanel({
  lines,
  quote,
  codFeeInPaise,
}: {
  lines: readonly CartLineView[];
  quote: Quote;
  codFeeInPaise: number;
}) {
  return (
    <aside className={styles.panel} aria-labelledby="order-summary-heading">
      <h2 id="order-summary-heading" className={styles.heading}>
        Your order
      </h2>
      <ul className={styles.lines}>
        {lines.map((line) => (
          <li key={line.id} className={styles.line}>
            <div className={styles.media}>
              {line.product.image ? (
                <Image
                  src={line.product.image.url}
                  alt={line.product.image.alt}
                  width={line.product.image.width}
                  height={line.product.image.height}
                  sizes="4rem"
                  className={styles.image}
                />
              ) : (
                <ProductImageFallback
                  title={line.product.title}
                  aspect="square"
                />
              )}
            </div>
            <div className={styles.lineBody}>
              <p className={styles.lineTitle}>{line.product.title}</p>
              <p className={styles.lineMeta}>
                {line.variant.title ? `${line.variant.title} · ` : ""}
                {line.quantity} × {formatINR(line.unitPriceInPaise)}
              </p>
            </div>
            <p className={styles.lineTotal}>
              {formatINR(line.lineTotalInPaise)}
            </p>
          </li>
        ))}
      </ul>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>Subtotal</dt>
          <dd>{formatINR(quote.subtotalInPaise)}</dd>
        </div>
        <div className={styles.row}>
          <dt>Shipping</dt>
          <dd>
            {quote.shippingInPaise === 0
              ? "Free"
              : formatINR(quote.shippingInPaise)}
          </dd>
        </div>
        {codFeeInPaise > 0 ? (
          <div className={styles.row}>
            <dt>Cash on delivery fee</dt>
            <dd className={styles.muted}>
              {formatINR(codFeeInPaise)} if chosen
            </dd>
          </div>
        ) : null}
        <div className={`${styles.row} ${styles.total}`}>
          <dt>Total</dt>
          <dd>{formatINR(quote.totalInPaise)}</dd>
        </div>
      </dl>
      <p className={styles.note}>Prices include all applicable taxes.</p>
    </aside>
  );
}
