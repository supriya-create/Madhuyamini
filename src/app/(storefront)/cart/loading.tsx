import { Container } from "@/components/ui/Container";

import styles from "./page.module.css";

export default function CartLoading() {
  return (
    <Container className={styles.page} aria-busy="true" aria-live="polite">
      <p className="visually-hidden">Loading your cart</p>
      <h1 className={styles.heading}>Your cart</h1>
    </Container>
  );
}
