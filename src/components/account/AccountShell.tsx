import type { ReactNode } from "react";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { Container } from "@/components/ui/Container";
import type { CurrentUser } from "@/server/auth/current-user";
import { routes } from "@/lib/routes";

import { AccountNav } from "./AccountNav";
import styles from "./AccountShell.module.css";

type AccountShellProps = {
  user: CurrentUser;
  title: string;
  children: ReactNode;
};

export function AccountShell({ user, title, children }: AccountShellProps) {
  return (
    <Container className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Your account</p>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>{title}</h1>
          <SignOutButton />
        </div>
        <p className={styles.identity}>
          {user.name} · {user.email}
        </p>
      </header>
      <div className={styles.layout}>
        <AccountNav
          items={[
            { label: "Overview", href: routes.account },
            { label: "Orders", href: routes.accountOrders },
            { label: "Your details", href: routes.accountProfile },
            { label: "Addresses", href: routes.accountAddresses },
            { label: "Wishlist", href: routes.accountWishlist },
            { label: "Password and devices", href: routes.accountSecurity },
          ]}
        />
        <section className={styles.content} aria-label={title}>
          {children}
        </section>
      </div>
    </Container>
  );
}
