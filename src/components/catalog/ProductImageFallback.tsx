import styles from "./ProductImageFallback.module.css";

type ProductImageFallbackProps = {
  title: string;
  aspect?: "portrait" | "square";
  /** Thumbnails (cart lines, order items) are too small for the full label. */
  size?: "default" | "thumbnail";
};

/**
 * Shown when a product has no photographs yet. Unlike `ImagePending` this is
 * safe in production: it is an honest empty state, not a stand-in for content.
 */
export function ProductImageFallback({
  title,
  aspect = "portrait",
  size = "default",
}: ProductImageFallbackProps) {
  return (
    <div
      className={styles.fallback}
      data-aspect={aspect}
      data-size={size}
      role="img"
      aria-label={`${title}: no photograph yet`}
    >
      <span className={styles.label}>
        {size === "thumbnail" ? "No photo yet" : "Photograph coming soon"}
      </span>
    </div>
  );
}
