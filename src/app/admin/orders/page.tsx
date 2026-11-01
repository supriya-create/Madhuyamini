import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { OrderFilters } from "@/components/admin/orders/OrderFilters";
import { OrderTable } from "@/components/admin/orders/OrderTable";
import { orderListQuerySchema } from "@/features/admin/orders/schemas";
import { getOrderList } from "@/features/admin/orders/service";
import { requireStaffSession } from "@/server/auth/staff";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Orders" };

function text(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function AdminOrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
  const ctx = await requireStaffSession();
  const raw = await searchParams;
  const query = orderListQuerySchema.parse({
    status: text(raw.status) || undefined,
    method: text(raw.method) || undefined,
    from: text(raw.from) || undefined,
    to: text(raw.to) || undefined,
    q: text(raw.q) || undefined,
    page: text(raw.page) || undefined,
  });
  const to = query.to
    ? new Date(query.to.getTime() + 24 * 60 * 60 * 1000)
    : null;
  const list = await getOrderList(ctx, {
    status: query.status ?? null,
    paymentMethod: query.method ?? null,
    from: query.from ?? null,
    to,
    q: query.q ?? null,
    page: query.page ?? 1,
  });
  const pageLink = (page: number) => {
    const params = new URLSearchParams();
    for (const key of ["status", "method", "from", "to", "q"] as const) {
      const value = text(raw[key]);
      if (value) params.set(key, value);
    }
    params.set("page", String(page));
    return `${routes.adminOrders}?${params.toString()}`;
  };

  return (
    <div>
      <AdminPageHeader
        title="Orders"
        lede={`${list.total} ${list.total === 1 ? "order" : "orders"} match. Newest first.`}
      />
      <OrderFilters
        values={{
          status: text(raw.status),
          method: text(raw.method),
          from: text(raw.from),
          to: text(raw.to),
          q: text(raw.q),
        }}
      />
      <OrderTable items={list.items} />
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
