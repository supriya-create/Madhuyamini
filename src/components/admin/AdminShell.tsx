import Link from "next/link";
import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/layout/SkipLink";
import { site } from "@/content/site";
import { can } from "@/features/admin/authz";
import type { StaffContext } from "@/server/auth/staff";
import { routes } from "@/lib/routes";

import { AdminNav } from "./AdminNav";
import type { AdminNavItem } from "./AdminNav";
import styles from "./AdminShell.module.css";

/**
 * Chrome for the admin area: brand, navigation, who is signed in and how,
 * and a main landmark. Navigation items are added as each Phase 7 step
 * lands, so no link points at a page that does not exist.
 */

export const ADMIN_NAV: ReadonlyArray<AdminNavItem> = [
  { label: "Overview", href: routes.admin },
  { label: "Orders", href: routes.adminOrders },
  { label: "Payment review", href: routes.adminReview },
  { label: "Refunds", href: routes.adminRefunds },
  { label: "Operations", href: routes.adminOperations },
  { label: "Inventory", href: routes.adminInventory },
  { label: "Catalogue", href: routes.adminProducts },
  { label: "Customers", href: routes.adminCustomers },
  { label: "Reports", href: routes.adminReports },
  { label: "Audit", href: routes.adminAudit, capability: "audit.view" },
];

export function AdminShell({
  ctx,
  children,
}: {
  ctx: StaffContext;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <SkipLink />
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <Link href={routes.admin} className={styles.brand}>
            {site.name} <span className={styles.brandArea}>Admin</span>
          </Link>
          <div className={styles.identity}>
            <span>
              <span className={styles.role}>{ctx.role}</span> · {ctx.user.email}
            </span>
            <Link href={routes.home} className={styles.identityLink}>
              Storefront
            </Link>
            <Link href={routes.accountSecurity} className={styles.identityLink}>
              Your account
            </Link>
            <SignOutButton variant="quiet" />
          </div>
        </div>
        <AdminNav
          items={ADMIN_NAV.filter(
            (item) => !item.capability || can(ctx.role, item.capability),
          )}
        />
      </header>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className={styles.main}>
        {children}
      </main>
    </div>
  );
}

export function AdminPageHeader({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <h1 className={styles.title}>{title}</h1>
      {lede ? <p className={styles.lede}>{lede}</p> : null}
      {children}
    </header>
  );
}
