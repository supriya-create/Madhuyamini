"use client";

import { useActionState } from "react";

import { Field } from "@/components/forms/Field";
import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { ButtonLink } from "@/components/ui/Button";
import { confirmEnrolmentAction } from "@/features/admin/security/actions";
import type { TwoFactorFormState } from "@/features/admin/security/actions";
import { formatRecoveryCode } from "@/lib/recovery-code";

import styles from "./TwoFactor.module.css";

const idle: TwoFactorFormState = { status: "idle" };

function groupKey(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Shows the setup key and confirms the enrolment with the first code the
 * app produces. On success the recovery codes are shown once, in place of
 * the key and the form, so the key never lingers on screen.
 */
export function TwoFactorEnrolForm({
  next,
  secretBase32,
  uri,
}: {
  next: string;
  secretBase32: string;
  uri: string;
}) {
  const [state, action] = useActionState(confirmEnrolmentAction, idle);
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
        <p className={styles.hint}>
          Keep them somewhere safe and private. Each works once, and they are
          the only way in if you lose your authenticator app.
        </p>
        <ButtonLink href={next}>I have saved my recovery codes</ButtonLink>
      </div>
    );
  }
  return (
    <>
      <h2 className={styles.stepTitle}>
        1. Add Madhuyamini to your authenticator app
      </h2>
      <div className={styles.setup}>
        <p>
          In your authenticator app (for example Aegis, Google Authenticator,
          1Password or Authy) choose to enter a setup key, name it Madhuyamini
          and paste this key:
        </p>
        <p>
          <code className={styles.key} aria-label="Setup key">
            {groupKey(secretBase32)}
          </code>
        </p>
        <p>
          On this device, you can instead{" "}
          <a href={uri}>open the key in your authenticator app</a>.
        </p>
        <p className={styles.hint}>
          The key is shown only now. This setup expires in a few minutes if it
          is not confirmed; start again to get a new key.
        </p>
      </div>
      <h2 className={styles.stepTitle}>2. Enter the first code it shows</h2>
      <form action={action} className={formStyles.form} noValidate>
        <input type="hidden" name="next" value={next} />
        <FormStatus state={state} />
        <Field
          id="enrol-code"
          name="code"
          label="Six-digit code from the app"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={7}
          required
          error={state.fieldErrors?.code}
        />
        <div className={formStyles.actions}>
          <SubmitButton pendingLabel="Checking…">
            Turn on two-factor sign-in
          </SubmitButton>
        </div>
      </form>
    </>
  );
}
