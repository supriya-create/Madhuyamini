import styles from "./SkipLink.module.css";

export const MAIN_CONTENT_ID = "main-content";

export function SkipLink() {
  return (
    <a href={`#${MAIN_CONTENT_ID}`} className={styles.skipLink}>
      Skip to main content
    </a>
  );
}
