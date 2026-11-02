import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { Field } from "@/components/forms/Field";
import { TextareaField } from "@/components/forms/TextareaField";
import { ButtonLink } from "@/components/ui/Button";
import {
  approveReturnAction,
  receiveReturnAction,
  recordStaffShipmentAction,
  rejectReturnAction,
  requestInfoAction,
} from "@/features/admin/returns/actions";
import type { AdminReturnDetail } from "@/features/admin/returns/types";
import { routes } from "@/lib/routes";

/** The operations allowed in the request's current state, as disclosures. */
export function ReturnActions({ item }: { item: AdminReturnDetail }) {
  const hidden = { returnId: item.id };
  const groups: Array<{
    title: string;
    danger?: boolean;
    body: React.ReactNode;
  }> = [];

  if (item.actions.requestInfo) {
    groups.push({
      title: "Ask the customer a question",
      body: (
        <AdminActionForm
          action={requestInfoAction}
          hidden={hidden}
          submitLabel="Send the question"
        >
          <TextareaField
            id="info-message"
            name="message"
            label="Question"
            hint="The customer is emailed and the decision clock pauses until they reply."
            required
            maxLength={2000}
          />
        </AdminActionForm>
      ),
    });
  }
  if (item.actions.approve) {
    groups.push({
      title: "Approve",
      body: (
        <AdminActionForm
          action={approveReturnAction}
          hidden={hidden}
          submitLabel="Approve and send instructions"
          wide
        >
          {item.items.map((line) => (
            <Field
              key={line.id}
              id={`approved-${line.id}`}
              name={`approved:${line.id}`}
              label={`${line.productTitle}${line.variantTitle ? ` · ${line.variantTitle}` : ""}: units approved (of ${line.requestedQty} requested)`}
              type="number"
              inputMode="numeric"
              min={0}
              max={line.requestedQty}
              defaultValue={line.requestedQty}
              required
            />
          ))}
          <TextareaField
            id="approve-instructions"
            name="instructions"
            label="Return instructions for the customer"
            hint="Where to send the parcel and how. Sent in the approval email and shown on the return page. Who pays follows the reason: the shop for damage, wrong or misdescribed items, the customer otherwise."
            required
            maxLength={2000}
            rows={5}
          />
          <TextareaField
            id="approve-note"
            name="note"
            label="Internal note (optional)"
            maxLength={1000}
          />
        </AdminActionForm>
      ),
    });
  }
  if (item.actions.reject) {
    groups.push({
      title: "Decline",
      danger: true,
      body: (
        <AdminActionForm
          action={rejectReturnAction}
          hidden={hidden}
          submitLabel="Decline the return"
          variant="secondary"
        >
          <TextareaField
            id="reject-reason"
            name="reason"
            label="Reason (sent to the customer)"
            required
            maxLength={500}
          />
        </AdminActionForm>
      ),
    });
  }
  if (item.actions.recordShipment) {
    groups.push({
      title: "Customer has sent the parcel",
      body: (
        <AdminActionForm
          action={recordStaffShipmentAction}
          hidden={hidden}
          submitLabel="Record the parcel"
        >
          <Field
            id="ship-carrier"
            name="carrier"
            label="Carrier"
            required
            maxLength={80}
          />
          <Field
            id="ship-tracking"
            name="trackingNumber"
            label="Tracking number (optional)"
            maxLength={80}
          />
          <Field
            id="ship-url"
            name="trackingUrl"
            label="Tracking link (optional, https://)"
            type="url"
            maxLength={500}
          />
        </AdminActionForm>
      ),
    });
  }
  if (item.actions.receive) {
    groups.push({
      title: "Parcel received",
      body: (
        <AdminActionForm
          action={receiveReturnAction}
          hidden={hidden}
          submitLabel="Record what arrived"
          wide
        >
          {item.items.map((line) => (
            <Field
              key={line.id}
              id={`received-${line.id}`}
              name={`received:${line.id}`}
              label={`${line.productTitle}${line.variantTitle ? ` · ${line.variantTitle}` : ""}: units received (of ${line.approvedQty ?? 0} approved)`}
              type="number"
              inputMode="numeric"
              min={0}
              max={line.approvedQty ?? 0}
              defaultValue={line.approvedQty ?? 0}
              required
            />
          ))}
          <TextareaField
            id="receive-note"
            name="note"
            label="Condition of the parcel on arrival"
            required
            maxLength={500}
          />
          <p className={styles.muted}>
            Stock does not move yet; inspect the units next.
          </p>
        </AdminActionForm>
      ),
    });
  }
  if (item.actions.inspect) {
    groups.push({
      title: "Inspect the units",
      body: (
        <p>
          <ButtonLink href={routes.adminReturnInspection(item.id)}>
            Open the inspection form
          </ButtonLink>
        </p>
      ),
    });
  }

  return (
    <section className={styles.panel} aria-labelledby="return-actions">
      <h2 id="return-actions" className={styles.panelTitle}>
        Actions
      </h2>
      {groups.length === 0 ? (
        <p className={styles.muted}>Nothing to do in this state.</p>
      ) : (
        <div className={styles.actionGroup}>
          {groups.map((group) => (
            <details
              key={group.title}
              className={styles.details}
              data-danger={group.danger ? "true" : undefined}
            >
              <summary>{group.title}</summary>
              <div>{group.body}</div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
