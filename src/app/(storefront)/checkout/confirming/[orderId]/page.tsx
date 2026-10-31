import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConfirmingStatus } from "@/components/checkout/ConfirmingStatus";
import { Container } from "@/components/ui/Container";
import { getCheckoutPolicy } from "@/config/checkout-policy";
import { findAccessibleOrder } from "@/features/orders/service";
import { routes } from "@/lib/routes";
import { resolveOrderAccess } from "@/server/orders/context";

import styles from "../../page.module.css";

export const metadata: Metadata = {
  title: "Confirming your payment",
  robots: { index: false, follow: false },
};

export default async function ConfirmingPage({
  params,
}: PageProps<"/checkout/confirming/[orderId]">) {
  const { orderId } = await params;
  const found = await findAccessibleOrder(await resolveOrderAccess(), orderId);
  if (!found) notFound();
  if (found.row.status !== "PENDING_PAYMENT") {
    redirect(`${routes.checkoutConfirmation(orderId)}?placed=1`);
  }
  const policy = getCheckoutPolicy();

  return (
    <Container className={styles.page}>
      <div className={styles.narrow}>
        <h1 className={styles.heading}>Confirming your payment</h1>
        <p className={styles.lead}>
          Your payment for order {found.row.orderNumber} is being confirmed with
          the payment provider. This usually takes a few seconds; you can keep
          this page open or come back later.
        </p>
        <ConfirmingStatus
          orderId={orderId}
          pollSeconds={policy.payment.confirmingPollSeconds}
        />
        <p className={styles.muted}>
          Once confirmed we will email you. If it does not confirm, nothing is
          charged and you can{" "}
          <Link href={routes.checkoutPay(orderId)}>try the payment again</Link>.
        </p>
      </div>
    </Container>
  );
}
