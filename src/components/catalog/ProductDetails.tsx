import { AddToCartForm } from "@/components/cart/AddToCartForm";
import { WishlistToggle } from "@/components/cart/WishlistToggle";
import { MotifDivider } from "@/components/motifs/MotifDivider";
import { Container } from "@/components/ui/Container";
import {
  constructionMethodLabels,
  techniqueLabels,
} from "@/features/catalog/labels";
import type { ProductDetail, ProductSummary } from "@/features/catalog/types";
import { routes } from "@/lib/routes";

import { Availability } from "./Availability";
import { Breadcrumbs } from "./Breadcrumbs";
import { Price } from "./Price";
import styles from "./ProductDetails.module.css";
import { ProductGallery } from "./ProductGallery";
import { ProductGrid } from "./ProductGrid";
import { ProductImageFallback } from "./ProductImageFallback";
import { TechniqueList } from "./TechniqueList";
import { VariantSelector } from "./VariantSelector";

type ProductDetailsProps = {
  product: ProductDetail;
  related: readonly ProductSummary[];
  /** Whether the signed-in customer has saved this product (false for guests). */
  saved?: boolean;
};

export function ProductDetails({
  product,
  related,
  saved = false,
}: ProductDetailsProps) {
  const singleVariant =
    product.options.length === 0 ? product.variants[0] : undefined;

  return (
    <>
      <Container className={styles.page}>
        <Breadcrumbs
          items={[
            { label: "Collections", href: routes.collections },
            {
              label: product.category.name,
              href: routes.collection(product.category.slug),
            },
            { label: product.title },
          ]}
        />

        <div className={styles.layout}>
          <div className={styles.media}>
            {product.images.length > 0 ? (
              <ProductGallery images={product.images} title={product.title} />
            ) : (
              <ProductImageFallback title={product.title} />
            )}
          </div>

          <div className={styles.details}>
            <p className={styles.eyebrow}>
              <TechniqueList techniques={product.techniques} />
            </p>
            <h1 className={styles.title}>{product.title}</h1>
            {product.subtitle ? (
              <p className={styles.subtitle}>{product.subtitle}</p>
            ) : null}
            {product.isOneOfAKind ? (
              <p className={styles.oneOfAKind}>
                One of a kind: a single original, sold once.
              </p>
            ) : null}

            {singleVariant ? (
              <div className={styles.purchase}>
                <p className={styles.price}>
                  <Price
                    price={{
                      fromInPaise: singleVariant.priceInPaise,
                      toInPaise: singleVariant.priceInPaise,
                    }}
                    compareAtInPaise={singleVariant.compareAtPriceInPaise}
                  />
                </p>
                <Availability
                  status={singleVariant.stockStatus}
                  available={singleVariant.available}
                  isOneOfAKind={product.isOneOfAKind}
                />
                <p className={styles.sku}>
                  <span className={styles.skuLabel}>SKU</span>{" "}
                  {singleVariant.sku}
                </p>
                <AddToCartForm
                  variantId={singleVariant.id}
                  maxQuantity={
                    product.isOneOfAKind
                      ? Math.min(1, singleVariant.available)
                      : singleVariant.available
                  }
                  disabled={!singleVariant.isPurchasable}
                />
              </div>
            ) : product.variants.length > 0 ? (
              <div className={styles.purchase}>
                <VariantSelector
                  options={product.options}
                  variants={product.variants}
                  isOneOfAKind={product.isOneOfAKind}
                />
              </div>
            ) : (
              <p className={styles.unavailable}>
                This piece is not currently available.
              </p>
            )}

            <div className={styles.wishlist}>
              <WishlistToggle
                productId={product.id}
                productTitle={product.title}
                saved={saved}
                returnTo={routes.product(product.slug)}
                variant="button"
              />
            </div>

            <section
              className={styles.section}
              aria-labelledby="product-description"
            >
              <h2 id="product-description" className={styles.sectionTitle}>
                About this piece
              </h2>
              <p className={styles.description}>{product.description}</p>
            </section>

            <section
              className={styles.section}
              aria-labelledby="product-making"
            >
              <h2 id="product-making" className={styles.sectionTitle}>
                How it is made
              </h2>
              <dl className={styles.facts}>
                <div className={styles.fact}>
                  <dt>Technique</dt>
                  <dd>
                    {product.techniques
                      .map((t) => techniqueLabels[t])
                      .join(", ")}
                  </dd>
                </div>
                {product.constructionMethods.length > 0 ? (
                  <div className={styles.fact}>
                    <dt>Construction</dt>
                    <dd>
                      {product.constructionMethods
                        .map((method) => constructionMethodLabels[method])
                        .join(", ")}
                    </dd>
                  </div>
                ) : null}
                {product.material ? (
                  <div className={styles.fact}>
                    <dt>Material</dt>
                    <dd>{product.material}</dd>
                  </div>
                ) : null}
                {product.careInstructions ? (
                  <div className={styles.fact}>
                    <dt>Care</dt>
                    <dd>{product.careInstructions}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </div>
        </div>
      </Container>

      {related.length > 0 ? (
        <section className={styles.related} aria-labelledby="related-heading">
          <Container>
            <MotifDivider />
            <h2 id="related-heading" className={styles.relatedTitle}>
              You may also like
            </h2>
            <ProductGrid products={related} columns={4} />
          </Container>
        </section>
      ) : null}
    </>
  );
}
