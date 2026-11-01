import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { Badge } from "@/components/admin/orders/StatusBadge";
import { Field } from "@/components/forms/Field";
import { TextareaField } from "@/components/forms/TextareaField";
import {
  markRefundedExternallyAction,
  retryRefundAction,
} from "@/features/admin/payments/actions";
import type { RefundView } from "@/features/admin/payments/service";
import { formatDateTime } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

const TONES = {
  INITIATED: "warn",
  REQUESTED: "warn",
  PROCESSED: "good",
  FAILED: "bad",
} as const;

export function RefundTable({
  refunds,
}: {
  refunds: ReadonlyArray<RefundView>;
}) {
  if (refunds.length === 0) {
    return <p className={styles.empty}>No refunds match.</p>;
  }
  return (
    <ul className={styles.timeline}>
      {refunds.map((refund) => (
        <li key={refund.id} className={styles.panel}>
          <div className={styles.inline}>
            <strong className={styles.mono}>{refund.reference}</strong>
            <Badge tone={TONES[refund.status]}>{refund.status}</Badge>
            <span>{formatINR(refund.amountInPaise)}</span>
            <Link
              href={routes.adminOrder(refund.orderId)}
              className={styles.rowLink}
            >
              {refund.orderNumber}
            </Link>
          </div>
          <dl className={styles.dl}>
            <dt>Reason</dt>
            <dd>{refund.reason.replaceAll("_", " ")}</dd>
            <dt>Requested</dt>
            <dd>{formatDateTime(refund.createdAt)}</dd>
            {refund.providerPaymentId ? (
              <>
                <dt>Provider payment</dt>
                <dd className={styles.mono}>{refund.providerPaymentId}</dd>
              </>
            ) : null}
            {refund.providerRefundId ? (
              <>
                <dt>Provider refund</dt>
                <dd className={styles.mono}>{refund.providerRefundId}</dd>
              </>
            ) : null}
            {refund.processedAt ? (
              <>
                <dt>Processed</dt>
                <dd>{formatDateTime(refund.processedAt)}</dd>
              </>
            ) : (
              <>
                <dt>Attempts</dt>
                <dd>
                  {refund.attempts}
                  {refund.status !== "FAILED"
                    ? ` · next ${formatDateTime(refund.nextAttemptAt)}`
                    : ""}
                </dd>
              </>
            )}
            {refund.lastError ? (
              <>
                <dt>Last error</dt>
                <dd className={styles.danger}>{refund.lastError}</dd>
              </>
            ) : null}
          </dl>
          {refund.canRetry ? (
            <details className={styles.details}>
              <summary>Retry</summary>
              <div>
                <AdminActionForm
                  action={retryRefundAction}
                  hidden={{ refundId: refund.id }}
                  submitLabel="Queue it again"
                  variant="secondary"
                >
                  <TextareaField
                    id={`retry-${refund.id}`}
                    name="reason"
                    label="Reason"
                    required
                    maxLength={500}
                  />
                  <p className={styles.muted}>
                    Resets the attempts; the refund job requests it from the
                    provider again. Admin only, with a fresh second factor.
                  </p>
                </AdminActionForm>
              </div>
            </details>
          ) : null}
          {refund.canMarkExternal ? (
            <details className={styles.details} data-danger="true">
              <summary>Refunded by hand in the dashboard</summary>
              <div>
                <AdminActionForm
                  action={markRefundedExternallyAction}
                  hidden={{ refundId: refund.id }}
                  submitLabel="Verify and record"
                  variant="secondary"
                >
                  <Field
                    id={`external-id-${refund.id}`}
                    name="providerRefundId"
                    label="Razorpay refund id"
                    hint="The server checks it against the provider before recording anything."
                    autoComplete="off"
                    spellCheck={false}
                    required
                  />
                  <TextareaField
                    id={`external-reason-${refund.id}`}
                    name="reason"
                    label="Reason"
                    required
                    maxLength={500}
                  />
                </AdminActionForm>
              </div>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
