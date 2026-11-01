"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./AccountShell.module.css";

type AccountNavProps = {
  items: ReadonlyArray<{ label: string; href: string }>;
};

export function AccountNav({ items }: AccountNavProps) {
  const pathname = usePathname();
  // The longest matching prefix is current, so a nested page (for example
  // /account/security/two-factor) highlights one item only.
  const currentHref = items
    .filter(
      (item) =>
        pathname === item.href ||
        (item.href !== "/account" && pathname.startsWith(`${item.href}/`)),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Account" className={styles.nav}>
      <ul className={styles.navList}>
        {items.map((item) => {
          const current = item.href === currentHref;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={styles.navLink}
                aria-current={current ? "page" : undefined}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
