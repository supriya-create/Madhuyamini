"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Field } from "@/components/forms/Field";
import { FormStatus } from "@/components/forms/FormStatus";
import { PasswordField } from "@/components/forms/PasswordField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { signInAction } from "@/features/auth/actions";
import { idleFormState } from "@/features/auth/schemas";
import type { FormState } from "@/features/auth/schemas";
import {
  hasSignInErrors,
  validateSignInInput,
} from "@/features/auth/sign-in-validation";
import type { SignInFieldErrors } from "@/features/auth/sign-in-validation";
import { routes } from "@/lib/routes";

import styles from "./SignInForm.module.css";

const EMAIL_ID = "sign-in-email";
const PASSWORD_ID = "sign-in-password";

/** Summary shown above the fields when the browser-side check fails. */
const CHECK_FIELDS: FormState = {
  status: "error",
  message: "Please check the highlighted fields.",
};

/**
 * Marks the fields busy while the Server Action runs. `useFormStatus` reads
 * the enclosing form, so this must render inside it.
 */
function Fields({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <div className={styles.fields} data-pending={pending} aria-busy={pending}>
      {children}
    </div>
  );
}

/**
 * Email and password sign-in. Validation runs twice: here, before anything is
 * sent, so an empty or malformed entry is pointed out beside its field; and
 * again in `signInAction`, which keeps the enumeration-safe generic reply.
 * Without JavaScript the form still posts and the server answer is shown.
 */
export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signInAction, idleFormState);
  const [clientErrors, setClientErrors] = useState<SignInFieldErrors>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const data = new FormData(form);
    const errors = validateSignInInput({
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
    });
    if (!hasSignInErrors(errors)) {
      setClientErrors({});
      return;
    }
    // A failed check never reaches the action; the first problem gets focus.
    event.preventDefault();
    setClientErrors(errors);
    const firstInvalid = errors.email ? EMAIL_ID : PASSWORD_ID;
    form.querySelector<HTMLInputElement>(`#${firstInvalid}`)?.focus();
  }

  const clearError = (field: keyof SignInFieldErrors) => () => {
    setClientErrors((current) =>
      current[field] === undefined
        ? current
        : { ...current, [field]: undefined },
    );
  };

  const showingClientErrors = hasSignInErrors(clientErrors);

  return (
    <form
      action={action}
      onSubmit={handleSubmit}
      className={styles.form}
      noValidate
    >
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormStatus state={showingClientErrors ? CHECK_FIELDS : state} />
      <Fields>
        <Field
          id={EMAIL_ID}
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          required
          error={clientErrors.email}
          onInput={clearError("email")}
        />
        <PasswordField
          id={PASSWORD_ID}
          name="password"
          label="Password"
          autoComplete="current-password"
          enterKeyHint="go"
          variant="inset"
          required
          error={clientErrors.password}
          onInput={clearError("password")}
        />
      </Fields>
      <div className={styles.actions}>
        <div className={styles.submit}>
          <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
        </div>
        <Link href={routes.forgotPassword} className={styles.secondaryLink}>
          Forgotten your password?
        </Link>
      </div>
      <p className={styles.footnote}>
        New to Madhuyamini?{" "}
        <Link href={routes.register}>Create an account</Link>
      </p>
    </form>
  );
}
