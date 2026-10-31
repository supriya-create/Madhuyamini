import { resolveCatalog } from "@/components/catalog/resolve";
import { getCategoryBySlug } from "@/features/catalog/service";
import { routes } from "@/lib/routes";

/** See products/[slug]/layout.tsx: guarantees a 404 status for unknown categories. */
export default async function CollectionLayout({
  params,
  children,
}: LayoutProps<"/collections/[slug]">) {
  const { slug } = await params;
  await resolveCatalog(() => getCategoryBySlug(slug), routes.collections);
  return children;
}
