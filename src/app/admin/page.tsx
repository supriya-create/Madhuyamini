import type { Metadata } from "next";

import { AdminPageHeader } from "@/components/admin/AdminShell";
import styles from "@/components/admin/AdminShell.module.css";
import { loadOverview } from "@/features/admin/overview/data";
import { requireStaffSession } from "@/server/auth/staff";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = { title: "Overview" };

/** The counts an operator needs first thing (docs/admin.md §5.1). */
export default async function AdminOverviewPage() {
  const ctx = await requireStaffSession();
  const counts = await loadOverview(ctx);
  const stats: ReadonlyArray<{
    label: string;
    value: string;
    hint: string;
    attention?: boolean;
  }> = [
    {
      label: "Awaiting fulfilment",
      value: String(counts.awaitingFulfilment),
      hint: "Confirmed or being packed",
      attention: counts.awaitingFulfilment > 0,
    },
    {
      label: "In transit",
      value: String(counts.shipped),
      hint: "Shipped, not yet delivered",
    },
    {
      label: "Delivery failed",
      value: String(counts.deliveryFailed),
      hint: "Returning to origin",
      attention: counts.deliveryFailed > 0,
    },
    {
      label: "Awaiting inspection",
      value: String(counts.awaitingInspection),
      hint: "Returned parcels not yet inspected",
      attention: counts.awaitingInspection > 0,
    },
    {
      label: "Payments to review",
      value: String(counts.needsReview),
      hint: "Captured amount did not match",
      attention: counts.needsReview > 0,
    },
    {
      label: "Awaiting payment",
      value: String(counts.pendingPayment),
      hint: "Holds expire on their own",
    },
    {
      label: "Low stock",
      value: String(counts.lowStock),
      hint: "Available at or below the threshold",
      attention: counts.lowStock > 0,
    },
    {
      label: "Revenue, 7 days",
      value: formatINR(counts.revenueWeekInPaise),
      hint: "Confirmed or beyond, before refunds",
    },
    {
      label: "Customer-data reveals, 7 days",
      value: String(counts.revealsThisWeek),
      hint: "Each one recorded with who, why and which fields",
      attention: counts.revealsThisWeek > 0,
    },
    {
      label: "Failed jobs",
      value: String(
        counts.failedNotifications +
          counts.failedWebhooks +
          counts.failedRefunds,
      ),
      hint: `${counts.failedNotifications} emails · ${counts.failedWebhooks} webhooks · ${counts.failedRefunds} refunds`,
      attention:
        counts.failedNotifications +
          counts.failedWebhooks +
          counts.failedRefunds >
        0,
    },
  ];
  return (
    <div>
      <AdminPageHeader
        title="Overview"
        lede={`Today so far: ${counts.ordersToday} ${counts.ordersToday === 1 ? "order" : "orders"} worth ${formatINR(counts.revenueTodayInPaise)} (paid online or cash collected; before refunds).`}
      />
      <ul className={styles.stats}>
        {stats.map((stat) => (
          <li
            key={stat.label}
            className={styles.stat}
            data-attention={stat.attention ? "true" : undefined}
          >
            <span className={styles.statValue}>{stat.value}</span>
            <span className={styles.statLabel}>{stat.label}</span>
            <span className={styles.statHint}>{stat.hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
