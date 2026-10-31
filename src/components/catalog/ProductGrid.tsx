import type { ProductSummary } from "@/features/catalog/types";

import { ProductCard } from "./ProductCard";
import styles from "./ProductGrid.module.css";

type ProductGridProps = {
  products: readonly ProductSummary[];
  /** How many cards sit above the fold and should load eagerly. */
  eagerCount?: number;
  columns?: 3 | 4;
};

export function ProductGrid({
  products,
  eagerCount = 0,
  columns = 4,
}: ProductGridProps) {
  return (
    <ul className={styles.grid} data-columns={columns}>
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard product={product} priority={index < eagerCount} />
        </li>
      ))}
    </ul>
  );
}
