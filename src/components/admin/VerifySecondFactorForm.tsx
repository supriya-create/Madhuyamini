"use client";

import { useActionState, useId, useState } from "react";

import { Field } from "@/components/forms/Field";
import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { verifySecondFactorAction } from "@/features/admin/security/actions";
import { idleFormState } from "@/features/auth/schemas";

import styles from "./TwoFactor.module.css";

type Method = "totp" | "recovery";

/**
 * One form for sign-in verification and re-authentication: an authenticator
 * code by default, or a recovery code. The method is a radio group so the
 * choice is announced and keyboard-reachable.
 */
export function VerifySecondFactorForm({
  next,
  submitLabel = "Continue",
}: {
  next: string;
  submitLabel?: string;
}) {
  const [state, action] = useActionState(
    verifySecondFactorAction,
    idleFormState,
  );
  const [method, setMethod] = useState<Method>("totp");
  const groupId = useId();
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className={formStyles.form} noValidate>
      <input type="hidden" name="next" value={next} />
      <FormStatus state={state} />
      <fieldset className={styles.methods}>
        <legend className={styles.legend}>How do you want to confirm?</legend>
        <label className={styles.method} htmlFor={`${groupId}-totp`}>
          <input
            id={`${groupId}-totp`}
            type="radio"
            name="method"
            value="totp"
            checked={method === "totp"}
            onChange={() => setMethod("totp")}
          />
          Code from your authenticator app
        </label>
        <label className={styles.method} htmlFor={`${groupId}-recovery`}>
          <input
            id={`${groupId}-recovery`}
            type="radio"
            name="method"
            value="recovery"
            checked={method === "recovery"}
            onChange={() => setMethod("recovery")}
          />
          A recovery code
        </label>
      </fieldset>
      {method === "totp" ? (
        <Field
          key="totp"
          id={`${groupId}-code`}
          name="code"
          label="Six-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={7}
          required
          error={errors.code}
        />
      ) : (
        <Field
          key="recovery"
          id={`${groupId}-code`}
          name="code"
          label="Recovery code"
          hint="Each recovery code works once. You will get an email when one is used."
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          required
          error={errors.code}
        />
      )}
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Checking…">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
