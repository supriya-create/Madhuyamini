import Link from "next/link";

import type { CategorySummary } from "@/features/catalog/types";
import { routes } from "@/lib/routes";

import styles from "./CategoryChips.module.css";

type CategoryChipsProps = {
  label: string;
  categories: readonly CategorySummary[];
  currentSlug?: string;
};

/** Links to sub-categories (or siblings), as a labelled navigation list. */
export function CategoryChips({
  label,
  categories,
  currentSlug,
}: CategoryChipsProps) {
  if (categories.length === 0) return null;
  return (
    <nav aria-label={label} className={styles.chips}>
      <ul className={styles.list}>
        {categories.map((category) => (
          <li key={category.id}>
            <Link
              href={routes.collection(category.slug)}
              className={styles.chip}
              aria-current={category.slug === currentSlug ? "page" : undefined}
            >
              {category.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
