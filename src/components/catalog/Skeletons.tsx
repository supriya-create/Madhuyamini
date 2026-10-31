import { Container } from "@/components/ui/Container";

import styles from "./Skeletons.module.css";

/**
 * Static placeholders for streaming states. No animation: they respect
 * reduced motion by construction and avoid layout shift by matching the
 * real components' proportions.
 */
export function ListingSkeleton() {
  return (
    <Container className={styles.page} aria-busy="true" aria-live="polite">
      <p className="visually-hidden">Loading products</p>
      <div className={styles.headerBlock}>
        <span className={`${styles.line} ${styles.short}`} />
        <span className={`${styles.line} ${styles.heading}`} />
      </div>
      <div className={styles.layout}>
        <div className={styles.sidebar}>
          <span className={styles.line} />
          <span className={styles.line} />
          <span className={styles.line} />
        </div>
        <ul className={styles.grid}>
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index} className={styles.card}>
              <span className={styles.media} />
              <span className={`${styles.line} ${styles.short}`} />
              <span className={styles.line} />
            </li>
          ))}
        </ul>
      </div>
    </Container>
  );
}

export function ProductSkeleton() {
  return (
    <Container className={styles.page} aria-busy="true" aria-live="polite">
      <p className="visually-hidden">Loading product</p>
      <div className={styles.product}>
        <span className={styles.mediaLarge} />
        <div className={styles.details}>
          <span className={`${styles.line} ${styles.short}`} />
          <span className={`${styles.line} ${styles.heading}`} />
          <span className={styles.line} />
          <span className={styles.line} />
          <span className={`${styles.line} ${styles.short}`} />
        </div>
      </div>
    </Container>
  );
}
