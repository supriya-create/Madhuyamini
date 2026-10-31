import { ButtonLink } from "@/components/ui/Button";
import type { CartView } from "@/features/cart/types";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

import styles from "./CartSummary.module.css";

export function CartSummary({ cart }: { cart: CartView }) {
  return (
    <aside className={styles.summary} aria-labelledby="cart-summary-heading">
      <h2 id="cart-summary-heading" className={styles.heading}>
        Summary
      </h2>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>
            Subtotal ({cart.itemCount} {cart.itemCount === 1 ? "item" : "items"}
            )
          </dt>
          <dd>{formatINR(cart.subtotalInPaise)}</dd>
        </div>
        <div className={styles.row}>
          <dt>Shipping and taxes</dt>
          <dd className={styles.muted}>Calculated at checkout</dd>
        </div>
      </dl>
      {cart.hasAvailabilityIssues ? (
        <p className={styles.blocked} role="status">
          Some pieces in your cart are not available as chosen. Adjust or remove
          them before checking out.
        </p>
      ) : null}
      <p className={styles.note}>
        {cart.canCheckout
          ? "Checkout opens in the next release. Prices are confirmed when your order is placed."
          : "Checkout is unavailable until every line can be bought as chosen."}
      </p>
      <ButtonLink href={routes.collections} variant="secondary">
        Continue shopping
      </ButtonLink>
    </aside>
  );
}
