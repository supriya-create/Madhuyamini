import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { TableWrap } from "@/components/admin/TableWrap";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Badge } from "@/components/admin/orders/StatusBadge";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { Button, ButtonLink } from "@/components/ui/Button";
import { productListQuerySchema } from "@/features/admin/catalogue/schemas";
import { getProductList } from "@/features/admin/catalogue/service";
import { requireStaffSession } from "@/server/auth/staff";
import { formatDateTime } from "@/lib/dates";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Products" };

const NOTICES: Record<string, string> = { deleted: "The product was deleted." };

export default async function ProductsPage({
  searchParams,
}: PageProps<"/admin/catalogue/products">) {
  const ctx = await requireStaffSession();
  const raw = await searchParams;
  const query = productListQuerySchema.parse({
    status: typeof raw.status === "string" ? raw.status : undefined,
    q: typeof raw.q === "string" ? raw.q : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const list = await getProductList(ctx, {
    status: query.status ?? null,
    q: query.q ?? null,
    page: query.page ?? 1,
  });
  const notice =
    typeof raw.notice === "string" ? NOTICES[raw.notice] : undefined;
  const pageLink = (page: number) => {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.q) params.set("q", query.q);
    params.set("page", String(page));
    return `${routes.adminProducts}?${params.toString()}`;
  };
  return (
    <div>
      <AdminPageHeader
        title="Products"
        lede={`${list.total} ${list.total === 1 ? "product" : "products"}.`}
      >
        <div className={styles.inline}>
          <ButtonLink href={routes.adminProductNew}>New product</ButtonLink>
          <Link href={routes.adminCategories}>Categories</Link>
        </div>
      </AdminPageHeader>
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <form
        method="get"
        action={routes.adminProducts}
        className={styles.filters}
      >
        <div className={styles.filterRow}>
          <SelectField
            id="pf-status"
            name="status"
            label="Status"
            placeholder="Any status"
            defaultValue={query.status ?? ""}
            options={[
              { value: "DRAFT", label: "Draft" },
              { value: "ACTIVE", label: "Live" },
              { value: "ARCHIVED", label: "Archived" },
            ]}
          />
          <Field
            id="pf-q"
            name="q"
            label="Search"
            type="search"
            defaultValue={query.q ?? ""}
            hint="Title, slug or SKU."
            maxLength={120}
          />
        </div>
        <div className={styles.filterActions}>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
          <ButtonLink href={routes.adminProducts} variant="quiet">
            Clear
          </ButtonLink>
        </div>
      </form>
      {list.items.length === 0 ? (
        <p className={styles.empty}>No products match.</p>
      ) : (
        <TableWrap label="Products">
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Status</th>
                <th scope="col">Category</th>
                <th scope="col" className={styles.num}>
                  Variants
                </th>
                <th scope="col" className={styles.num}>
                  Available
                </th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link
                      href={routes.adminProduct(item.id)}
                      className={styles.rowLink}
                    >
                      {item.title}
                    </Link>
                    <div className={styles.muted}>
                      {item.slug}
                      {item.isFeatured ? " · featured" : ""}
                      {item.image ? "" : " · no image"}
                    </div>
                  </td>
                  <td>
                    <Badge
                      tone={
                        item.status === "ACTIVE"
                          ? "good"
                          : item.status === "ARCHIVED"
                            ? "bad"
                            : "warn"
                      }
                    >
                      {item.status}
                    </Badge>
                  </td>
                  <td>{item.categoryName}</td>
                  <td className={styles.num}>
                    {item.activeVariantCount}/{item.variantCount}
                  </td>
                  <td className={styles.num}>{item.availableUnits}</td>
                  <td>{formatDateTime(item.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
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
