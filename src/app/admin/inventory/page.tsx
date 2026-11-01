import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Badge } from "@/components/admin/orders/StatusBadge";
import { Field } from "@/components/forms/Field";
import { Button, ButtonLink } from "@/components/ui/Button";
import { levelsQuerySchema } from "@/features/admin/inventory/schemas";
import { getLevels } from "@/features/admin/inventory/service";
import { requireStaffSession } from "@/server/auth/staff";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({
  searchParams,
}: PageProps<"/admin/inventory">) {
  const ctx = await requireStaffSession();
  const raw = await searchParams;
  const query = levelsQuerySchema.parse({
    low: typeof raw.low === "string" ? raw.low : undefined,
    q: typeof raw.q === "string" ? raw.q : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const list = await getLevels(ctx, {
    lowStockOnly: query.low === "1",
    q: query.q ?? null,
    page: query.page ?? 1,
  });
  const pageLink = (page: number) => {
    const params = new URLSearchParams();
    if (query.low) params.set("low", "1");
    if (query.q) params.set("q", query.q);
    params.set("page", String(page));
    return `${routes.adminInventory}?${params.toString()}`;
  };

  return (
    <div>
      <AdminPageHeader
        title="Inventory"
        lede="Available = on hand − held for pending online payments. Holds move only through checkout; everything else is an audited adjustment."
      />
      <form
        method="get"
        action={routes.adminInventory}
        className={styles.filters}
      >
        <div className={styles.filterRow}>
          <Field
            id="inv-q"
            name="q"
            label="Search"
            type="search"
            defaultValue={query.q ?? ""}
            maxLength={120}
            hint="SKU or product title."
          />
          <div className={styles.inline}>
            <input
              type="checkbox"
              id="inv-low"
              name="low"
              value="1"
              defaultChecked={query.low === "1"}
            />
            <label htmlFor="inv-low">Low stock only</label>
          </div>
        </div>
        <div className={styles.filterActions}>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          <ButtonLink href={routes.adminInventory} variant="quiet">
            Clear
          </ButtonLink>
        </div>
      </form>
      {list.items.length === 0 ? (
        <p className={styles.empty}>No variants match.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">SKU</th>
                <th scope="col" className={styles.num}>
                  Price
                </th>
                <th scope="col" className={styles.num}>
                  On hand
                </th>
                <th scope="col" className={styles.num}>
                  Held
                </th>
                <th scope="col" className={styles.num}>
                  Available
                </th>
                <th scope="col" className={styles.num}>
                  Threshold
                </th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <tr key={item.variantId}>
                  <td>
                    <Link
                      href={routes.adminInventoryVariant(item.variantId)}
                      className={styles.rowLink}
                    >
                      {item.productTitle}
                    </Link>
                    {item.variantTitle ? (
                      <div className={styles.muted}>{item.variantTitle}</div>
                    ) : null}
                  </td>
                  <td className={styles.mono}>{item.sku}</td>
                  <td className={styles.num}>{formatINR(item.priceInPaise)}</td>
                  <td className={styles.num}>{item.stockOnHand}</td>
                  <td className={styles.num}>{item.reserved}</td>
                  <td className={styles.num}>{item.available}</td>
                  <td className={styles.num}>{item.lowStockThreshold}</td>
                  <td>
                    <span className={styles.inline}>
                      {item.lowStock ? (
                        <Badge tone="bad">low</Badge>
                      ) : (
                        <Badge tone="good">ok</Badge>
                      )}
                      {!item.isActive ? <Badge>inactive</Badge> : null}
                      {item.productStatus !== "ACTIVE" ? (
                        <Badge tone="warn">
                          {item.productStatus.toLowerCase()}
                        </Badge>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
