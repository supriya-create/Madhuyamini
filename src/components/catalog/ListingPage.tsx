import type { ReactNode } from "react";

import { Container } from "@/components/ui/Container";
import type { ProductPage } from "@/features/catalog/types";
import { listingHref } from "@/features/catalog/urls";

import type { Crumb } from "./Breadcrumbs";
import { Breadcrumbs } from "./Breadcrumbs";
import { ListingControls } from "./ListingControls";
import styles from "./ListingPage.module.css";
import { Pagination } from "./Pagination";
import { ProductGrid } from "./ProductGrid";

type ListingPageProps = {
  pathname: string;
  page: ProductPage;
  breadcrumbs: readonly Crumb[];
  eyebrow?: string;
  heading: ReactNode;
  intro?: ReactNode;
  /** Rendered under the heading: child-category links, search form, etc. */
  aside?: ReactNode;
  /** Hidden form fields carried through filter submissions (e.g. the search term). */
  hiddenParams?: Readonly<Record<string, string>>;
  emptyState: ReactNode;
  /** Shown when the whole scope has no products at all, before any filtering. */
  nothingToShow?: ReactNode;
};

export function ListingPage({
  pathname,
  page,
  breadcrumbs,
  eyebrow,
  heading,
  intro,
  aside,
  hiddenParams,
  emptyState,
  nothingToShow,
}: ListingPageProps) {
  const hasFilters =
    page.filters.techniques.length > 0 ||
    page.filters.minPriceInPaise !== null ||
    page.filters.maxPriceInPaise !== null ||
    page.filters.inStock;
  const scopeIsEmpty =
    page.total === 0 && !hasFilters && page.filters.q === null;
  const clearHref = listingHref(
    pathname,
    { q: page.filters.q, sort: page.filters.sort },
    1,
    page.pageSize,
  );
  const first = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const last = Math.min(page.page * page.pageSize, page.total);

  return (
    <Container className={styles.page}>
      <header className={styles.header}>
        <Breadcrumbs items={breadcrumbs} />
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <h1 className={styles.heading}>{heading}</h1>
        {intro ? <div className={styles.intro}>{intro}</div> : null}
        {aside}
      </header>

      {scopeIsEmpty && nothingToShow ? (
        nothingToShow
      ) : (
        <div className={styles.layout}>
          <aside className={styles.controls} aria-label="Refine results">
            <ListingControls
              action={pathname}
              filters={page.filters}
              availableTechniques={page.availableTechniques}
              hidden={hiddenParams}
              clearHref={clearHref}
            />
          </aside>

          <section className={styles.results} aria-labelledby="results-heading">
            <h2
              id="results-heading"
              className={styles.count}
              aria-live="polite"
            >
              {page.total === 0
                ? "No products"
                : page.total === 1
                  ? "1 product"
                  : `${page.total} products`}
              {page.total > page.pageSize ? (
                <span className={styles.range}>
                  {" "}
                  · showing {first}–{last}
                </span>
              ) : null}
            </h2>
            {page.items.length > 0 ? (
              <ProductGrid products={page.items} eagerCount={4} columns={3} />
            ) : (
              emptyState
            )}
            <Pagination
              pathname={pathname}
              filters={page.filters}
              page={page.page}
              pageSize={page.pageSize}
              totalPages={page.totalPages}
            />
          </section>
        </div>
      )}
    </Container>
  );
}
