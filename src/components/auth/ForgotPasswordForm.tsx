"use client";

import { useActionState } from "react";

import { Field } from "@/components/forms/Field";
import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { forgotPasswordAction } from "@/features/auth/actions";
import { idleFormState } from "@/features/auth/schemas";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, idleFormState);
  return (
    <form action={action} className={formStyles.form} noValidate>
      <FormStatus state={state} />
      {state.status !== "success" ? (
        <>
          <Field
            id="forgot-email"
            name="email"
            label="Email address"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            error={state.fieldErrors?.email}
          />
          <div className={formStyles.actions}>
            <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
          </div>
        </>
      ) : null}
    </form>
  );
}
