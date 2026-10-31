"use client";

import { useActionState } from "react";

import { Field } from "@/components/forms/Field";
import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { updateProfileAction } from "@/features/account/actions";
import { idleFormState } from "@/features/auth/schemas";

type ProfileFormProps = { name: string; phone: string | null; email: string };

export function ProfileForm({ name, phone, email }: ProfileFormProps) {
  const [state, action] = useActionState(updateProfileAction, idleFormState);
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className={formStyles.form} noValidate>
      <FormStatus state={state} />
      <Field
        id="profile-name"
        name="name"
        label="Your name"
        autoComplete="name"
        defaultValue={name}
        required
        error={errors.name}
      />
      <Field
        id="profile-email"
        name="email-readonly"
        label="Email address"
        type="email"
        defaultValue={email}
        readOnly
        hint="Changing your email address is coming later; contact us if it is urgent."
      />
      <Field
        id="profile-phone"
        name="phone"
        label="Phone number"
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        defaultValue={phone ?? ""}
        hint="With country code. Used for delivery updates."
        error={errors.phone}
      />
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
      </div>
    </form>
  );
}
