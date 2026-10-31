"use client";

import { useActionState } from "react";

import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { resendVerificationAction } from "@/features/auth/actions";
import { idleFormState } from "@/features/auth/schemas";

import styles from "./AccountShell.module.css";

export function ResendVerification({ email }: { email: string }) {
  const [state, action] = useActionState(
    () => resendVerificationAction(),
    idleFormState,
  );
  return (
    <div className={styles.notice}>
      <p>
        <strong>Confirm your email address.</strong> We sent a link to {email}.
        Confirming it lets us send order updates to the right place.
      </p>
      <form action={action}>
        <FormStatus state={state} />
        {state.status !== "success" ? (
          <SubmitButton variant="secondary" pendingLabel="Sending…">
            Send the link again
          </SubmitButton>
        ) : null}
      </form>
    </div>
  );
}
