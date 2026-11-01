import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/components/admin/Admin.module.css";
import { AdminActionForm } from "@/components/admin/AdminActionForm";
import { AdminPageHeader } from "@/components/admin/AdminShell";
import { Badge, StatusBadge } from "@/components/admin/orders/StatusBadge";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { TextareaField } from "@/components/forms/TextareaField";
import {
  issueGrantAction,
  resendVerificationAction,
  resetTwoFactorAction,
  revealCustomerAction,
  revokeGrantAction,
  setRoleAction,
} from "@/features/admin/customers/actions";
import { PII_FIELDS, userIdSchema } from "@/features/admin/customers/schemas";
import {
  getCustomerDetail,
  getStaffDirectory,
} from "@/features/admin/customers/service";
import type { OrderStatus } from "@/generated/prisma/enums";
import { requireStaffSession } from "@/server/auth/staff";
import { formatDateTime } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Customer" };

const NOTICES: Record<string, string> = {
  revealed: "Fields revealed for a few minutes; this is recorded.",
  granted: "Grant issued; the owner inbox has been notified.",
  revoked: "Grant revoked; any reveal relying on it has ended.",
  role: "Role changed; every session of that account has been signed out.",
  two_factor_reset:
    "Second factor reset; they will enrol again at the next sign-in.",
  verification_sent: "Verification email sent.",
};

export default async function CustomerPage({
  params,
  searchParams,
}: PageProps<"/admin/customers/[id]">) {
  const ctx = await requireStaffSession();
  const { id } = await params;
  const parsed = userIdSchema.safeParse(id);
  if (!parsed.success) notFound();
  const [customer, staff, query] = await Promise.all([
    getCustomerDetail(ctx, parsed.data),
    ctx.role === "ADMIN" ? getStaffDirectory(ctx) : [],
    searchParams,
  ]);
  if (!customer) notFound();
  const notice =
    typeof query.notice === "string" ? NOTICES[query.notice] : undefined;
  const hidden = { customerId: customer.id, userId: customer.id };

  return (
    <div>
      <AdminPageHeader title={customer.name}>
        <div className={styles.headerMeta}>
          <Badge tone={customer.role === "CUSTOMER" ? undefined : "warn"}>
            {customer.role}
          </Badge>
          <span>
            {customer.emailVerified ? "email confirmed" : "email not confirmed"}
          </span>
          <span>joined {formatDateTime(customer.joinedAt)}</span>
          <span>
            {customer.sessionCount} active session
            {customer.sessionCount === 1 ? "" : "s"}
          </span>
        </div>
      </AdminPageHeader>
      {notice ? (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <div className={styles.grid}>
        <div className={styles.actions}>
          <section className={styles.panel} aria-labelledby="customer-contact">
            <h2 id="customer-contact" className={styles.panelTitle}>
              Contact and addresses
            </h2>
            {customer.revealExpiresAt ? (
              <p className={styles.notice} data-tone="warning">
                Revealed fields ({[...customer.revealed].join(", ")}) are shown
                until {formatDateTime(customer.revealExpiresAt)}.
              </p>
            ) : (
              <p className={styles.muted}>
                Masked by default. Revealing is an explicit, recorded action.
              </p>
            )}
            <dl className={styles.dl}>
              <dt>Email</dt>
              <dd>{customer.email}</dd>
              <dt>Phone</dt>
              <dd>{customer.phone ?? "—"}</dd>
            </dl>
            {customer.addresses.length === 0 ? (
              <p className={styles.muted}>No saved addresses.</p>
            ) : (
              <ul className={styles.timeline}>
                {customer.addresses.map((address) => (
                  <li key={address.id} className={styles.timelineItem}>
                    <div>
                      <strong>{address.label ?? "Address"}</strong>
                      {address.isDefault ? " · default" : ""}
                    </div>
                    <div>{address.recipientName}</div>
                    {address.line1 ? (
                      <div>
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ""}
                        {address.landmark ? `, ${address.landmark}` : ""}
                      </div>
                    ) : null}
                    <div>
                      {address.city}, {address.state} {address.postalCode}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {customer.can.reveal ? (
              <details className={styles.details}>
                <summary>Reveal fields</summary>
                <div>
                  <AdminActionForm
                    action={revealCustomerAction}
                    hidden={hidden}
                    submitLabel="Reveal for 10 minutes"
                    variant="secondary"
                  >
                    <fieldset className={styles.actionGroup}>
                      <legend>Fields you may reveal</legend>
                      {PII_FIELDS.filter((field) =>
                        customer.viewerGrantedFields.has(field),
                      ).map((field) => (
                        <div key={field} className={styles.inline}>
                          <input
                            type="checkbox"
                            id={`rv-${field}`}
                            name="fields"
                            value={field}
                          />
                          <label htmlFor={`rv-${field}`}>{field}</label>
                        </div>
                      ))}
                    </fieldset>
                    <TextareaField
                      id="rv-reason"
                      name="reason"
                      label="Why?"
                      required
                      maxLength={500}
                    />
                  </AdminActionForm>
                </div>
              </details>
            ) : (
              <p className={styles.muted}>
                You hold no active grant for this customer; ask an admin for
                one.
              </p>
            )}
          </section>
          <section className={styles.panel} aria-labelledby="customer-orders">
            <h2 id="customer-orders" className={styles.panelTitle}>
              Orders
            </h2>
            {customer.orders.length === 0 ? (
              <p className={styles.muted}>No orders.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Placed</th>
                      <th scope="col">Status</th>
                      <th scope="col" className={styles.num}>
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.orders.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <Link
                            href={routes.adminOrder(order.id)}
                            className={styles.rowLink}
                          >
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td>{formatDateTime(order.placedAt)}</td>
                        <td>
                          <StatusBadge
                            status={order.status as OrderStatus}
                            label={order.statusLabel}
                          />
                        </td>
                        <td className={styles.num}>
                          {formatINR(order.totalInPaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className={styles.panel} aria-labelledby="customer-grants">
            <h2 id="customer-grants" className={styles.panelTitle}>
              Grants and reveals
            </h2>
            {customer.grants.length === 0 ? (
              <p className={styles.muted}>No grants cover this customer.</p>
            ) : null}
            <ul className={styles.timeline}>
              {customer.grants.map((grant) => (
                <li key={grant.id} className={styles.timelineItem}>
                  <div className={styles.inline}>
                    <strong>{grant.granteeName}</strong>
                    <Badge tone={grant.active ? "good" : undefined}>
                      {grant.active
                        ? "active"
                        : grant.revokedAt
                          ? "revoked"
                          : "expired"}
                    </Badge>
                    <span>{grant.fields.join(", ")}</span>
                    <span className={styles.muted}>{grant.scope}</span>
                  </div>
                  <div>{grant.reason}</div>
                  <div className={styles.timelineMeta}>
                    By {grant.grantedByName} · until{" "}
                    {formatDateTime(grant.expiresAt)}
                    {grant.revokedAt
                      ? ` · revoked ${formatDateTime(grant.revokedAt)}`
                      : ""}
                  </div>
                  {customer.can.grant && grant.active ? (
                    <AdminActionForm
                      action={revokeGrantAction}
                      hidden={{ grantId: grant.id, customerId: customer.id }}
                      submitLabel="Revoke now"
                      variant="quiet"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
            {customer.reveals.length > 0 ? (
              <>
                <h3 className={styles.panelTitle}>Reveals</h3>
                <ul className={styles.timeline}>
                  {customer.reveals.map((reveal) => (
                    <li key={reveal.id} className={styles.timelineItem}>
                      <div>
                        <strong>{reveal.staffName}</strong> revealed{" "}
                        {reveal.fields.join(", ")}{" "}
                        {reveal.viaGrant ? "under a grant" : "as admin"}
                      </div>
                      <div>{reveal.reason}</div>
                      <div className={styles.timelineMeta}>
                        {formatDateTime(reveal.at)} · until{" "}
                        {formatDateTime(reveal.expiresAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        </div>
        <div className={styles.actions}>
          {customer.can.grant ? (
            <section className={styles.panel} aria-labelledby="customer-grant">
              <h2 id="customer-grant" className={styles.panelTitle}>
                Grant access to this customer
              </h2>
              <AdminActionForm
                action={issueGrantAction}
                hidden={{ customerId: customer.id }}
                submitLabel="Issue grant"
                variant="secondary"
              >
                <SelectField
                  id="g-grantee"
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
                        id={`g-${field}`}
                        name="fields"
                        value={field}
                      />
                      <label htmlFor={`g-${field}`}>{field}</label>
                    </div>
                  ))}
                </fieldset>
                <Field
                  id="g-hours"
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
                  id="g-reason"
                  name="reason"
                  label="Reason"
                  required
                  maxLength={500}
                />
                <p className={styles.muted}>
                  Admin only, with a fresh second factor. The owner inbox is
                  notified.
                </p>
              </AdminActionForm>
            </section>
          ) : null}
          <section className={styles.panel} aria-labelledby="customer-account">
            <h2 id="customer-account" className={styles.panelTitle}>
              Account
            </h2>
            {customer.can.resendVerification ? (
              <AdminActionForm
                action={resendVerificationAction}
                hidden={hidden}
                submitLabel="Resend verification email"
                variant="secondary"
              />
            ) : null}
            {customer.can.setRole ? (
              <details className={styles.details} data-danger="true">
                <summary>Change role</summary>
                <div>
                  <AdminActionForm
                    action={setRoleAction}
                    hidden={hidden}
                    submitLabel="Change role"
                    variant="secondary"
                  >
                    <SelectField
                      id="role-new"
                      name="role"
                      label="New role"
                      defaultValue={customer.role}
                      options={[
                        { value: "CUSTOMER", label: "Customer" },
                        { value: "STAFF", label: "Staff" },
                        { value: "ADMIN", label: "Admin" },
                      ]}
                      required
                    />
                    <TextareaField
                      id="role-reason"
                      name="reason"
                      label="Reason"
                      required
                      maxLength={500}
                    />
                    <Field
                      id="role-confirm"
                      name="confirmEmail"
                      label="Type the account's email address to confirm"
                      autoComplete="off"
                      required
                    />
                    <p className={styles.muted}>
                      Signs the account out everywhere and revokes its grants.
                      The last admin cannot be demoted. Admin only, with a fresh
                      second factor.
                    </p>
                  </AdminActionForm>
                </div>
              </details>
            ) : null}
            {customer.can.resetTwoFactor ? (
              <details className={styles.details} data-danger="true">
                <summary>Reset second factor</summary>
                <div>
                  <AdminActionForm
                    action={resetTwoFactorAction}
                    hidden={hidden}
                    submitLabel="Reset second factor"
                    variant="secondary"
                  >
                    <TextareaField
                      id="tf-reason"
                      name="reason"
                      label="Reason"
                      required
                      maxLength={500}
                    />
                    <p className={styles.muted}>
                      {customer.staffEnrolled
                        ? "Currently enrolled."
                        : "Not enrolled yet."}{" "}
                      They will set it up again at the next sign-in. Admin only,
                      with a fresh second factor.
                    </p>
                  </AdminActionForm>
                </div>
              </details>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
