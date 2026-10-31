"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Field } from "@/components/forms/Field";
import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { PasswordField } from "@/components/forms/PasswordField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { signInAction } from "@/features/auth/actions";
import { idleFormState } from "@/features/auth/schemas";
import { routes } from "@/lib/routes";

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signInAction, idleFormState);
  return (
    <form action={action} className={formStyles.form} noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormStatus state={state} />
      <Field
        id="sign-in-email"
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
      />
      <PasswordField
        id="sign-in-password"
        name="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
        <Link href={routes.forgotPassword}>Forgotten your password?</Link>
      </div>
      <p className={formStyles.footnote}>
        New to Madhuyamini?{" "}
        <Link href={routes.register}>Create an account</Link>.
      </p>
    </form>
  );
}
