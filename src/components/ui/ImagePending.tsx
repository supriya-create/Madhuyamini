import { cx } from "@/lib/cx";
import { isProduction } from "@/server/env";

import styles from "./ImagePending.module.css";

type ImagePendingProps = {
  /** What the real image should show, e.g. "Hero: a Madhubani saree in natural light". */
  description: string;
  aspect?: "portrait" | "landscape" | "square";
};

/**
 * Development-only stand-in for brand photography that has not been supplied yet.
 *
 * It refuses to render when SITE_ENV=production, so a production build fails
 * loudly instead of shipping a placeholder (see docs/architecture.md, D2).
 */
export function ImagePending({
  description,
  aspect = "portrait",
}: ImagePendingProps) {
  if (isProduction) {
    throw new Error(
      `ImagePending rendered in production ("${description}"). Supply the image.`,
    );
  }

  return (
    <div className={cx(styles.pending, styles[aspect])}>
      <p className={styles.label}>Image pending</p>
      <p className={styles.description}>{description}</p>
    </div>
  );
}
