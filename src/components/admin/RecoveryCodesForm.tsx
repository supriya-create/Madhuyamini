"use client";

import { useActionState } from "react";

import { Field } from "@/components/forms/Field";
import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { regenerateRecoveryCodesAction } from "@/features/admin/security/actions";
import type { TwoFactorFormState } from "@/features/admin/security/actions";
import { formatRecoveryCode } from "@/lib/recovery-code";

import styles from "./TwoFactor.module.css";

const idle: TwoFactorFormState = { status: "idle" };

/** Replaces the recovery codes on a fresh authenticator code; the new set is shown once. */
export function RecoveryCodesForm() {
  const [state, action] = useActionState(regenerateRecoveryCodesAction, idle);
  if (state.status === "success" && state.recoveryCodes) {
    return (
      <div className={styles.done}>
        <FormStatus state={state} />
        <ol className={styles.codes} aria-label="Recovery codes">
          {state.recoveryCodes.map((code) => (
            <li key={code}>
              <code className={styles.code}>{formatRecoveryCode(code)}</code>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <form action={action} className={formStyles.form} noValidate>
      <FormStatus state={state} />
      <Field
        id="regen-code"
        name="code"
        label="Six-digit code from the app"
        hint="The old codes stop working the moment new ones are issued."
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={7}
        required
        error={state.fieldErrors?.code}
      />
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Checking…" variant="secondary">
          Issue new recovery codes
        </SubmitButton>
      </div>
    </form>
  );
}
