import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { Badge } from "@/components/admin/orders/StatusBadge";
import { TextareaField } from "@/components/forms/TextareaField";
import { reapplyWebhookAction } from "@/features/admin/operations/actions";
import type { WebhookView } from "@/features/admin/operations/service";
import { formatDateTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

import { PayloadView } from "./OutboxList";

const TONES = {
  RECEIVED: "warn",
  PROCESSED: "good",
  IGNORED: undefined,
  FAILED: "bad",
} as const;

export function WebhookList({ rows }: { rows: ReadonlyArray<WebhookView> }) {
  if (rows.length === 0) {
    return <p className={styles.empty}>No webhook deliveries match.</p>;
  }
  return (
    <ul className={styles.timeline}>
      {rows.map((row) => (
        <li key={row.id} className={styles.panel}>
          <div className={styles.inline}>
            <strong>{row.eventType}</strong>
            <Badge tone={TONES[row.status]}>{row.status}</Badge>
            <span className={styles.mono}>{row.id}</span>
            {row.orderId ? (
              <Link
                href={routes.adminOrder(row.orderId)}
                className={styles.rowLink}
              >
                order
              </Link>
            ) : null}
          </div>
          <dl className={styles.dl}>
            <dt>Received</dt>
            <dd>{formatDateTime(row.receivedAt)}</dd>
            {row.processedAt ? (
              <>
                <dt>Processed</dt>
                <dd>{formatDateTime(row.processedAt)}</dd>
              </>
            ) : null}
            {row.providerOrderId ? (
              <>
                <dt>Provider order</dt>
                <dd className={styles.mono}>{row.providerOrderId}</dd>
              </>
            ) : null}
            {row.providerPaymentId ? (
              <>
                <dt>Provider payment</dt>
                <dd className={styles.mono}>{row.providerPaymentId}</dd>
              </>
            ) : null}
            <dt>Attempts</dt>
            <dd>{row.attempts}</dd>
            {row.lastError ? (
              <>
                <dt>Last error</dt>
                <dd className={styles.danger}>{row.lastError}</dd>
              </>
            ) : null}
          </dl>
          <PayloadView payload={row.payload} />
          {row.canReapply ? (
            <details className={styles.details}>
              <summary>Re-apply</summary>
              <div>
                <AdminActionForm
                  action={reapplyWebhookAction}
                  hidden={{ id: row.id }}
                  submitLabel="Queue it for processing again"
                  variant="secondary"
                >
                  <TextareaField
                    id={`reapply-${row.id}`}
                    name="reason"
                    label="Reason"
                    required
                    maxLength={500}
                  />
                  <p className={styles.muted}>
                    Admin only, with a fresh second factor. The handler is
                    idempotent: an event already applied changes nothing.
                  </p>
                </AdminActionForm>
              </div>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
