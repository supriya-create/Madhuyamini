import Image from "next/image";
import Link from "next/link";

import type { ProductSummary } from "@/features/catalog/types";
import { routes } from "@/lib/routes";

import { Price } from "./Price";
import { ProductImageFallback } from "./ProductImageFallback";
import styles from "./ProductCard.module.css";
import { TechniqueList } from "./TechniqueList";

type ProductCardProps = {
  product: ProductSummary;
  /** `sizes` for the image, matching the grid the card sits in. */
  sizes?: string;
  priority?: boolean;
};

export function ProductCard({
  product,
  sizes = "(min-width: 64em) 25vw, (min-width: 48em) 33vw, 50vw",
  priority = false,
}: ProductCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.media}>
        {product.image ? (
          <Image
            src={product.image.url}
            alt={product.image.alt}
            width={product.image.width}
            height={product.image.height}
            sizes={sizes}
            priority={priority}
            className={styles.image}
          />
        ) : (
          <ProductImageFallback title={product.title} />
        )}
      </div>
      <div className={styles.body}>
        <p className={styles.category}>{product.category.name}</p>
        <h3 className={styles.title}>
          <Link href={routes.product(product.slug)} className={styles.link}>
            {product.title}
          </Link>
        </h3>
        <TechniqueList techniques={product.techniques} />
        <p className={styles.meta}>
          <Price price={product.price} />
          {product.isOneOfAKind ? (
            <span className={styles.badge}>One of a kind</span>
          ) : null}
          {!product.inStock ? (
            <span className={styles.soldOut}>Sold out</span>
          ) : null}
        </p>
      </div>
    </article>
  );
}
