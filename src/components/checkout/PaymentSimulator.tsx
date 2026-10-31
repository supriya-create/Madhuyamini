import { Button } from "@/components/ui/Button";
import { simulatePaymentAction } from "@/features/checkout/actions";

import styles from "./PaymentSimulator.module.css";

/**
 * Rendered only when PAYMENT_GATEWAY=fake (development, tests, CI). Each
 * button records an outcome at the fake provider and runs the real
 * confirmation path, so the pages behave exactly as with Razorpay.
 */
export function PaymentSimulator({ orderId }: { orderId: string }) {
  const outcomes = [
    { value: "captured", label: "Simulate successful payment" },
    { value: "failed", label: "Simulate failed payment" },
    { value: "authorized", label: "Simulate authorised (not yet captured)" },
    { value: "captured_silently", label: "Simulate payment with no callback" },
  ] as const;
  return (
    <section
      className={styles.panel}
      aria-labelledby="payment-simulator-heading"
    >
      <h2 id="payment-simulator-heading" className={styles.heading}>
        Test payments (fake gateway)
      </h2>
      <p className={styles.note}>
        This panel exists only in development and test builds.
      </p>
      <ul className={styles.list}>
        {outcomes.map((outcome) => (
          <li key={outcome.value}>
            <form action={simulatePaymentAction}>
              <input type="hidden" name="orderId" value={orderId} />
              <input type="hidden" name="outcome" value={outcome.value} />
              <Button type="submit" variant="secondary">
                {outcome.label}
              </Button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
