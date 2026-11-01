import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { Badge } from "@/components/admin/orders/StatusBadge";
import { TextareaField } from "@/components/forms/TextareaField";
import {
  acknowledgeAlertAction,
  discardNotificationAction,
  retryNotificationAction,
} from "@/features/admin/operations/actions";
import type { OutboxView } from "@/features/admin/operations/service";
import { formatDateTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

const TONES = { PENDING: "warn", SENT: "good", FAILED: "bad" } as const;

export function PayloadView({ payload }: { payload: unknown }) {
  return (
    <details className={styles.details}>
      <summary>Payload</summary>
      <div>
        <pre className={styles.mono}>{JSON.stringify(payload, null, 2)}</pre>
      </div>
    </details>
  );
}

export function OutboxList({
  rows,
  mode,
}: {
  rows: ReadonlyArray<OutboxView>;
  mode: "outbox" | "alerts";
}) {
  if (rows.length === 0) {
    return (
      <p className={styles.empty}>
        {mode === "alerts" ? "No alerts." : "No emails match."}
      </p>
    );
  }
  return (
    <ul className={styles.timeline}>
      {rows.map((row) => (
        <li key={row.id} className={styles.panel}>
          <div className={styles.inline}>
            <strong>{row.kind}</strong>
            <Badge tone={TONES[row.status]}>{row.status}</Badge>
            {mode === "alerts" && row.acknowledged ? (
              <Badge tone="good">acknowledged</Badge>
            ) : null}
            {row.orderId && row.orderNumber ? (
              <Link
                href={routes.adminOrder(row.orderId)}
                className={styles.rowLink}
              >
                {row.orderNumber}
              </Link>
            ) : null}
          </div>
          <dl className={styles.dl}>
            <dt>To</dt>
            <dd>{row.recipient}</dd>
            <dt>Created</dt>
            <dd>{formatDateTime(row.createdAt)}</dd>
            {row.sentAt ? (
              <>
                <dt>Sent</dt>
                <dd>{formatDateTime(row.sentAt)}</dd>
              </>
            ) : (
              <>
                <dt>Attempts</dt>
                <dd>
                  {row.attempts}
                  {row.status === "PENDING"
                    ? ` · next ${formatDateTime(row.nextAttemptAt)}`
                    : ""}
                </dd>
              </>
            )}
            {row.lastError ? (
              <>
                <dt>Last error</dt>
                <dd className={styles.danger}>{row.lastError}</dd>
              </>
            ) : null}
            <dt>Dedupe key</dt>
            <dd className={styles.mono}>{row.dedupeKey}</dd>
          </dl>
          <PayloadView payload={row.payload} />
          {mode === "alerts" && !row.acknowledged ? (
            <AdminActionForm
              action={acknowledgeAlertAction}
              hidden={{ id: row.id }}
              submitLabel="Acknowledge"
              variant="quiet"
            />
          ) : null}
          {mode === "outbox" && row.canRetry ? (
            <AdminActionForm
              action={retryNotificationAction}
              hidden={{ id: row.id }}
              submitLabel="Retry sending"
              variant="secondary"
            />
          ) : null}
          {mode === "outbox" && row.canDiscard ? (
            <details className={styles.details} data-danger="true">
              <summary>Discard</summary>
              <div>
                <AdminActionForm
                  action={discardNotificationAction}
                  hidden={{ id: row.id }}
                  submitLabel="Discard this email"
                  variant="secondary"
                >
                  <TextareaField
                    id={`discard-${row.id}`}
                    name="reason"
                    label="Reason"
                    required
                    maxLength={500}
                  />
                  <p className={styles.muted}>
                    Admin only, with a fresh second factor. The row stays as a
                    record; it will never be sent.
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
