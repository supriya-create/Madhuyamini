"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Field } from "@/components/forms/Field";
import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { PasswordField } from "@/components/forms/PasswordField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { ButtonLink } from "@/components/ui/Button";
import { registerAction } from "@/features/auth/actions";
import { idleFormState } from "@/features/auth/schemas";
import { routes } from "@/lib/routes";

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, idleFormState);

  if (state.status === "success") {
    return (
      <div className={formStyles.form}>
        <FormStatus state={state} />
        <div className={formStyles.actions}>
          <ButtonLink href={routes.login}>Sign in</ButtonLink>
        </div>
      </div>
    );
  }

  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className={formStyles.form} noValidate>
      <FormStatus state={state} />
      <Field
        id="register-name"
        name="name"
        label="Your name"
        autoComplete="name"
        required
        error={errors.name}
      />
      <Field
        id="register-email"
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        error={errors.email}
      />
      <Field
        id="register-phone"
        name="phone"
        label="Phone number (optional)"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        hint="With country code, for delivery updates later. You can add it at checkout instead."
        error={errors.phone}
      />
      <PasswordField
        id="register-password"
        name="password"
        label="Password"
        autoComplete="new-password"
        hint="At least 10 characters. A few words you will remember work well; no symbols required."
        required
        error={errors.password}
      />
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Creating your account…">
          Create account
        </SubmitButton>
      </div>
      <p className={formStyles.footnote}>
        Already have an account? <Link href={routes.login}>Sign in</Link>.
      </p>
    </form>
  );
}
