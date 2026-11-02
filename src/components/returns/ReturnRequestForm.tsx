"use client";

import { useActionState, useState } from "react";

import { FormStatus } from "@/components/forms/FormStatus";
import { SelectField } from "@/components/forms/SelectField";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { TextareaField } from "@/components/forms/TextareaField";
import formStyles from "@/components/forms/Form.module.css";
import { idleFormState } from "@/features/auth/schemas";
import { submitReturnRequestAction } from "@/features/returns/actions";
import {
  returnReasonLabels,
  returnResolutionLabels,
} from "@/features/returns/types";
import type { ReturnLineOption } from "@/features/returns/types";
import type { ReturnReason } from "@/generated/prisma/enums";

import { EvidenceUploader } from "./EvidenceUploader";
import styles from "./Returns.module.css";

/**
 * The return request form (docs/phase-8-returns-custom-artwork.md §11.1):
 * tick the lines to return, choose how many and why, and add photographs
 * where the reason needs them. Everything is re-validated on the server;
 * this only keeps the form honest about what can be chosen.
 */
export function ReturnRequestForm({
  orderNumber,
  operationKey,
  lines,
  evidenceRequiredForReasons,
  uploadsAvailable,
  maxEvidence,
}: {
  orderNumber: string;
  operationKey: string;
  lines: readonly ReturnLineOption[];
  evidenceRequiredForReasons: readonly ReturnReason[];
  uploadsAvailable: boolean;
  maxEvidence: number;
}) {
  const [state, formAction] = useActionState(
    submitReturnRequestAction,
    idleFormState,
  );
  const [reasons, setReasons] = useState<Record<string, ReturnReason>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [evidenceCount, setEvidenceCount] = useState(0);
  const needsEvidence = lines.some(
    (line) =>
      included[line.orderItemId] &&
      evidenceRequiredForReasons.includes(
        reasons[line.orderItemId] ?? line.reasons[0] ?? "OTHER",
      ),
  );
  const eligible = lines.filter((line) => line.ineligible === null);

  return (
    <form action={formAction} className={formStyles.formWide} noValidate>
      <input type="hidden" name="orderNumber" value={orderNumber} />
      <input type="hidden" name="operationKey" value={operationKey} />
      <FormStatus state={state} />
      <ul className={styles.lines}>
        {eligible.map((line) => {
          const prefix = `line:${line.orderItemId}`;
          const isIncluded = included[line.orderItemId] ?? false;
          const reason = reasons[line.orderItemId] ?? line.reasons[0];
          const lineError = state.fieldErrors?.[prefix];
          const allowedReasons = line.reasons.filter(
            (candidate) =>
              uploadsAvailable ||
              !evidenceRequiredForReasons.includes(candidate),
          );
          return (
            <li key={line.orderItemId} className={styles.line}>
              <div className={styles.lineHead}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    name={`${prefix}:include`}
                    value="1"
                    checked={isIncluded}
                    onChange={(event) =>
                      setIncluded((current) => ({
                        ...current,
                        [line.orderItemId]: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    {line.productTitle}
                    {line.variantTitle ? ` · ${line.variantTitle}` : ""}
                  </span>
                </label>
                <span className={styles.muted}>
                  {line.availableQty} of {line.orderedQty} can be returned
                </span>
              </div>
              {lineError ? (
                <p role="alert" className={styles.notice}>
                  {lineError}
                </p>
              ) : null}
              {isIncluded ? (
                <div className={styles.fields}>
                  <SelectField
                    id={`${prefix}-quantity`}
                    name={`${prefix}:quantity`}
                    label="How many"
                    options={Array.from(
                      { length: line.availableQty },
                      (_, i) => ({
                        value: String(i + 1),
                        label: String(i + 1),
                      }),
                    )}
                    defaultValue="1"
                    required
                  />
                  <SelectField
                    id={`${prefix}-reason`}
                    name={`${prefix}:reason`}
                    label="Reason"
                    options={allowedReasons.map((candidate) => ({
                      value: candidate,
                      label: returnReasonLabels[candidate],
                    }))}
                    value={reason}
                    onChange={(event) =>
                      setReasons((current) => ({
                        ...current,
                        [line.orderItemId]: event.target.value as ReturnReason,
                      }))
                    }
                    hint={
                      reason && evidenceRequiredForReasons.includes(reason)
                        ? "This reason needs at least one photograph."
                        : undefined
                    }
                    required
                  />
                  <TextareaField
                    id={`${prefix}-description`}
                    name={`${prefix}:description`}
                    label="Tell us more (optional)"
                    maxLength={1000}
                    className={styles.full}
                  />
                  {line.exchangeOptions.length > 0 ? (
                    <>
                      <SelectField
                        id={`${prefix}-resolution`}
                        name={`${prefix}:resolution`}
                        label="What would you like"
                        options={[
                          {
                            value: "REFUND",
                            label: returnResolutionLabels.REFUND,
                          },
                          {
                            value: "EXCHANGE",
                            label: returnResolutionLabels.EXCHANGE,
                          },
                        ]}
                        value={resolutions[line.orderItemId] ?? "REFUND"}
                        onChange={(event) =>
                          setResolutions((current) => ({
                            ...current,
                            [line.orderItemId]: event.target.value,
                          }))
                        }
                      />
                      {(resolutions[line.orderItemId] ?? "REFUND") ===
                      "EXCHANGE" ? (
                        <SelectField
                          id={`${prefix}-exchange`}
                          name={`${prefix}:exchangeVariantId`}
                          label="Replacement"
                          hint="Stock is confirmed when your parcel is inspected."
                          options={line.exchangeOptions.map((option) => ({
                            value: option.variantId,
                            label: option.label,
                          }))}
                          required
                        />
                      ) : null}
                    </>
                  ) : (
                    <input
                      type="hidden"
                      name={`${prefix}:resolution`}
                      value="REFUND"
                    />
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <EvidenceUploader
        max={maxEvidence}
        available={uploadsAvailable}
        onCountChange={setEvidenceCount}
      />
      {needsEvidence && evidenceCount === 0 ? (
        <p className={styles.notice} role="status">
          Add at least one photograph for the reason you chose before sending
          the request.
        </p>
      ) : null}
      <label className={styles.checkbox} htmlFor="return-consent">
        <input
          id="return-consent"
          name="consent"
          type="checkbox"
          value="1"
          required
        />
        <span>
          I have read the return instructions and will send the items only once
          approved
        </span>
      </label>
      <div className={formStyles.actions}>
        <SubmitButton pendingLabel="Sending…">
          Send the return request
        </SubmitButton>
      </div>
    </form>
  );
}
