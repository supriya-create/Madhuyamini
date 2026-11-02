import Link from "next/link";

import type { ReturnSummaryView } from "@/features/returns/types";
import { formatDate } from "@/lib/dates";
import { routes } from "@/lib/routes";

import styles from "./Returns.module.css";

export function ReturnList({
  returns,
  showOrder = true,
}: {
  returns: readonly ReturnSummaryView[];
  showOrder?: boolean;
}) {
  return (
    <ul className={styles.list}>
      {returns.map((item) => (
        <li key={item.id} className={styles.item}>
          <p>
            <Link href={routes.accountReturn(item.requestNumber)}>
              {item.requestNumber}
            </Link>
            {showOrder && item.orderNumber ? (
              <span className={styles.muted}> · order {item.orderNumber}</span>
            ) : null}
          </p>
          <p className={styles.muted}>
            {formatDate(item.createdAt)} · {item.units}{" "}
            {item.units === 1 ? "unit" : "units"} · {item.statusLabel}
          </p>
        </li>
      ))}
    </ul>
  );
}
