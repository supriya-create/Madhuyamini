import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/components/admin/Admin.module.css";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { PayloadView } from "@/components/admin/operations/OutboxList";
import { Badge } from "@/components/admin/orders/StatusBadge";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { Button, ButtonLink } from "@/components/ui/Button";
import { listAudit } from "@/features/admin/auditlog/data";
import { can } from "@/features/admin/authz";
import { requireStaffSession } from "@/server/auth/staff";
import { formatDateTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Audit" };

const OUTCOMES = ["SUCCESS", "REFUSED", "FAILED"] as const;

export default async function AuditPage({
  searchParams,
}: PageProps<"/admin/audit">) {
  const ctx = await requireStaffSession();
  if (!can(ctx.role, "audit.view")) notFound();
  const raw = await searchParams;
  const action =
    typeof raw.action === "string" ? raw.action.trim().slice(0, 80) : "";
  const outcome = OUTCOMES.find((value) => value === raw.outcome) ?? null;
  const targetId =
    typeof raw.target === "string" && /^[0-9a-f-]{36}$/i.test(raw.target)
      ? raw.target
      : null;
  const page =
    typeof raw.page === "string" ? Math.max(1, Number(raw.page) || 1) : 1;
  const list = await listAudit(ctx, {
    action: action || null,
    outcome,
    targetId,
    page,
  });
  const pageLink = (n: number) => {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (outcome) params.set("outcome", outcome);
    if (targetId) params.set("target", targetId);
    params.set("page", String(n));
    return `${routes.adminAudit}?${params.toString()}`;
  };
  return (
    <div>
      <AdminPageHeader
        title="Audit"
        lede={`${list.total} entries. Append-only: nothing here can be edited or deleted, by anyone. Snapshots are redacted; addresses are hashed.`}
      />
      <form method="get" action={routes.adminAudit} className={styles.filters}>
        <div className={styles.filterRow}>
          <Field
            id="au-action"
            name="action"
            label="Action starts with"
            defaultValue={action}
            maxLength={80}
            hint="For example order., payment., customer.pii."
          />
          <SelectField
            id="au-outcome"
            name="outcome"
            label="Outcome"
            placeholder="Any"
            defaultValue={outcome ?? ""}
            options={OUTCOMES.map((value) => ({
              value,
              label: value.toLowerCase(),
            }))}
          />
          <Field
            id="au-target"
            name="target"
            label="Target id"
            defaultValue={targetId ?? ""}
            maxLength={36}
          />
        </div>
        <div className={styles.filterActions}>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          <ButtonLink href={routes.adminAudit} variant="quiet">
            Clear
          </ButtonLink>
        </div>
      </form>
      {list.rows.length === 0 ? (
        <p className={styles.empty}>No entries match.</p>
      ) : (
        <ul className={styles.timeline}>
          {list.rows.map((row) => (
            <li key={row.id} className={styles.panel}>
              <div className={styles.inline}>
                <strong>{row.action}</strong>
                <Badge
                  tone={
                    row.outcome === "SUCCESS"
                      ? "good"
                      : row.outcome === "REFUSED"
                        ? "warn"
                        : "bad"
                  }
                >
                  {row.outcome}
                </Badge>
                <span className={styles.muted}>
                  {row.targetType}
                  {row.targetId ? ` ${row.targetId}` : ""}
                </span>
              </div>
              {row.reason ? <div>{row.reason}</div> : null}
              <div className={styles.timelineMeta}>
                {formatDateTime(row.createdAt)} · {row.actorLabel}
                {row.actorRole ? ` (${row.actorRole.toLowerCase()})` : ""}
                {row.errorCode ? ` · ${row.errorCode}` : ""}
                {row.grantId ? ` · grant ${row.grantId}` : ""}
              </div>
              {row.before || row.after ? (
                <PayloadView
                  payload={{ before: row.before, after: row.after }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {list.pageCount > 1 ? (
        <nav className={styles.pagination} aria-label="Pages">
          <span>
            Page {list.page} of {list.pageCount}
          </span>
          <span className={styles.inline}>
            {list.page > 1 ? (
              <Link href={pageLink(list.page - 1)}>Previous</Link>
            ) : null}
            {list.page < list.pageCount ? (
              <Link href={pageLink(list.page + 1)}>Next</Link>
            ) : null}
          </span>
        </nav>
      ) : null}
    </div>
  );
}
