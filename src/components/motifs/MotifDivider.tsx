import { cx } from "@/lib/cx";

import styles from "./MotifDivider.module.css";

type MotifDividerProps = {
  /** `full` spans its container; `short` is a centred accent beneath a heading. */
  width?: "full" | "short";
  className?: string;
};

/**
 * Madhubani border: a double rule enclosing a band of kachni (line) hatching.
 * Purely decorative — hidden from assistive technology.
 */
export function MotifDivider({ width = "full", className }: MotifDividerProps) {
  return (
    <div
      aria-hidden="true"
      className={cx(styles.divider, styles[width], className)}
    >
      <span className={styles.band} />
    </div>
  );
}
