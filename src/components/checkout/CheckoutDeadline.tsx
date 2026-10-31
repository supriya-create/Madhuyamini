"use client";

import { useEffect, useState } from "react";

import styles from "./CheckoutDeadline.module.css";

/** Counts down to the reservation deadline; the server remains the judge of it. */
export function CheckoutDeadline({ expiresAt }: { expiresAt: string }) {
  const target = new Date(expiresAt).getTime();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, target - Date.now()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  if (remaining === null) {
    return (
      <p className={styles.deadline}>
        Your pieces are held until{" "}
        <time dateTime={expiresAt}>
          {new Date(expiresAt).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        .
      </p>
    );
  }
  if (remaining === 0) {
    return (
      <p className={styles.expired} role="status">
        The payment window has closed. Your cart is still waiting.
      </p>
    );
  }
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return (
    <p className={styles.deadline} aria-live="off">
      Your pieces are held for another{" "}
      <span className={styles.clock}>
        {minutes}:{seconds.toString().padStart(2, "0")}
      </span>{" "}
      minutes.
    </p>
  );
}
