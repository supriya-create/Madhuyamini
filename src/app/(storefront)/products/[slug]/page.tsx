import type { Metadata } from "next";

import { ProductDetails } from "@/components/catalog/ProductDetails";
import { resolveCatalog } from "@/components/catalog/resolve";
import {
  getProductBySlug,
  getRelatedProducts,
} from "@/features/catalog/service";
import { getSavedProductIds } from "@/features/wishlist/service";
import { routes } from "@/lib/routes";
import { getCurrentUser } from "@/server/auth/current-user";

export async function generateMetadata({
  params,
}: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await resolveCatalog(
    () => getProductBySlug(slug),
    routes.collections,
  );
  const image = product.images[0];
  return {
    title: product.seo.title,
    description: product.seo.description ?? undefined,
    openGraph: {
      type: "website",
      title: product.seo.title,
      description: product.seo.description ?? undefined,
      images: image
        ? [
            {
              url: image.url,
              width: image.width,
              height: image.height,
              alt: image.alt,
            },
          ]
        : undefined,
    },
  };
}

export default async function ProductPage({
  params,
}: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const product = await resolveCatalog(
    () => getProductBySlug(slug),
    routes.collections,
  );
  const [related, saved] = await Promise.all([
    getRelatedProducts(product, 4),
    getCurrentUser().then(getSavedProductIds),
  ]);

  return (
    <ProductDetails
      product={product}
      related={related}
      saved={saved.has(product.id)}
    />
  );
}
