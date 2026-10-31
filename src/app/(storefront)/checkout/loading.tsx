import { Container } from "@/components/ui/Container";

import styles from "./page.module.css";

export default function CheckoutLoading() {
  return (
    <Container className={styles.page} aria-busy="true" aria-live="polite">
      <p className="visually-hidden">Loading checkout</p>
      <h1 className={styles.heading}>Checkout</h1>
    </Container>
  );
}
