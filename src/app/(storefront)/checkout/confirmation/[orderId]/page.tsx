import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { OrderDetail } from "@/components/orders/OrderDetail";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { findAccessibleOrder } from "@/features/orders/service";
import { toOrderDetailView } from "@/features/orders/types";
import { expireOverdueOrderFor } from "@/features/payments/expiry";
import { routes } from "@/lib/routes";
import { orderIdSchema } from "@/features/checkout/schemas";
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
  // A malformed id is a wrong address, not a server fault: 404, never 500.
  if (!orderIdSchema.safeParse({ orderId }).success) notFound();
  const access = await resolveOrderAccess();
  const found = await findAccessibleOrder(access, orderId);
  if (!found) {
    if (access.kind === "anonymous") redirect(routes.trackOrder);
    notFound();
  }
  const now = new Date();
  let view = toOrderDetailView(found.row, found.exposure, now);
  if (view.status === "PENDING_PAYMENT" && !view.canPay) {
    // Overdue: settle it now rather than show a stale "awaiting payment"
    // until the sweep runs (B-23). Only overdue orders take this path.
    const settled = await expireOverdueOrderFor(access, orderId, now);
    if (settled.kind === "cancelled" || settled.kind === "confirmed") {
      const again = await findAccessibleOrder(access, orderId, now);
      if (again) view = toOrderDetailView(again.row, again.exposure, now);
    }
  }
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
