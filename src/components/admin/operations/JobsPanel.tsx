import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { runJobAction } from "@/features/admin/operations/actions";
import type { OperationsCounts } from "@/features/admin/operations/data";
import type { QueueCounts } from "@/features/admin/operations/data";
import { formatDateTime } from "@/lib/dates";

const JOBS: ReadonlyArray<{ name: string; purpose: string }> = [
  {
    name: "expire-reservations",
    purpose: "Cancels unpaid orders past their deadline and releases holds.",
  },
  {
    name: "recover-payments",
    purpose: "Finishes attempts that never got a provider order.",
  },
  {
    name: "reconcile-payments",
    purpose: "Asks the provider about open attempts (missed webhooks).",
  },
  {
    name: "process-webhooks",
    purpose: "Applies stored webhook deliveries that failed inline.",
  },
  {
    name: "refund-payments",
    purpose: "Requests queued refunds and follows them to completion.",
  },
  { name: "send-notifications", purpose: "Sends the email outbox." },
  {
    name: "cleanup",
    purpose:
      "Daily sweeps: carts, rate limits, sessions, tokens, orphaned uploads.",
  },
];

function QueueRow({ label, counts }: { label: string; counts: QueueCounts }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        {Object.entries(counts.byStatus)
          .map(([status, count]) => `${status.toLowerCase()} ${count}`)
          .join(" · ") || "empty"}
      </td>
      <td className={styles.num}>{counts.dueNow}</td>
      <td>
        {counts.lastClaimedAt ? formatDateTime(counts.lastClaimedAt) : "never"}
      </td>
    </tr>
  );
}

export function JobsPanel({
  counts,
  canRun,
}: {
  counts: OperationsCounts;
  canRun: boolean;
}) {
  return (
    <div className={styles.actions}>
      <section className={styles.panel} aria-labelledby="ops-queues">
        <h2 id="ops-queues" className={styles.panelTitle}>
          Queues
        </h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Queue</th>
                <th scope="col">By status</th>
                <th scope="col" className={styles.num}>
                  Due now
                </th>
                <th scope="col">Last claimed</th>
              </tr>
            </thead>
            <tbody>
              <QueueRow label="Email outbox" counts={counts.outbox} />
              <QueueRow label="Webhook ledger" counts={counts.webhooks} />
              <QueueRow label="Refunds" counts={counts.refunds} />
            </tbody>
          </table>
        </div>
        <dl className={styles.dl}>
          <dt>Unpaid orders past deadline</dt>
          <dd>{counts.pendingOrdersPastDeadline}</dd>
          <dt>Attempts without a provider order</dt>
          <dd>{counts.staleInitiatedAttempts}</dd>
          <dt>Issued uploads not yet attached</dt>
          <dd>{counts.orphanUploads}</dd>
        </dl>
      </section>
      <section className={styles.panel} aria-labelledby="ops-jobs">
        <h2 id="ops-jobs" className={styles.panelTitle}>
          Jobs
        </h2>
        <p className={styles.muted}>
          The scheduler runs these on its own. Running one here uses the same
          function with the same leases, so it is safe alongside the scheduler.
          {canRun
            ? " Each run is audited twice: when it starts and with its summary."
            : " Only an admin can run a job by hand."}
        </p>
        <ul className={styles.timeline}>
          {JOBS.map((job) => (
            <li key={job.name} className={styles.timelineItem}>
              <div>
                <strong className={styles.mono}>{job.name}</strong>
              </div>
              <div className={styles.muted}>{job.purpose}</div>
              {canRun ? (
                <AdminActionForm
                  action={runJobAction}
                  hidden={{ name: job.name }}
                  submitLabel="Run now"
                  pendingLabel="Running…"
                  variant="secondary"
                />
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
