import type { Metadata } from "next";

import { EmptyState } from "@/components/catalog/EmptyState";
import { CartLine } from "@/components/cart/CartLine";
import { CartSummary } from "@/components/cart/CartSummary";
import { Container } from "@/components/ui/Container";
import { getCartView } from "@/features/cart/service";
import { resolveCartContext } from "@/server/cart/context";
import { routes } from "@/lib/routes";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Your cart",
  robots: { index: false, follow: false },
};

export default async function CartPage({ searchParams }: PageProps<"/cart">) {
  const [context, query] = await Promise.all([
    resolveCartContext(),
    searchParams,
  ]);
  const cart = await getCartView(context);

  return (
    <Container className={styles.page}>
      <h1 className={styles.heading}>Your cart</h1>

      {query.issue === "availability" ? (
        <p role="status" className={styles.notice}>
          Some pieces became unavailable while you were checking out. They are
          marked below; adjust or remove them to continue.
        </p>
      ) : null}
      {query.order === "cancelled" ? (
        <p role="status" className={styles.notice}>
          Your order was cancelled and nothing has been charged. Your cart is
          unchanged.
        </p>
      ) : null}
      {query.cart === "adjusted" ? (
        <p role="status" className={styles.notice}>
          We combined the cart you started as a guest with your account. Some
          quantities were adjusted to what is available; please check them
          below.
        </p>
      ) : null}

      {cart.lines.length === 0 ? (
        <EmptyState
          heading="Your cart is empty"
          action={{ label: "Browse the collections", href: routes.collections }}
        >
          <p>
            Pieces you add will wait here for 30 days, even if you close your
            browser.
          </p>
        </EmptyState>
      ) : (
        <div className={styles.layout}>
          <section aria-labelledby="cart-lines-heading">
            <h2 id="cart-lines-heading" className="visually-hidden">
              Items
            </h2>
            {cart.hasPriceChanges ? (
              <p role="status" className={styles.notice}>
                A price has changed since you added an item. The current price
                is shown and will apply.
              </p>
            ) : null}
            <ul className={styles.lines}>
              {cart.lines.map((line) => (
                <CartLine key={line.id} line={line} />
              ))}
            </ul>
          </section>
          <CartSummary cart={cart} />
        </div>
      )}
    </Container>
  );
}
