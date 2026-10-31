import type { Metadata } from "next";

import { CategoryChips } from "@/components/catalog/CategoryChips";
import { EmptyState } from "@/components/catalog/EmptyState";
import { ListingPage } from "@/components/catalog/ListingPage";
import { resolveCatalog } from "@/components/catalog/resolve";
import { getCategoryBySlug, listProducts } from "@/features/catalog/service";
import { pickListingParams } from "@/features/catalog/urls";
import { routes } from "@/lib/routes";

export async function generateMetadata({
  params,
}: PageProps<"/collections/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = await resolveCatalog(
    () => getCategoryBySlug(slug),
    routes.collections,
  );
  return {
    title: category.parent
      ? `${category.name} · ${category.parent.name}`
      : category.name,
    description:
      category.description ??
      `Madhubani-inspired ${category.name.toLowerCase()} from Madhuyamini.`,
  };
}

export default async function CollectionPage({
  params,
  searchParams,
}: PageProps<"/collections/[slug]">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const pathname = routes.collection(slug);

  const page = await resolveCatalog(
    () => listProducts({ category: slug, ...pickListingParams(query) }),
    pathname,
  );
  const category = page.category;
  if (!category) return null;

  const breadcrumbs = [
    { label: "Collections", href: routes.collections },
    ...(category.parent
      ? [
          {
            label: category.parent.name,
            href: routes.collection(category.parent.slug),
          },
        ]
      : []),
    { label: category.name },
  ];

  return (
    <ListingPage
      pathname={pathname}
      page={page}
      breadcrumbs={breadcrumbs}
      eyebrow={category.parent?.name}
      heading={category.name}
      intro={category.description ? <p>{category.description}</p> : undefined}
      aside={
        category.children.length > 0 ? (
          <CategoryChips
            label={`Browse ${category.name}`}
            categories={category.children}
          />
        ) : undefined
      }
      emptyState={
        <EmptyState
          heading="Nothing matches those filters"
          action={{ label: "Clear filters", href: pathname }}
        >
          <p>Try widening the price range or choosing a different technique.</p>
        </EmptyState>
      }
      nothingToShow={
        <EmptyState
          heading="Nothing here yet"
          action={{ label: "Browse all collections", href: routes.collections }}
        >
          <p>New pieces for {category.name.toLowerCase()} are on their way.</p>
        </EmptyState>
      }
    />
  );
}
