"use client";

import Link from "next/link";
import { useActionState, useId } from "react";

import { SubmitButton } from "@/components/forms/SubmitButton";
import { idleCartState } from "@/features/cart/action-state";
import { addToCartAction } from "@/features/cart/actions";
import { routes } from "@/lib/routes";

import styles from "./AddToCartForm.module.css";

type AddToCartFormProps = {
  variantId: string;
  /** Highest quantity the customer may pick now: min(10, available), 1 for one-of-a-kind. */
  maxQuantity: number;
  disabled?: boolean;
};

/**
 * Quantity + "Add to cart". Works without JavaScript (a plain form post); with
 * it, the outcome is announced in place and the header count refreshes.
 */
export function AddToCartForm({
  variantId,
  maxQuantity,
  disabled = false,
}: AddToCartFormProps) {
  const [state, action] = useActionState(addToCartAction, idleCartState);
  const quantityId = useId();
  const options = Array.from(
    { length: Math.max(0, Math.min(maxQuantity, 10)) },
    (_, i) => i + 1,
  );
  const unavailable = disabled || options.length === 0;

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="variantId" value={variantId} />
      <div className={styles.row}>
        {options.length > 1 ? (
          <div className={styles.quantity}>
            <label htmlFor={quantityId} className={styles.label}>
              Quantity
            </label>
            <select
              id={quantityId}
              name="quantity"
              defaultValue="1"
              className={styles.select}
              disabled={unavailable}
            >
              {options.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="quantity" value="1" />
        )}
        {unavailable ? (
          <p className={styles.unavailable}>Not available to add right now.</p>
        ) : (
          <SubmitButton pendingLabel="Adding…">Add to cart</SubmitButton>
        )}
      </div>
      <div
        aria-live="polite"
        role={state.status === "error" ? "alert" : "status"}
        className={styles.outcome}
      >
        {state.status === "idle" ? null : (
          <p data-status={state.status}>
            {state.message}
            {state.status === "success" ? (
              <>
                {" "}
                <Link href={routes.cart}>View cart</Link>
              </>
            ) : null}
          </p>
        )}
      </div>
    </form>
  );
}
