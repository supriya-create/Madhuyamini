import { resolveCatalog } from "@/components/catalog/resolve";
import { getProductBySlug } from "@/features/catalog/service";
import { routes } from "@/lib/routes";

/**
 * Resolves the product above the page's Suspense boundary (loading.tsx), so an
 * unknown or hidden slug returns a real 404 status instead of a streamed 200.
 * The lookup is memoised per request; the page reuses it.
 */
export default async function ProductLayout({
  params,
  children,
}: LayoutProps<"/products/[slug]">) {
  const { slug } = await params;
  await resolveCatalog(() => getProductBySlug(slug), routes.collections);
  return children;
}
