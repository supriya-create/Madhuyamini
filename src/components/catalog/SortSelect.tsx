"use client";

import type { ChangeEvent } from "react";

import { productSortValues } from "@/features/catalog/schemas";
import type { ProductSort } from "@/features/catalog/schemas";

import styles from "./ListingControls.module.css";

const sortLabels: Record<ProductSort, string> = {
  relevance: "Relevance",
  newest: "Newest",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
  title: "Name: A to Z",
};

type SortSelectProps = {
  value: ProductSort;
  /** Relevance is only offered when there is a search term. */
  hasQuery: boolean;
};

/**
 * Submits its form as soon as a choice is made. Without JavaScript the
 * "Apply" button still works, so nothing depends on this behaviour.
 */
export function SortSelect({ value, hasQuery }: SortSelectProps) {
  const options = productSortValues.filter(
    (sort) => sort !== "relevance" || hasQuery,
  );

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <label className={styles.sort}>
      <span className={styles.label}>Sort by</span>
      <select
        name="sort"
        defaultValue={value}
        onChange={handleChange}
        className={styles.select}
      >
        {options.map((sort) => (
          <option key={sort} value={sort}>
            {sortLabels[sort]}
          </option>
        ))}
      </select>
    </label>
  );
}
