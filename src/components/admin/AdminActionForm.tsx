"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";

import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import type { ButtonVariant } from "@/components/ui/Button";
import type { FormState } from "@/features/auth/schemas";
import { idleFormState } from "@/features/auth/schemas";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * One admin operation as a form: hidden facts, server-rendered fields as
 * children, a submit button and the outcome announced. The Server Action
 * authorises, validates and audits; this only carries the submission.
 */
export function AdminActionForm({
  action,
  hidden,
  submitLabel,
  pendingLabel = "Working…",
  variant,
  wide = false,
  children,
}: {
  action: Action;
  hidden: Readonly<Record<string, string>>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  wide?: boolean;
  children?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, idleFormState);
  return (
    <form
      action={formAction}
      className={wide ? formStyles.formWide : formStyles.form}
      noValidate
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormStatus state={state} />
      {children}
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel={pendingLabel} variant={variant}>
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
