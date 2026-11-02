import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { ReturnTable } from "@/components/admin/returns/ReturnTable";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { Button } from "@/components/ui/Button";
import { returnListQuerySchema } from "@/features/admin/returns/schemas";
import { getReturnQueue } from "@/features/admin/returns/service";
import { returnStatusLabels } from "@/features/returns/types";
import { requireStaffSession } from "@/server/auth/staff";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Returns" };

function text(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function AdminReturnsPage({
  searchParams,
}: PageProps<"/admin/returns">) {
  const ctx = await requireStaffSession();
  const raw = await searchParams;
  const query = returnListQuerySchema.parse({
    status: text(raw.status) || undefined,
    q: text(raw.q) || undefined,
    page: text(raw.page) || undefined,
  });
  const list = await getReturnQueue(ctx, {
    status: query.status ?? "open",
    q: query.q ?? null,
    page: query.page ?? 1,
  });
  const pageLink = (page: number) => {
    const params = new URLSearchParams();
    for (const key of ["status", "q"] as const) {
      const value = text(raw[key]);
      if (value) params.set(key, value);
    }
    params.set("page", String(page));
    return `${routes.adminReturns}?${params.toString()}`;
  };

  return (
    <div>
      <AdminPageHeader
        title="Returns"
        lede={`${list.total} ${list.total === 1 ? "return" : "returns"} match. Newest first; open requests unless you pick a status.`}
      />
      <form
        method="get"
        action={routes.adminReturns}
        className={styles.filters}
      >
        <div className={styles.filterRow}>
          <SelectField
            id="returns-status"
            name="status"
            label="Status"
            options={[
              { value: "open", label: "All open" },
              ...Object.entries(returnStatusLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            defaultValue={text(raw.status) || "open"}
          />
          <Field
            id="returns-q"
            name="q"
            label="Return, order or email"
            defaultValue={text(raw.q)}
            maxLength={120}
          />
        </div>
        <div className={styles.filterActions}>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </div>
      </form>
      <ReturnTable items={list.items} />
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
