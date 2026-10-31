import type { PriceRange } from "@/features/catalog/rules";
import { formatINR } from "@/lib/money";

import styles from "./Price.module.css";

type PriceProps = {
  price: PriceRange | null;
  compareAtInPaise?: number | null;
};

/** Price or price range; a struck-through MRP when the piece is discounted. */
export function Price({ price, compareAtInPaise = null }: PriceProps) {
  if (!price)
    return <span className={styles.unavailable}>Price on request</span>;

  const isRange = price.fromInPaise !== price.toInPaise;
  return (
    <span className={styles.price}>
      {isRange ? (
        <>
          <span className={styles.from}>From </span>
          {formatINR(price.fromInPaise)}
        </>
      ) : (
        formatINR(price.fromInPaise)
      )}
      {!isRange &&
      compareAtInPaise !== null &&
      compareAtInPaise > price.fromInPaise ? (
        <>
          {" "}
          <s className={styles.compareAt}>
            <span className="visually-hidden">Previous price </span>
            {formatINR(compareAtInPaise)}
          </s>
        </>
      ) : null}
    </span>
  );
}
