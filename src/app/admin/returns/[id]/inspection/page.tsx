import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { TextareaField } from "@/components/forms/TextareaField";
import { ButtonLink } from "@/components/ui/Button";
import { inspectReturnAction } from "@/features/admin/returns/actions";
import {
  RETURN_CONDITIONS,
  returnIdSchema,
} from "@/features/admin/returns/schemas";
import { getReturnDetail } from "@/features/admin/returns/service";
import { returnConditionLabels } from "@/features/returns/types";
import { requireStaffSession } from "@/server/auth/staff";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Inspect a return" };

/** Per-unit decisions for a received return (docs/phase-8-returns-custom-artwork.md §3.3 R9). */
export default async function ReturnInspectionPage({
  params,
}: PageProps<"/admin/returns/[id]/inspection">) {
  const ctx = await requireStaffSession();
  const { id } = await params;
  const parsedId = returnIdSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const item = await getReturnDetail(ctx, parsedId.data);
  if (!item) notFound();
  if (!item.actions.inspect) redirect(routes.adminReturn(item.id));
  return (
    <div>
      <AdminPageHeader
        title={`Inspect return ${item.requestNumber}`}
        lede="For each line, record the condition and how many received units go back to stock, to repair, to quarantine, are written off, or go back to the customer. The five must add up to the units received. Only units sent back to stock become available; nothing is refunded here."
      />
      <AdminActionForm
        action={inspectReturnAction}
        hidden={{ returnId: item.id }}
        submitLabel="Record the inspection"
        pendingLabel="Recording…"
        wide
      >
        {item.items.map((line) => {
          const received = line.receivedQty ?? 0;
          return (
            <div key={line.id} className={styles.lineGrid}>
              <div className={styles.lineHead} style={{ gridColumn: "1 / -1" }}>
                <strong>
                  {line.productTitle}
                  {line.variantTitle ? ` · ${line.variantTitle}` : ""}
                </strong>
                <span className={styles.muted}>
                  {line.sku} · {received} received · {line.reasonLabel}
                </span>
              </div>
              <SelectField
                id={`condition-${line.id}`}
                name={`condition:${line.id}`}
                label="Condition"
                options={RETURN_CONDITIONS.map((condition) => ({
                  value: condition,
                  label: returnConditionLabels[condition],
                }))}
                defaultValue={received === 0 ? "NOT_RECEIVED" : "AS_NEW"}
                required
              />
              <Field
                id={`restock-${line.id}`}
                name={`restock:${line.id}`}
                label="Back to stock"
                type="number"
                inputMode="numeric"
                min={0}
                max={received}
                defaultValue={received}
                required
              />
              <Field
                id={`repair-${line.id}`}
                name={`repair:${line.id}`}
                label="To repair"
                type="number"
                inputMode="numeric"
                min={0}
                max={received}
                defaultValue={0}
                required
              />
              <Field
                id={`quarantine-${line.id}`}
                name={`quarantine:${line.id}`}
                label="Quarantine"
                type="number"
                inputMode="numeric"
                min={0}
                max={received}
                defaultValue={0}
                required
              />
              <Field
                id={`writeoff-${line.id}`}
                name={`writeoff:${line.id}`}
                label="Written off"
                type="number"
                inputMode="numeric"
                min={0}
                max={received}
                defaultValue={0}
                required
              />
              <Field
                id={`tocustomer-${line.id}`}
                name={`tocustomer:${line.id}`}
                label="Back to customer"
                type="number"
                inputMode="numeric"
                min={0}
                max={received}
                defaultValue={0}
                required
              />
              <TextareaField
                id={`itemnote-${line.id}`}
                name={`itemnote:${line.id}`}
                label="Note for this line (optional)"
                maxLength={1000}
                rows={2}
              />
            </div>
          );
        })}
        <TextareaField
          id="inspection-note"
          name="note"
          label="Inspection note"
          hint="Condition of the goods and why any unit was not accepted."
          required
          maxLength={500}
        />
      </AdminActionForm>
      <p className={styles.muted}>
        <ButtonLink href={routes.adminReturn(item.id)} variant="quiet">
          Back to the return
        </ButtonLink>
      </p>
    </div>
  );
}
