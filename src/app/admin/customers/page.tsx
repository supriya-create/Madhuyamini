import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Badge } from "@/components/admin/orders/StatusBadge";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { TextareaField } from "@/components/forms/TextareaField";
import { Button, ButtonLink } from "@/components/ui/Button";
import { issueGrantAction } from "@/features/admin/customers/actions";
import {
  PII_FIELDS,
  customerSearchSchema,
} from "@/features/admin/customers/schemas";
import {
  getCustomerList,
  getStaffDirectory,
} from "@/features/admin/customers/service";
import { requireStaffSession } from "@/server/auth/staff";
import { formatDate } from "@/lib/dates";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Customers" };

const NOTICES: Record<string, string> = {
  granted: "Grant issued; the owner inbox has been notified.",
};

export default async function CustomersPage({
  searchParams,
}: PageProps<"/admin/customers">) {
  const ctx = await requireStaffSession();
  const raw = await searchParams;
  const query = customerSearchSchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    role: typeof raw.role === "string" ? raw.role : undefined,
    page: typeof raw.page === "string" ? raw.page : undefined,
  });
  const [list, staff] = await Promise.all([
    getCustomerList(ctx, {
      q: query.q ?? null,
      role: query.role ?? null,
      page: query.page ?? 1,
    }),
    ctx.role === "ADMIN" ? getStaffDirectory(ctx) : [],
  ]);
  const notice =
    typeof raw.notice === "string" ? NOTICES[raw.notice] : undefined;
  const pageLink = (page: number) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.role) params.set("role", query.role);
    params.set("page", String(page));
    return `${routes.adminCustomers}?${params.toString()}`;
  };
  return (
    <div>
      <AdminPageHeader
        title="Customers"
        lede="Contact details are masked. Search by order number, exact email address or phone number; names match partially."
      />
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <form
        method="get"
        action={routes.adminCustomers}
        className={styles.filters}
      >
        <div className={styles.filterRow}>
          <Field
            id="cf-q"
            name="q"
            label="Search"
            type="search"
            defaultValue={query.q ?? ""}
            maxLength={160}
          />
          <SelectField
            id="cf-role"
            name="role"
            label="Role"
            placeholder="Any role"
            defaultValue={query.role ?? ""}
            options={[
              { value: "CUSTOMER", label: "Customer" },
              { value: "STAFF", label: "Staff" },
              { value: "ADMIN", label: "Admin" },
            ]}
          />
        </div>
        <div className={styles.filterActions}>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          <ButtonLink href={routes.adminCustomers} variant="quiet">
            Clear
          </ButtonLink>
        </div>
      </form>
      {list.items.length === 0 ? (
        <p className={styles.empty}>No accounts match.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">Role</th>
                <th scope="col" className={styles.num}>
                  Orders
                </th>
                <th scope="col">City</th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link
                      href={routes.adminCustomer(item.id)}
                      className={styles.rowLink}
                    >
                      {item.name}
                    </Link>
                  </td>
                  <td>
                    {item.emailMasked}
                    {item.emailVerified ? (
                      ""
                    ) : (
                      <div className={styles.muted}>unconfirmed</div>
                    )}
                  </td>
                  <td>{item.phoneMasked ?? "—"}</td>
                  <td>
                    <Badge tone={item.role === "CUSTOMER" ? undefined : "warn"}>
                      {item.role}
                    </Badge>
                  </td>
                  <td className={styles.num}>{item.orderCount}</td>
                  <td>{item.city ?? "—"}</td>
                  <td>{formatDate(item.joinedAt)}</td>
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
      {ctx.role === "ADMIN" ? (
        <section className={styles.panel} aria-labelledby="shift-grant">
          <h2 id="shift-grant" className={styles.panelTitle}>
            Support-shift grant (any customer)
          </h2>
          <p className={styles.muted}>
            Lets one staff member reveal the chosen fields of any customer for a
            limited time. Each reveal is still an explicit, audited action.
          </p>
          <AdminActionForm
            action={issueGrantAction}
            hidden={{ customerId: "" }}
            submitLabel="Issue grant"
            variant="secondary"
          >
            <SelectField
              id="sg-grantee"
              name="granteeId"
              label="Staff member"
              placeholder="Choose"
              options={staff.map((s) => ({
                value: s.id,
                label: `${s.name} (${s.role.toLowerCase()})`,
              }))}
              required
            />
            <fieldset className={styles.actionGroup}>
              <legend>Fields</legend>
              {PII_FIELDS.map((field) => (
                <div key={field} className={styles.inline}>
                  <input
                    type="checkbox"
                    id={`sg-${field}`}
                    name="fields"
                    value={field}
                  />
                  <label htmlFor={`sg-${field}`}>{field}</label>
                </div>
              ))}
            </fieldset>
            <Field
              id="sg-hours"
              name="hours"
              label="Hours (up to 24)"
              type="number"
              inputMode="numeric"
              min={1}
              max={24}
              defaultValue={2}
              required
            />
            <TextareaField
              id="sg-reason"
              name="reason"
              label="Reason"
              required
              maxLength={500}
            />
          </AdminActionForm>
        </section>
      ) : null}
    </div>
  );
}
