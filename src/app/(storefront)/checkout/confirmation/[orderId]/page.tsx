import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrderDetail } from "@/components/orders/OrderDetail";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { findAccessibleOrder } from "@/features/orders/service";
import { toOrderDetailView } from "@/features/orders/types";
import { routes } from "@/lib/routes";
import { resolveOrderAccess } from "@/server/orders/context";

import styles from "../../page.module.css";

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

export default async function ConfirmationPage({
  params,
  searchParams,
}: PageProps<"/checkout/confirmation/[orderId]">) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveOrderAccess();
  const found = await findAccessibleOrder(access, orderId);
  if (!found) {
    if (access.kind === "anonymous") redirect(routes.trackOrder);
    notFound();
  }
  const view = toOrderDetailView(found.row, found.exposure, new Date());
  const justPlaced = query.placed === "1";

  return (
    <Container className={styles.page}>
      <div className={styles.narrow}>
        {justPlaced && view.status === "CONFIRMED" ? (
          <>
            <h1 className={styles.heading}>Thank you</h1>
            <p className={styles.notice} data-tone="success" role="status">
              Your order {view.orderNumber} is confirmed. A confirmation is on
              its way to {view.contact.email}.
            </p>
          </>
        ) : (
          <h1 className={styles.heading}>Your order</h1>
        )}
        <OrderDetail view={view} showTimeline={access.kind === "user"} />
        <div className={styles.actions}>
          {access.kind === "user" ? (
            <ButtonLink href={routes.accountOrders} variant="secondary">
              All your orders
            </ButtonLink>
          ) : (
            <p className={styles.muted}>
              Come back any time with your order number and email at{" "}
              <Link href={routes.trackOrder}>Track an order</Link>.
            </p>
          )}
          <ButtonLink href={routes.collections} variant="secondary">
            Continue shopping
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
