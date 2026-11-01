import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { RefundTable } from "@/components/admin/payments/RefundTable";
import { getRefunds } from "@/features/admin/payments/service";
import { requireStaffSession } from "@/server/auth/staff";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Refunds" };

const STATUSES = ["INITIATED", "REQUESTED", "FAILED", "PROCESSED"] as const;

const NOTICES: Record<string, string> = {
  retried: "The refund is queued again.",
  external: "The provider confirmed the refund; it is recorded as processed.",
};

export default async function RefundsPage({
  searchParams,
}: PageProps<"/admin/payments/refunds">) {
  const ctx = await requireStaffSession();
  const query = await searchParams;
  const status = STATUSES.find((value) => value === query.status) ?? null;
  const refunds = await getRefunds(ctx, { status });
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  return (
    <div>
      <AdminPageHeader
        title="Refunds"
        lede="Every refund is a queue row the refund job executes with the provider. Nothing here moves money directly: a retry re-queues the row, and a refund made by hand is recorded only after the provider confirms it."
      />
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <nav aria-label="Refund status" className={styles.inline}>
        <Link
          href={routes.adminRefunds}
          aria-current={status === null ? "page" : undefined}
        >
          All
        </Link>
        {STATUSES.map((value) => (
          <Link
            key={value}
            href={`${routes.adminRefunds}?status=${value}`}
            aria-current={status === value ? "page" : undefined}
          >
            {value.toLowerCase()}
          </Link>
        ))}
      </nav>
      <RefundTable refunds={refunds} />
    </div>
  );
}
