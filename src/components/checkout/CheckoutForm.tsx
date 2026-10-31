"use client";

import { useActionState, useState } from "react";

import { Field } from "@/components/forms/Field";
import fieldStyles from "@/components/forms/Field.module.css";
import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import type { AddressRow } from "@/features/account/data";
import { idleFormState } from "@/features/auth/schemas";
import { placeOrderAction } from "@/features/checkout/actions";
import type { CodRefusal } from "@/features/checkout/rules";
import { formatINR } from "@/lib/money";

import styles from "./CheckoutForm.module.css";

export interface CheckoutFormProps {
  cartId: string;
  customer: { email: string; phone: string | null; name: string } | null;
  addresses: readonly AddressRow[];
  quoteHashes: { RAZORPAY: string; COD: string };
  totals: { RAZORPAY: number; COD: number };
  codRefusal: CodRefusal | null;
  codFeeInPaise: number;
  belowMinimum: boolean;
}

/**
 * One page, one form: contact, delivery address, payment method, note.
 * Works without JavaScript (a plain POST); with it, errors are announced in
 * place. Amounts are never posted: the server recomputes them and compares
 * the hash of what this page showed.
 */
export function CheckoutForm({
  cartId,
  customer,
  addresses,
  quoteHashes,
  totals,
  codRefusal,
  codFeeInPaise,
  belowMinimum,
}: CheckoutFormProps) {
  const [state, action] = useActionState(placeOrderAction, idleFormState);
  const errors = state.fieldErrors ?? {};
  const defaultAddress =
    addresses.find((address) => address.isDefault) ?? addresses[0] ?? null;
  const [useNewAddress, setUseNewAddress] = useState(addresses.length === 0);

  return (
    <form action={action} className={styles.form} noValidate>
      <input type="hidden" name="cartId" value={cartId} />
      <input
        type="hidden"
        name="quoteHash:RAZORPAY"
        value={quoteHashes.RAZORPAY}
      />
      <input type="hidden" name="quoteHash:COD" value={quoteHashes.COD} />
      <FormStatus state={state} />

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Contact</legend>
        {customer ? (
          <>
            <input type="hidden" name="email" value={customer.email} />
            <p className={styles.static}>
              <span className={styles.staticLabel}>Email</span> {customer.email}
            </p>
          </>
        ) : (
          <Field
            id="checkout-email"
            name="email"
            label="Email address"
            type="email"
            autoComplete="email"
            inputMode="email"
            hint="Your order confirmation goes here."
            required
            error={errors.email}
          />
        )}
        <Field
          id="checkout-phone"
          name="phone"
          label="Phone number"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          hint="For delivery updates and cash-on-delivery confirmation."
          defaultValue={customer?.phone ?? ""}
          required
          error={errors.phone}
        />
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Delivery address</legend>
        {addresses.length > 0 ? (
          <ul className={styles.choices}>
            {addresses.map((address) => (
              <li key={address.id}>
                <label className={styles.choice}>
                  <input
                    type="radio"
                    name="addressId"
                    value={address.id}
                    defaultChecked={address.id === defaultAddress?.id}
                    onChange={() => setUseNewAddress(false)}
                  />
                  <span className={styles.choiceTitle}>
                    {address.label ?? address.recipientName}
                  </span>
                  <span className={styles.choiceBody}>
                    {[
                      address.label ? address.recipientName : null,
                      address.line1,
                      address.line2,
                      address.landmark,
                      `${address.city}, ${address.state} ${address.postalCode}`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </label>
              </li>
            ))}
            <li>
              <label className={styles.choice}>
                <input
                  type="radio"
                  name="addressId"
                  value=""
                  defaultChecked={false}
                  onChange={() => setUseNewAddress(true)}
                />
                <span className={styles.choiceTitle}>
                  Use a different address
                </span>
              </label>
            </li>
          </ul>
        ) : null}
        {errors.addressId ? (
          <p className={fieldStyles.error} role="alert">
            {errors.addressId}
          </p>
        ) : null}

        {useNewAddress ? (
          <div className={styles.addressFields}>
            <Field
              id="checkout-recipient"
              name="recipientName"
              label="Recipient’s name"
              autoComplete="shipping name"
              defaultValue={customer?.name ?? ""}
              required
              error={errors.recipientName}
            />
            <Field
              id="checkout-line1"
              name="line1"
              label="Address"
              autoComplete="shipping address-line1"
              required
              error={errors.line1}
            />
            <Field
              id="checkout-line2"
              name="line2"
              label="Address line 2 (optional)"
              autoComplete="shipping address-line2"
              error={errors.line2}
            />
            <Field
              id="checkout-landmark"
              name="landmark"
              label="Landmark (optional)"
              error={errors.landmark}
            />
            <div className={formStyles.row}>
              <Field
                id="checkout-city"
                name="city"
                label="City"
                autoComplete="shipping address-level2"
                required
                error={errors.city}
              />
              <Field
                id="checkout-state"
                name="state"
                label="State"
                autoComplete="shipping address-level1"
                required
                error={errors.state}
              />
            </div>
            <Field
              id="checkout-postal"
              name="postalCode"
              label="PIN code"
              autoComplete="shipping postal-code"
              inputMode="numeric"
              maxLength={6}
              required
              error={errors.postalCode}
            />
            {customer ? (
              <label className={styles.checkbox}>
                <input type="checkbox" name="saveAddress" value="on" />
                <span>Save this address to my account</span>
              </label>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Payment</legend>
        <ul className={styles.choices}>
          <li>
            <label className={styles.choice}>
              <input
                type="radio"
                name="paymentMethod"
                value="RAZORPAY"
                defaultChecked
                disabled={belowMinimum}
              />
              <span className={styles.choiceTitle}>
                Pay online — {formatINR(totals.RAZORPAY)}
              </span>
              <span className={styles.choiceBody}>
                UPI, cards, net banking and wallets through Razorpay.
              </span>
            </label>
          </li>
          <li>
            <label
              className={styles.choice}
              data-disabled={codRefusal !== null}
            >
              <input
                type="radio"
                name="paymentMethod"
                value="COD"
                disabled={codRefusal !== null}
              />
              <span className={styles.choiceTitle}>
                Cash on delivery — {formatINR(totals.COD)}
              </span>
              <span className={styles.choiceBody}>
                {codRefusal === "over_limit"
                  ? "Not available for this order value."
                  : codRefusal === "disabled"
                    ? "Not available at the moment."
                    : codFeeInPaise > 0
                      ? `Includes a ${formatINR(codFeeInPaise)} cash handling fee.`
                      : "Pay the courier when your order arrives."}
              </span>
            </label>
          </li>
        </ul>
        {errors.paymentMethod ? (
          <p className={fieldStyles.error} role="alert">
            {errors.paymentMethod}
          </p>
        ) : null}
      </fieldset>

      <div className={fieldStyles.field}>
        <label htmlFor="checkout-note" className={fieldStyles.label}>
          Note for us (optional)
        </label>
        <textarea
          id="checkout-note"
          name="customerNote"
          className={styles.textarea}
          rows={3}
          maxLength={500}
          aria-invalid={errors.customerNote ? true : undefined}
        />
        {errors.customerNote ? (
          <p className={fieldStyles.error} role="alert">
            {errors.customerNote}
          </p>
        ) : null}
      </div>

      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Placing your order…">
          Place order
        </SubmitButton>
      </div>
      <p className={formStyles.footnote}>
        Prices are confirmed when you place the order. Stock is held for a short
        while during online payment.
      </p>
    </form>
  );
}
