import styles from "./ProductImageFallback.module.css";

type ProductImageFallbackProps = {
  title: string;
  aspect?: "portrait" | "square";
};

/**
 * Shown when a product has no photographs yet. Unlike `ImagePending` this is
 * safe in production: it is an honest empty state, not a stand-in for content.
 */
export function ProductImageFallback({
  title,
  aspect = "portrait",
}: ProductImageFallbackProps) {
  return (
    <div
      className={styles.fallback}
      data-aspect={aspect}
      role="img"
      aria-label={`${title}: no photograph yet`}
    >
      <span className={styles.label}>Photograph coming soon</span>
    </div>
  );
}
