"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Capability } from "@/features/admin/capabilities";

import styles from "./AdminShell.module.css";

export type AdminNavItem = {
  readonly label: string;
  readonly href: string;
  /** Shown only when the viewer holds this capability. */
  readonly capability?: Capability;
};

export function AdminNav({ items }: { items: ReadonlyArray<AdminNavItem> }) {
  const pathname = usePathname();
  const currentHref = items
    .filter(
      (item) =>
        pathname === item.href ||
        (item.href !== "/admin" && pathname.startsWith(`${item.href}/`)),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Admin">
      <ul className={styles.navList}>
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={styles.navLink}
              aria-current={item.href === currentHref ? "page" : undefined}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
