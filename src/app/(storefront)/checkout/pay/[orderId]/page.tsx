import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CheckoutDeadline } from "@/components/checkout/CheckoutDeadline";
import { PaymentSimulator } from "@/components/checkout/PaymentSimulator";
import { RazorpayCheckout } from "@/components/checkout/RazorpayCheckout";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import {
  cancelPendingOrderAction,
  startPaymentAttemptAction,
} from "@/features/checkout/actions";
import { findAccessibleOrder } from "@/features/orders/service";
import { toOrderDetailView } from "@/features/orders/types";
import { findOpenAttempt } from "@/features/payments/data";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";
import { resolveOrderAccess } from "@/server/orders/context";
import { getPaymentGateway, isFakeGateway } from "@/server/payments";

import styles from "../../page.module.css";

export const metadata: Metadata = {
  title: "Pay for your order",
  robots: { index: false, follow: false },
};

/** Razorpay modal accent; the same sindoor red as `--color-sindoor`. */
const THEME_COLOR = "#9b2d20";

export default async function PayPage({
  params,
  searchParams,
}: PageProps<"/checkout/pay/[orderId]">) {
  const [{ orderId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveOrderAccess();
  const found = await findAccessibleOrder(access, orderId);
  if (!found) {
    if (access.kind === "anonymous") {
      redirect(
        `${routes.login}?next=${encodeURIComponent(routes.checkoutPay(orderId))}`,
      );
    }
    notFound();
  }
  const now = new Date();
  const view = toOrderDetailView(found.row, found.exposure, now);
  if (view.status !== "PENDING_PAYMENT" || view.paymentMethod !== "RAZORPAY") {
    redirect(routes.checkoutConfirmation(orderId));
  }

  const attempt = await findOpenAttempt(orderId);
  const expired = !view.canPay;
  let keyId: string | null = null;
  try {
    keyId = getPaymentGateway().publicKeyId;
  } catch {
    keyId = null;
  }
  const payable =
    !expired &&
    keyId !== null &&
    attempt !== null &&
    attempt.providerOrderId !== null &&
    attempt.status !== "INITIATED";

  const notice =
    query.failed === "1"
      ? {
          tone: "error",
          text: "Your payment did not go through. Nothing was charged; you can try again below.",
        }
      : query.invalid === "1"
        ? {
            tone: "error",
            text: "We could not verify the payment details we received. If money was taken it will be matched to this order automatically.",
          }
        : query.limited === "1"
          ? {
              tone: "error",
              text: "Too many payment attempts in a short time. Please wait a minute.",
            }
          : query.expired === "1"
            ? {
                tone: "error",
                text: "The payment window closed before the payment completed.",
              }
            : null;

  return (
    <Container className={styles.page}>
      <div className={styles.narrow}>
        <h1 className={styles.heading}>Pay for order {view.orderNumber}</h1>
        <p className={styles.lead}>
          Total to pay: <strong>{formatINR(view.totalInPaise)}</strong>
        </p>
        {notice ? (
          <p className={styles.notice} data-tone={notice.tone} role="alert">
            {notice.text}
          </p>
        ) : null}

        {expired ? (
          <div className={styles.panel}>
            <p>
              The payment window for this order has closed and your pieces have
              been released. Your cart is still waiting if you would like to try
              again.
            </p>
            <div className={styles.actions}>
              <ButtonLink href={routes.cart}>Back to your cart</ButtonLink>
            </div>
          </div>
        ) : (
          <div className={styles.panel}>
            {view.pendingExpiresAt ? (
              <CheckoutDeadline
                expiresAt={view.pendingExpiresAt.toISOString()}
              />
            ) : null}
            {payable && keyId && attempt?.providerOrderId ? (
              <RazorpayCheckout
                orderId={view.id}
                keyId={keyId}
                providerOrderId={attempt.providerOrderId}
                amountInPaise={view.totalInPaise}
                currency="INR"
                orderNumber={view.orderNumber}
                prefill={{
                  name: view.address.recipientName,
                  email: view.contact.email,
                  contact: view.contact.phone ?? "",
                }}
                themeColor={THEME_COLOR}
              />
            ) : keyId === null ? (
              <p role="status">
                Online payment is not available right now. You can cancel this
                order and choose cash on delivery from your cart.
              </p>
            ) : (
              <form
                action={startPaymentAttemptAction}
                className={styles.actions}
              >
                <input type="hidden" name="orderId" value={view.id} />
                <Button type="submit">
                  {view.payment.attemptCount > 0
                    ? "Try again"
                    : "Start payment"}
                </Button>
                <span className={styles.muted}>
                  {attempt
                    ? "We could not reach the payment provider a moment ago."
                    : "Opens a fresh payment attempt for this order."}
                </span>
              </form>
            )}
            {isFakeGateway() && payable ? (
              <PaymentSimulator orderId={view.id} />
            ) : null}
          </div>
        )}

        <div className={styles.actions}>
          <form action={cancelPendingOrderAction}>
            <input type="hidden" name="orderId" value={view.id} />
            <Button type="submit" variant="quiet">
              Cancel this order
            </Button>
          </form>
          <Link href={routes.checkoutConfirmation(view.id)}>Order details</Link>
        </div>
      </div>
    </Container>
  );
}
