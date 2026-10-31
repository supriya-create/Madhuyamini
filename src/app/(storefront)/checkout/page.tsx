import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { OrderSummaryPanel } from "@/components/checkout/OrderSummaryPanel";
import { Container } from "@/components/ui/Container";
import { getCheckoutPolicy } from "@/config/checkout-policy";
import { getCheckoutView } from "@/features/checkout/service";
import { getCurrentUser } from "@/server/auth/current-user";
import { resolveCartContext } from "@/server/cart/context";
import { routes } from "@/lib/routes";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const [context, user] = await Promise.all([
    resolveCartContext(),
    getCurrentUser(),
  ]);
  const view = await getCheckoutView(context);
  if (!view || !view.cart.canCheckout) redirect(routes.cart);
  const policy = getCheckoutPolicy();

  return (
    <Container className={styles.page}>
      <h1 className={styles.heading}>Checkout</h1>
      <div className={styles.layout}>
        <CheckoutForm
          cartId={view.cartId}
          customer={
            user
              ? { email: user.email, phone: user.phone, name: user.name }
              : null
          }
          addresses={view.addresses}
          quoteHashes={{
            RAZORPAY: view.quotes.RAZORPAY.hash,
            COD: view.quotes.COD.hash,
          }}
          totals={{
            RAZORPAY: view.quotes.RAZORPAY.totalInPaise,
            COD: view.quotes.COD.totalInPaise,
          }}
          codRefusal={view.codRefusal}
          codFeeInPaise={policy.cod.feeInPaise}
          belowMinimum={view.belowMinimum}
        />
        <OrderSummaryPanel
          lines={view.lines}
          quote={view.quotes.RAZORPAY}
          codFeeInPaise={policy.cod.feeInPaise}
        />
      </div>
    </Container>
  );
}
