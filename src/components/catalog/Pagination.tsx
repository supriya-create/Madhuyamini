import Link from "next/link";

import { paginationWindow } from "@/features/catalog/rules";
import type { ProductListFilters } from "@/features/catalog/types";
import { listingHref } from "@/features/catalog/urls";

import styles from "./Pagination.module.css";

type PaginationProps = {
  pathname: string;
  filters: ProductListFilters;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function Pagination({
  pathname,
  filters,
  page,
  pageSize,
  totalPages,
}: PaginationProps) {
  if (totalPages <= 1) return null;
  const href = (target: number) =>
    listingHref(pathname, filters, target, pageSize);

  return (
    <nav aria-label="Pagination" className={styles.pagination}>
      {page > 1 ? (
        <Link href={href(page - 1)} className={styles.step} rel="prev">
          Previous
        </Link>
      ) : (
        <span className={styles.stepDisabled} aria-hidden="true">
          Previous
        </span>
      )}
      <ol className={styles.pages}>
        {paginationWindow(page, totalPages).map((entry, index) =>
          entry === null ? (
            <li key={`gap-${index}`} className={styles.gap} aria-hidden="true">
              …
            </li>
          ) : (
            <li key={entry}>
              {entry === page ? (
                <span className={styles.current} aria-current="page">
                  <span className="visually-hidden">Page </span>
                  {entry}
                </span>
              ) : (
                <Link href={href(entry)} className={styles.page}>
                  <span className="visually-hidden">Page </span>
                  {entry}
                </Link>
              )}
            </li>
          ),
        )}
      </ol>
      {page < totalPages ? (
        <Link href={href(page + 1)} className={styles.step} rel="next">
          Next
        </Link>
      ) : (
        <span className={styles.stepDisabled} aria-hidden="true">
          Next
        </span>
      )}
    </nav>
  );
}
