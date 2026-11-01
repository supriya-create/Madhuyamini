import type { ReactNode } from "react";

import styles from "./Admin.module.css";

/**
 * Tables scroll sideways on narrow screens; a scrollable region must be
 * reachable from the keyboard and announced (WCAG 2.1.1, axe
 * `scrollable-region-focusable`).
 */
export function TableWrap({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.tableWrap}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a sideways-scrolling region must be reachable from the keyboard (WCAG 2.1.1; axe scrollable-region-focusable)
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      {children}
    </div>
  );
}
