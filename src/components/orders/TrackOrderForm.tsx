"use client";

import { useActionState } from "react";

import { Field } from "@/components/forms/Field";
import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { idleFormState } from "@/features/auth/schemas";
import { trackOrderAction } from "@/features/checkout/actions";

export function TrackOrderForm() {
  const [state, action] = useActionState(trackOrderAction, idleFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className={formStyles.form} noValidate>
      <FormStatus state={state} />
      <Field
        id="track-order-number"
        name="orderNumber"
        label="Order number"
        placeholder="MY-XXXXXXXX"
        autoComplete="off"
        required
        error={errors.orderNumber}
      />
      <Field
        id="track-email"
        name="email"
        label="Email address used for the order"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        error={errors.email}
      />
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Looking up…">Find my order</SubmitButton>
      </div>
    </form>
  );
}
