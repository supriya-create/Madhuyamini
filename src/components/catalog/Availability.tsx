import type { StockStatus } from "@/features/catalog/rules";

import styles from "./Availability.module.css";

type AvailabilityProps = {
  status: StockStatus;
  available?: number;
  isOneOfAKind?: boolean;
};

/** Stock state as text (never colour alone), with a quiet marker. */
export function Availability({
  status,
  available,
  isOneOfAKind = false,
}: AvailabilityProps) {
  const label =
    status === "out_of_stock"
      ? "Sold out"
      : isOneOfAKind
        ? "One of a kind, available"
        : status === "low_stock"
          ? `Only ${available ?? "a few"} left`
          : "In stock";

  return (
    <span className={styles.availability} data-status={status}>
      <span aria-hidden="true" className={styles.marker} />
      {label}
    </span>
  );
}
