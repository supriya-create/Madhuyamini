import { ProductGrid } from "@/components/catalog/ProductGrid";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Section } from "@/components/ui/Section";
import { getFeaturedProducts } from "@/features/catalog/service";
import { routes } from "@/lib/routes";

import styles from "./FeaturedProducts.module.css";

/**
 * Admin-curated selection (`Product.isFeatured`). Never labelled
 * "best-selling": that needs real order data (Phase 8). Hidden when empty.
 */
export async function FeaturedProducts() {
  const products = await getFeaturedProducts(8);
  if (products.length === 0) return null;

  return (
    <Section labelledBy="featured-heading">
      <Container>
        <div className={styles.header}>
          <div>
            <Eyebrow>Featured</Eyebrow>
            <h2 id="featured-heading">Featured pieces</h2>
          </div>
          <ButtonLink href={routes.collections} variant="quiet">
            Browse all collections
          </ButtonLink>
        </div>
        <ProductGrid products={products} columns={4} />
      </Container>
    </Section>
  );
}
