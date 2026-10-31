import Link from "next/link";

import { routes } from "@/lib/routes";

import styles from "./Breadcrumbs.module.css";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  const all: readonly Crumb[] = [
    { label: "Home", href: routes.home },
    ...items,
  ];
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumbs}>
      <ol className={styles.list}>
        {all.map((item, index) => {
          const isLast = index === all.length - 1;
          return (
            <li key={`${item.label}-${index}`} className={styles.item}>
              {item.href && !isLast ? (
                <Link href={item.href} className={styles.link}>
                  {item.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
