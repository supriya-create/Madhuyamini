"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { Button } from "@/components/ui/Button";
import { idleFormState } from "@/features/auth/schemas";
import {
  confirmPaymentAction,
  recordPaymentFailureAction,
} from "@/features/checkout/actions";

import styles from "./RazorpayCheckout.module.css";

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayFailure {
  error?: {
    code?: string;
    description?: string;
    metadata?: { order_id?: string; payment_id?: string };
  };
}

interface RazorpayInstance {
  open(): void;
  on(
    event: "payment.failed",
    handler: (response: RazorpayFailure) => void,
  ): void;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name?: string; email?: string; contact?: string };
  notes: Record<string, string>;
  theme: { color: string };
  handler: (response: RazorpaySuccess) => void;
  modal: { ondismiss: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export interface RazorpayCheckoutProps {
  orderId: string;
  keyId: string;
  providerOrderId: string;
  amountInPaise: number;
  currency: string;
  orderNumber: string;
  prefill: { name: string; email: string; contact: string };
  themeColor: string;
}

/**
 * Opens Razorpay's hosted checkout. The success handler posts the three
 * fields to the server, which verifies the signature and asks Razorpay for
 * the capture before anything is marked paid; a failure is recorded as such.
 */
export function RazorpayCheckout(props: RazorpayCheckoutProps) {
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const [confirmState, confirmAction] = useActionState(
    confirmPaymentAction,
    idleFormState,
  );
  const confirmForm = useRef<HTMLFormElement>(null);
  const failureForm = useRef<HTMLFormElement>(null);
  const [success, setSuccess] = useState<RazorpaySuccess | null>(null);
  const [failure, setFailure] = useState<RazorpayFailure["error"] | null>(null);

  useEffect(() => {
    if (window.Razorpay) {
      // Already loaded (client-side navigation back to this page).
      const id = window.setTimeout(() => setReady(true), 0);
      return () => window.clearTimeout(id);
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CHECKOUT_SCRIPT}"]`,
    );
    const script = existing ?? document.createElement("script");
    const onLoad = () => setReady(Boolean(window.Razorpay));
    script.addEventListener("load", onLoad);
    if (!existing) {
      script.src = CHECKOUT_SCRIPT;
      script.async = true;
      document.body.append(script);
    }
    return () => script.removeEventListener("load", onLoad);
  }, []);

  useEffect(() => {
    if (success) confirmForm.current?.requestSubmit();
  }, [success]);

  useEffect(() => {
    if (failure) failureForm.current?.requestSubmit();
  }, [failure]);

  function open() {
    if (!window.Razorpay) return;
    setOpening(true);
    const instance = new window.Razorpay({
      key: props.keyId,
      order_id: props.providerOrderId,
      amount: props.amountInPaise,
      currency: props.currency,
      name: "Madhuyamini",
      description: `Order ${props.orderNumber}`,
      prefill: props.prefill,
      notes: { orderId: props.orderId },
      theme: { color: props.themeColor },
      handler: (response) => setSuccess(response),
      modal: { ondismiss: () => setOpening(false) },
    });
    instance.on("payment.failed", (response) => {
      setOpening(false);
      setFailure(response.error ?? {});
    });
    instance.open();
  }

  return (
    <div className={styles.wrapper}>
      <Button
        type="button"
        onClick={open}
        disabled={!ready || opening || success !== null}
        aria-busy={opening}
      >
        {success
          ? "Confirming your payment…"
          : ready
            ? "Pay now"
            : "Loading secure payment…"}
      </Button>
      <noscript>
        <p className={styles.noscript}>
          Online payment needs JavaScript. Enable it, or go back to the cart and
          choose cash on delivery.
        </p>
      </noscript>

      <form
        ref={confirmForm}
        action={confirmAction}
        className={formStyles.form}
        hidden={success === null && confirmState.status !== "error"}
      >
        <input type="hidden" name="orderId" value={props.orderId} />
        <input
          type="hidden"
          name="razorpay_order_id"
          value={success?.razorpay_order_id ?? ""}
        />
        <input
          type="hidden"
          name="razorpay_payment_id"
          value={success?.razorpay_payment_id ?? ""}
        />
        <input
          type="hidden"
          name="razorpay_signature"
          value={success?.razorpay_signature ?? ""}
        />
        <FormStatus state={confirmState} />
      </form>

      <form ref={failureForm} action={recordPaymentFailureAction} hidden>
        <input type="hidden" name="orderId" value={props.orderId} />
        <input
          type="hidden"
          name="razorpay_order_id"
          value={failure?.metadata?.order_id ?? props.providerOrderId}
        />
        <input
          type="hidden"
          name="razorpay_payment_id"
          value={failure?.metadata?.payment_id ?? ""}
        />
        <input type="hidden" name="code" value={failure?.code ?? ""} />
        <input
          type="hidden"
          name="description"
          value={failure?.description ?? ""}
        />
      </form>
    </div>
  );
}
