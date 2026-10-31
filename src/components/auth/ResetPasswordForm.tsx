"use client";

import { useActionState } from "react";

import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { PasswordField } from "@/components/forms/PasswordField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { resetPasswordAction } from "@/features/auth/actions";
import { idleFormState } from "@/features/auth/schemas";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, idleFormState);
  return (
    <form action={action} className={formStyles.form} noValidate>
      <input type="hidden" name="token" value={token} />
      <FormStatus state={state} />
      <PasswordField
        id="reset-password"
        name="password"
        label="New password"
        autoComplete="new-password"
        hint="At least 10 characters. Other devices will be signed out."
        required
        error={state.fieldErrors?.password}
      />
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Saving…">Save new password</SubmitButton>
      </div>
    </form>
  );
}
