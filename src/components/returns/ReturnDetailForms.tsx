"use client";

import { useActionState } from "react";

import { Field } from "@/components/forms/Field";
import { FormStatus } from "@/components/forms/FormStatus";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { TextareaField } from "@/components/forms/TextareaField";
import formStyles from "@/components/forms/Form.module.css";
import { idleFormState } from "@/features/auth/schemas";
import {
  addReturnEvidenceAction,
  recordReturnShipmentAction,
  replyToReturnAction,
  withdrawReturnAction,
} from "@/features/returns/actions";

import { EvidenceUploader } from "./EvidenceUploader";
import styles from "./Returns.module.css";

export function ReplyForm({ requestNumber }: { requestNumber: string }) {
  const [state, formAction] = useActionState(
    replyToReturnAction,
    idleFormState,
  );
  return (
    <form action={formAction} className={formStyles.form} noValidate>
      <input type="hidden" name="requestNumber" value={requestNumber} />
      <FormStatus state={state} />
      <TextareaField
        id="reply-body"
        name="body"
        label="Your message"
        required
        maxLength={2000}
        error={state.fieldErrors?.body}
      />
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Sending…" variant="secondary">
          Send message
        </SubmitButton>
      </div>
    </form>
  );
}

export function ShipmentForm({ requestNumber }: { requestNumber: string }) {
  const [state, formAction] = useActionState(
    recordReturnShipmentAction,
    idleFormState,
  );
  return (
    <form action={formAction} className={formStyles.form} noValidate>
      <input type="hidden" name="requestNumber" value={requestNumber} />
      <FormStatus state={state} />
      <Field
        id="ship-carrier"
        name="carrier"
        label="Carrier"
        required
        maxLength={80}
        error={state.fieldErrors?.carrier}
      />
      <Field
        id="ship-tracking"
        name="trackingNumber"
        label="Tracking number (optional)"
        maxLength={80}
        error={state.fieldErrors?.trackingNumber}
      />
      <Field
        id="ship-url"
        name="trackingUrl"
        label="Tracking link (optional, https://)"
        type="url"
        maxLength={500}
        error={state.fieldErrors?.trackingUrl}
      />
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Saving…">
          I have sent the parcel
        </SubmitButton>
      </div>
    </form>
  );
}

export function WithdrawForm({ requestNumber }: { requestNumber: string }) {
  const [state, formAction] = useActionState(
    withdrawReturnAction,
    idleFormState,
  );
  return (
    <form action={formAction} className={formStyles.form} noValidate>
      <input type="hidden" name="requestNumber" value={requestNumber} />
      <FormStatus state={state} />
      <p className={styles.muted}>
        Withdrawing closes this request. You can start a new one while the
        return window is open.
      </p>
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Withdrawing…" variant="quiet">
          Withdraw the request
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddEvidenceForm({
  requestNumber,
  existingCount,
  max,
  available,
}: {
  requestNumber: string;
  existingCount: number;
  max: number;
  available: boolean;
}) {
  const [state, formAction] = useActionState(
    addReturnEvidenceAction,
    idleFormState,
  );
  return (
    <form action={formAction} className={formStyles.form} noValidate>
      <input type="hidden" name="requestNumber" value={requestNumber} />
      <FormStatus state={state} />
      <EvidenceUploader
        max={max}
        existingCount={existingCount}
        available={available}
      />
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Saving…" variant="secondary">
          Add these photographs
        </SubmitButton>
      </div>
    </form>
  );
}
