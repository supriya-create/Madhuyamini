import { ButtonLink } from "@/components/ui/Button";
import type {
  ReturnEligibilityView,
  ReturnSummaryView,
} from "@/features/returns/types";
import { formatDate } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { ReturnList } from "./ReturnList";
import styles from "./Returns.module.css";

/**
 * The "Return or exchange items" section of the account order page: what
 * can still be returned and why not, plus the order's existing returns.
 */
export function ReturnEntryPanel({
  eligibility,
  returns,
  windowDays,
}: {
  eligibility: ReturnEligibilityView;
  returns: readonly ReturnSummaryView[];
  windowDays: number;
}) {
  return (
    <section className={styles.section} aria-labelledby="order-returns">
      <h3 id="order-returns" className={styles.sectionTitle}>
        Returns and exchanges
      </h3>
      {returns.length > 0 ? (
        <ReturnList returns={returns} showOrder={false} />
      ) : null}
      {eligibility.canRequest ? (
        <>
          <p>
            Items from this order can be returned
            {eligibility.windowClosesAt
              ? ` until ${formatDate(eligibility.windowClosesAt)}`
              : ""}
            .
          </p>
          <div className={styles.actions}>
            <ButtonLink
              href={routes.accountOrderReturn(eligibility.orderNumber)}
              variant="secondary"
            >
              Return or exchange items
            </ButtonLink>
          </div>
        </>
      ) : eligibility.deliveredAt ? (
        <ul className={styles.list}>
          {eligibility.lines.map((line) => (
            <li key={line.orderItemId} className={styles.item}>
              <span>
                {line.productTitle}
                {line.variantTitle ? ` · ${line.variantTitle}` : ""}
              </span>
              <span className={styles.muted}>
                {line.ineligibleMessage ?? "Can be returned."}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>
          Items can be returned within {windowDays} days of delivery.
        </p>
      )}
    </section>
  );
}
