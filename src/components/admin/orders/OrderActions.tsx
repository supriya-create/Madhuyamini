import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { TextareaField } from "@/components/forms/TextareaField";
import { ButtonLink } from "@/components/ui/Button";
import {
  acceptMismatchAction,
  attachPaymentAction,
  createRefundAction,
  recheckWithProviderAction,
} from "@/features/admin/payments/actions";
import {
  addStaffNoteAction,
  collectCodAction,
  confirmCarrierLossAction,
  markDeliveredAction,
  markDeliveryFailedAction,
  markParcelReturnedAction,
  reverseCodCollectionAction,
  shipOrderAction,
  startProcessingAction,
} from "@/features/admin/orders/actions";
import type { AdminOrderDetail } from "@/features/admin/orders/types";
import {
  DELIVERY_FAILURE_REASONS,
  deliveryFailureLabels,
} from "@/features/admin/orders/types";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

/**
 * The operations allowed in the order's current state (docs/admin.md §5.4,
 * §5.10, §5.11). Each form posts to a Server Action that re-checks the
 * state under the order lock; this component only decides what to offer.
 */
export function OrderActions({ order }: { order: AdminOrderDetail }) {
  const { actions } = order;
  const hidden = { orderId: order.id };
  const groups: Array<{
    title: string;
    danger?: boolean;
    body: React.ReactNode;
  }> = [];

  if (actions.startProcessing) {
    groups.push({
      title: "Start processing",
      body: (
        <AdminActionForm
          action={startProcessingAction}
          hidden={hidden}
          submitLabel="Mark as being prepared"
        >
          <p className={styles.muted}>
            Tells the customer nothing yet; marks the order as being packed.
          </p>
        </AdminActionForm>
      ),
    });
  }
  if (actions.ship) {
    groups.push({
      title: "Ship",
      body: (
        <AdminActionForm
          action={shipOrderAction}
          hidden={hidden}
          submitLabel="Record shipment"
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
            label="Tracking link (optional, https)"
            type="url"
            inputMode="url"
            maxLength={500}
          />
          <p className={styles.muted}>
            The customer receives a shipping email.
          </p>
        </AdminActionForm>
      ),
    });
  }
  if (actions.deliver) {
    groups.push({
      title: "Delivered",
      body: (
        <AdminActionForm
          action={markDeliveredAction}
          hidden={hidden}
          submitLabel="Mark as delivered"
        >
          <p className={styles.muted}>
            The customer receives a delivery email.
          </p>
        </AdminActionForm>
      ),
    });
  }
  if (actions.codCollect) {
    groups.push({
      title: "Cash collected",
      body: (
        <AdminActionForm
          action={collectCodAction}
          hidden={hidden}
          submitLabel="Record cash collected"
        >
          <Field
            id="cod-amount"
            name="amount"
            label="Amount collected (₹)"
            hint={`Must equal the order total, ${formatINR(order.totals.totalInPaise)}.`}
            inputMode="decimal"
            required
          />
          {actions.codCollect === "handover" ? (
            <TextareaField
              id="cod-reason"
              name="reason"
              label="Why before delivery?"
              hint="Cash recorded at handover needs a reason."
              required
            />
          ) : null}
        </AdminActionForm>
      ),
    });
  }
  if (actions.deliveryFailed) {
    groups.push({
      title: "Delivery failed",
      danger: true,
      body: (
        <AdminActionForm
          action={markDeliveryFailedAction}
          hidden={hidden}
          submitLabel="Record delivery failure"
          variant="secondary"
        >
          <SelectField
            id="fail-reason"
            name="reason"
            label="What happened?"
            options={DELIVERY_FAILURE_REASONS.map((value) => ({
              value,
              label: deliveryFailureLabels[value],
            }))}
            required
          />
          <TextareaField
            id="fail-note"
            name="note"
            label="Note (optional)"
            maxLength={1000}
          />
          <p className={styles.muted}>
            Starts the return to origin. Stock is not touched until the parcel
            is back and inspected.
            {order.paymentMethod === "COD"
              ? " The cash-on-delivery payment is recorded as not collected."
              : ""}
          </p>
        </AdminActionForm>
      ),
    });
  }
  if (actions.parcelReturned) {
    groups.push({
      title: "Parcel received back",
      body: (
        <AdminActionForm
          action={markParcelReturnedAction}
          hidden={hidden}
          submitLabel="Record parcel returned"
        >
          <TextareaField
            id="returned-note"
            name="note"
            label="Condition on arrival"
            required
            maxLength={500}
          />
        </AdminActionForm>
      ),
    });
  }
  if (actions.inspection) {
    groups.push({
      title: "Inspect and close",
      body: (
        <div className={styles.actionGroup}>
          <p className={styles.muted}>
            Decide per line what goes back on the shelf and what is written off.
          </p>
          <ButtonLink
            href={routes.adminOrderInspection(order.id)}
            variant="secondary"
          >
            Open the inspection form
          </ButtonLink>
        </div>
      ),
    });
  }
  if (actions.carrierLoss) {
    groups.push({
      title: "Carrier confirmed loss",
      danger: true,
      body: (
        <AdminActionForm
          action={confirmCarrierLossAction}
          hidden={hidden}
          submitLabel="Close as lost in transit"
          variant="secondary"
        >
          <Field
            id="loss-claim"
            name="claimReference"
            label="Carrier claim reference"
            required
            maxLength={120}
          />
          <TextareaField
            id="loss-reason"
            name="reason"
            label="Reason"
            required
            maxLength={500}
          />
          <p className={styles.muted}>
            Admin only, with a fresh second factor. Refunds any captured
            payment.
          </p>
        </AdminActionForm>
      ),
    });
  }
  if (actions.codReverse) {
    groups.push({
      title: "Reverse cash collection",
      danger: true,
      body: (
        <AdminActionForm
          action={reverseCodCollectionAction}
          hidden={hidden}
          submitLabel="Reverse the collection"
          variant="secondary"
        >
          <TextareaField
            id="reverse-reason"
            name="reason"
            label="Reason"
            required
            maxLength={500}
          />
          <p className={styles.muted}>
            Admin only, with a fresh second factor.
          </p>
        </AdminActionForm>
      ),
    });
  }
  if (actions.cancel) {
    groups.push({
      title: "Cancel order",
      danger: true,
      body: (
        <div className={styles.actionGroup}>
          <p className={styles.muted}>
            {actions.cancel === "pending"
              ? "Releases the held stock. Nothing has been charged."
              : "Returns the pieces to stock and refunds any captured payment. Admin only, with a fresh second factor."}
          </p>
          <ButtonLink
            href={routes.adminOrderCancel(order.id)}
            variant="secondary"
          >
            Open the cancellation form
          </ButtonLink>
        </div>
      ),
    });
  }
  if (actions.recheck) {
    groups.push({
      title: "Re-check with the payment provider",
      body: (
        <AdminActionForm
          action={recheckWithProviderAction}
          hidden={hidden}
          submitLabel="Ask the provider again"
        >
          <p className={styles.muted}>
            Asks Razorpay what happened to each open or failed attempt and
            applies the answer. The usual fix for &ldquo;paid but stuck&rdquo;.
          </p>
        </AdminActionForm>
      ),
    });
  }
  if (actions.attachPayment) {
    groups.push({
      title: "Attach a provider payment",
      danger: true,
      body: (
        <AdminActionForm
          action={attachPaymentAction}
          hidden={hidden}
          submitLabel="Fetch and apply the payment"
          variant="secondary"
        >
          <Field
            id="attach-payment-id"
            name="providerPaymentId"
            label="Razorpay payment id"
            hint="From the Razorpay dashboard, for example pay_…. The server fetches it and applies what the provider reports."
            autoComplete="off"
            spellCheck={false}
            required
          />
          <TextareaField
            id="attach-reason"
            name="reason"
            label="Reason"
            required
            maxLength={500}
          />
          <p className={styles.muted}>
            Admin only, with a fresh second factor. Nothing is marked paid from
            what you type: the provider&rsquo;s record decides.
          </p>
        </AdminActionForm>
      ),
    });
  }
  if (actions.acceptMismatch) {
    groups.push({
      title: "Accept the captured amount and confirm",
      danger: true,
      body: (
        <AdminActionForm
          action={acceptMismatchAction}
          hidden={hidden}
          submitLabel="Accept and confirm the order"
          variant="secondary"
        >
          <TextareaField
            id="accept-reason"
            name="reason"
            label="Reason"
            required
            maxLength={500}
          />
          <Field
            id="accept-confirm"
            name="confirmOrderNumber"
            label={`Type ${order.orderNumber} to confirm`}
            autoComplete="off"
            autoCapitalize="characters"
            required
          />
          <p className={styles.muted}>
            Admin only, with a fresh second factor. Underpayments are refused;
            cancel and refund those instead.
          </p>
        </AdminActionForm>
      ),
    });
  }
  if (actions.refundableInPaise > 0) {
    groups.push({
      title: "Refund",
      danger: true,
      body: (
        <AdminActionForm
          action={createRefundAction}
          // One refund per rendered form: a double click or a retried
          // request finds the refund this key created (docs/admin.md §5.5).
          hidden={{ ...hidden, operationKey: crypto.randomUUID() }}
          submitLabel="Queue the refund"
          variant="secondary"
        >
          <Field
            id="refund-amount"
            name="amount"
            label="Amount (₹)"
            hint={`Up to ${formatINR(actions.refundableInPaise)} can still be refunded.`}
            inputMode="decimal"
            required
          />
          <TextareaField
            id="refund-reason"
            name="reason"
            label="Reason"
            required
            maxLength={500}
          />
          <p className={styles.muted}>
            Admin only, with a fresh second factor. The refund job requests it
            from the provider and emails the customer.
          </p>
        </AdminActionForm>
      ),
    });
  }
  groups.push({
    title: "Add a staff note",
    body: (
      <AdminActionForm
        action={addStaffNoteAction}
        hidden={hidden}
        submitLabel="Add note"
      >
        <TextareaField
          id="note-text"
          name="note"
          label="Note"
          hint="Visible to staff only."
          required
          maxLength={1000}
        />
      </AdminActionForm>
    ),
  });

  return (
    <section className={styles.panel} aria-labelledby="order-actions">
      <h2 id="order-actions" className={styles.panelTitle}>
        Actions
      </h2>
      <div className={styles.actions}>
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
    </section>
  );
}
