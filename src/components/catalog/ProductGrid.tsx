import type { ReactNode } from "react";

import type { ProductSummary } from "@/features/catalog/types";

import { ProductCard } from "./ProductCard";
import styles from "./ProductGrid.module.css";

type ProductGridProps = {
  products: readonly ProductSummary[];
  /** How many cards sit above the fold and should load eagerly. */
  eagerCount?: number;
  columns?: 3 | 4;
  /** Controls rendered under each card (for example a wishlist remove button). */
  actions?: (product: ProductSummary) => ReactNode;
};

export function ProductGrid({
  products,
  eagerCount = 0,
  columns = 4,
  actions,
}: ProductGridProps) {
  return (
    <ul className={styles.grid} data-columns={columns}>
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} priority={index < eagerCount} />
          {actions ? (
            <div className={styles.actions}>{actions(product)}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
