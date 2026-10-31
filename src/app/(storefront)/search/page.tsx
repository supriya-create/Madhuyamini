import type { Metadata } from "next";

import { Breadcrumbs } from "@/components/catalog/Breadcrumbs";
import { EmptyState } from "@/components/catalog/EmptyState";
import { ListingPage } from "@/components/catalog/ListingPage";
import { resolveCatalog } from "@/components/catalog/resolve";
import { SearchForm } from "@/components/catalog/SearchForm";
import { Container } from "@/components/ui/Container";
import { listProducts } from "@/features/catalog/service";
import { pickListingParams } from "@/features/catalog/urls";
import { routes } from "@/lib/routes";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const query = await searchParams;
  const params = pickListingParams(query);
  const hasTerm = typeof params.q === "string" && params.q.trim().length > 0;

  if (!hasTerm) return <SearchPrompt />;

  const page = await resolveCatalog(() => listProducts(params), routes.search);
  const term = page.filters.q ?? "";

  return (
    <ListingPage
      pathname={routes.search}
      page={page}
      breadcrumbs={[{ label: "Search" }]}
      heading={<>Results for &ldquo;{term}&rdquo;</>}
      aside={
        <SearchForm
          defaultValue={term}
          variant="prominent"
          id="search-page-input"
        />
      }
      hiddenParams={{ q: term }}
      emptyState={
        <EmptyState
          heading={`No results for “${term}”`}
          action={{ label: "Browse all collections", href: routes.collections }}
        >
          <p>
            Check the spelling, try a broader word such as “saree” or “print”,
            or browse by collection.
          </p>
        </EmptyState>
      }
    />
  );
}

/** No search term yet: invite one rather than listing the whole catalogue. */
function SearchPrompt() {
  return (
    <Container className={styles.prompt}>
      <Breadcrumbs items={[{ label: "Search" }]} />
      <h1 className={styles.heading}>Search</h1>
      <SearchForm variant="prominent" id="search-page-input" />
      <EmptyState
        heading="Start with a word or two"
        action={{ label: "Browse all collections", href: routes.collections }}
      >
        <p>
          Search by piece, motif or technique: fish, peacock, cushion,
          hand-painted.
        </p>
      </EmptyState>
    </Container>
  );
}
