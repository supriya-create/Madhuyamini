"use client";

import { useActionState } from "react";

import { Field } from "@/components/forms/Field";
import fieldStyles from "@/components/forms/Field.module.css";
import formStyles from "@/components/forms/Form.module.css";
import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { ButtonLink } from "@/components/ui/Button";
import {
  addAddressAction,
  editAddressAction,
} from "@/features/account/actions";
import type { AddressRow } from "@/features/account/data";
import { idleFormState } from "@/features/auth/schemas";
import { routes } from "@/lib/routes";

type AddressFormProps = { address?: AddressRow };

export function AddressForm({ address }: AddressFormProps) {
  const [state, action] = useActionState(
    address ? editAddressAction : addAddressAction,
    idleFormState,
  );
  const errors = state.fieldErrors ?? {};
  return (
    <form action={action} className={formStyles.formWide} noValidate>
      {address ? <input type="hidden" name="id" value={address.id} /> : null}
      <FormStatus state={state} />
      <Field
        id="address-label"
        name="label"
        label="Label (optional)"
        placeholder="Home, Office…"
        defaultValue={address?.label ?? ""}
        error={errors.label}
      />
      <div className={formStyles.row}>
        <Field
          id="address-recipient"
          name="recipientName"
          label="Recipient’s name"
          autoComplete="shipping name"
          defaultValue={address?.recipientName ?? ""}
          required
          error={errors.recipientName}
        />
        <Field
          id="address-phone"
          name="phone"
          label="Phone number"
          type="tel"
          autoComplete="shipping tel"
          inputMode="tel"
          defaultValue={address?.phone ?? ""}
          required
          error={errors.phone}
        />
      </div>
      <Field
        id="address-line1"
        name="line1"
        label="Address"
        autoComplete="shipping address-line1"
        defaultValue={address?.line1 ?? ""}
        required
        error={errors.line1}
      />
      <Field
        id="address-line2"
        name="line2"
        label="Address line 2 (optional)"
        autoComplete="shipping address-line2"
        defaultValue={address?.line2 ?? ""}
        error={errors.line2}
      />
      <Field
        id="address-landmark"
        name="landmark"
        label="Landmark (optional)"
        defaultValue={address?.landmark ?? ""}
        error={errors.landmark}
      />
      <div className={formStyles.row}>
        <Field
          id="address-city"
          name="city"
          label="City"
          autoComplete="shipping address-level2"
          defaultValue={address?.city ?? ""}
          required
          error={errors.city}
        />
        <Field
          id="address-state"
          name="state"
          label="State"
          autoComplete="shipping address-level1"
          defaultValue={address?.state ?? ""}
          required
          error={errors.state}
        />
      </div>
      <Field
        id="address-postal"
        name="postalCode"
        label="PIN code"
        autoComplete="shipping postal-code"
        inputMode="numeric"
        defaultValue={address?.postalCode ?? ""}
        required
        error={errors.postalCode}
      />
      <label className={fieldStyles.checkbox}>
        <input
          type="checkbox"
          name="isDefault"
          defaultChecked={address?.isDefault ?? false}
        />
        <span>Use as my default address</span>
      </label>
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Saving…">
          {address ? "Save changes" : "Add address"}
        </SubmitButton>
        <ButtonLink href={routes.accountAddresses} variant="quiet">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
