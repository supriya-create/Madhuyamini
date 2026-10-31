"use client";

import { useActionState } from "react";

import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { PasswordField } from "@/components/forms/PasswordField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { changePasswordAction } from "@/features/account/actions";
import { idleFormState } from "@/features/auth/schemas";

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, idleFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form
      action={action}
      className={formStyles.form}
      noValidate
      key={state.status === "success" ? "done" : "form"}
    >
      <FormStatus state={state} />
      <PasswordField
        id="current-password"
        name="currentPassword"
        label="Current password"
        autoComplete="current-password"
        required
        error={errors.currentPassword}
      />
      <PasswordField
        id="new-password"
        name="newPassword"
        label="New password"
        autoComplete="new-password"
        hint="At least 10 characters. Other devices will be signed out."
        required
        error={errors.newPassword}
      />
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Changing…">Change password</SubmitButton>
      </div>
    </form>
  );
}
