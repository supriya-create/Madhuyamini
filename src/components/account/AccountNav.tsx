"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "./AccountShell.module.css";

type AccountNavProps = {
  items: ReadonlyArray<{ label: string; href: string }>;
};

export function AccountNav({ items }: AccountNavProps) {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className={styles.nav}>
      <ul className={styles.navList}>
        {items.map((item) => {
          const current =
            item.href === "/account"
              ? pathname === item.href
              : pathname.startsWith(item.href);
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
