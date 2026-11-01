import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { JobsPanel } from "@/components/admin/operations/JobsPanel";
import { OutboxList } from "@/components/admin/operations/OutboxList";
import { WebhookList } from "@/components/admin/operations/WebhookList";
import { can } from "@/features/admin/authz";
import { OPERATIONS_VIEWS } from "@/features/admin/operations/schemas";
import type { OperationsView } from "@/features/admin/operations/schemas";
import {
  getAlerts,
  getOperationsCounts,
  getOutbox,
  getWebhooks,
} from "@/features/admin/operations/service";
import { requireStaffSession } from "@/server/auth/staff";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Operations" };

const NOTICES: Record<string, string> = {
  retried: "The email is queued again.",
  discarded: "The email was discarded.",
  reapplied: "The webhook event is queued for processing again.",
  acknowledged: "Alert acknowledged.",
};

const OUTBOX_STATUSES = ["PENDING", "FAILED", "SENT"] as const;
const WEBHOOK_STATUSES = [
  "RECEIVED",
  "FAILED",
  "IGNORED",
  "PROCESSED",
] as const;

const VIEW_LABELS: Record<OperationsView, string> = {
  jobs: "Jobs and queues",
  outbox: "Email outbox",
  webhooks: "Webhook ledger",
  alerts: "Alerts",
};

export default async function OperationsPage({
  searchParams,
}: PageProps<"/admin/operations">) {
  const ctx = await requireStaffSession();
  const query = await searchParams;
  const view: OperationsView =
    OPERATIONS_VIEWS.find((value) => value === query.view) ?? "jobs";
  const status = typeof query.status === "string" ? query.status : null;
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;

  return (
    <div>
      <AdminPageHeader
        title="Operations"
        lede="Background work and its queues. Retries and discards only reset rows; the workers do the rest with their usual leases and dedupe keys."
      />
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <nav aria-label="Operations views" className={styles.inline}>
        {OPERATIONS_VIEWS.map((value) => (
          <Link
            key={value}
            href={`${routes.adminOperations}?view=${value}`}
            aria-current={view === value ? "page" : undefined}
          >
            {VIEW_LABELS[value]}
          </Link>
        ))}
      </nav>
      <h2 className={styles.sectionTitleSpaced}>{VIEW_LABELS[view]}</h2>
      {view === "jobs" ? (
        <JobsPanel
          counts={await getOperationsCounts(ctx)}
          canRun={can(ctx.role, "operations.run_job")}
        />
      ) : null}
      {view === "outbox" ? (
        <>
          <nav aria-label="Outbox status" className={styles.inline}>
            <Link
              href={`${routes.adminOperations}?view=outbox`}
              aria-current={status === null ? "page" : undefined}
            >
              All
            </Link>
            {OUTBOX_STATUSES.map((value) => (
              <Link
                key={value}
                href={`${routes.adminOperations}?view=outbox&status=${value}`}
                aria-current={status === value ? "page" : undefined}
              >
                {value.toLowerCase()}
              </Link>
            ))}
          </nav>
          <OutboxList
            rows={await getOutbox(ctx, {
              status: OUTBOX_STATUSES.find((value) => value === status) ?? null,
              kind: null,
            })}
            mode="outbox"
          />
        </>
      ) : null}
      {view === "webhooks" ? (
        <>
          <nav aria-label="Webhook status" className={styles.inline}>
            <Link
              href={`${routes.adminOperations}?view=webhooks`}
              aria-current={status === null ? "page" : undefined}
            >
              All
            </Link>
            {WEBHOOK_STATUSES.map((value) => (
              <Link
                key={value}
                href={`${routes.adminOperations}?view=webhooks&status=${value}`}
                aria-current={status === value ? "page" : undefined}
              >
                {value.toLowerCase()}
              </Link>
            ))}
          </nav>
          <WebhookList
            rows={await getWebhooks(ctx, {
              status:
                WEBHOOK_STATUSES.find((value) => value === status) ?? null,
              eventType: null,
            })}
          />
        </>
      ) : null}
      {view === "alerts" ? (
        <OutboxList rows={await getAlerts(ctx)} mode="alerts" />
      ) : null}
    </div>
  );
}
