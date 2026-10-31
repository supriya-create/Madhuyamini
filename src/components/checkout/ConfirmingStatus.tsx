"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { checkOrderStatusAction } from "@/features/checkout/actions";
import { routes } from "@/lib/routes";

import styles from "./ConfirmingStatus.module.css";

/**
 * Shown when the callback was verified but the provider has not reported a
 * capture yet. Asks the server again every few seconds; the webhook or the
 * reconciliation job finishes the order meanwhile.
 */
export function ConfirmingStatus({
  orderId,
  pollSeconds,
}: {
  orderId: string;
  pollSeconds: number;
}) {
  const router = useRouter();
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      void checkOrderStatusAction(orderId).then((snapshot) => {
        if (cancelled || !snapshot) return;
        setChecks((n) => n + 1);
        if (
          snapshot.status === "CONFIRMED" ||
          snapshot.status === "NEEDS_REVIEW"
        ) {
          router.replace(`${routes.checkoutConfirmation(orderId)}?placed=1`);
        } else if (snapshot.status === "CANCELLED") {
          router.replace(`${routes.checkoutPay(orderId)}?expired=1`);
        } else if (snapshot.latestPaymentStatus === "FAILED") {
          router.replace(`${routes.checkoutPay(orderId)}?failed=1`);
        }
      });
    }, pollSeconds * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [orderId, pollSeconds, router]);

  return (
    <p className={styles.status} role="status" aria-live="polite">
      Checking with the payment provider{checks > 0 ? ` (${checks})` : ""}…
    </p>
  );
}
