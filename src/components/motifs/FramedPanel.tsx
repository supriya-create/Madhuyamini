import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

import styles from "./FramedPanel.module.css";

type FramedPanelProps = {
  children: ReactNode;
  caption?: ReactNode;
  className?: string;
};

/**
 * Frames content (usually an image) in a Madhubani-style border: outer rule,
 * hatched band, inner rule.
 */
export function FramedPanel({
  children,
  caption,
  className,
}: FramedPanelProps) {
  return (
    <figure className={cx(styles.figure, className)}>
      <div className={styles.frame}>
        <div className={styles.inner}>{children}</div>
      </div>
      {caption ? (
        <figcaption className={styles.caption}>{caption}</figcaption>
      ) : null}
    </figure>
  );
}
