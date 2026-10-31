import type { Technique } from "@/generated/prisma/enums";
import { techniqueLabels } from "@/features/catalog/labels";
import type { ProductListFilters } from "@/features/catalog/types";

import { FilterDisclosure } from "./FilterDisclosure";
import styles from "./ListingControls.module.css";
import { SortSelect } from "./SortSelect";

type ListingControlsProps = {
  /** Path the form submits to (the current listing page). */
  action: string;
  filters: ProductListFilters;
  availableTechniques: readonly Technique[];
  /** Hidden fields to carry through, e.g. the search term on the search page. */
  hidden?: Readonly<Record<string, string>>;
  /** Where "Clear filters" goes. */
  clearHref: string;
};

const rupees = (paise: number | null) =>
  paise === null ? "" : String(Math.floor(paise / 100));

/**
 * Plain GET form: every control works without JavaScript and every state is
 * a shareable URL. Sorting auto-submits when JavaScript is available.
 */
export function ListingControls({
  action,
  filters,
  availableTechniques,
  hidden = {},
  clearHref,
}: ListingControlsProps) {
  const hasActiveFilters =
    filters.techniques.length > 0 ||
    filters.minPriceInPaise !== null ||
    filters.maxPriceInPaise !== null ||
    filters.inStock;

  return (
    <form
      method="get"
      action={action}
      className={styles.form}
      aria-label="Filter and sort products"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <FilterDisclosure>
        {availableTechniques.length > 0 ? (
          <fieldset className={styles.group}>
            <legend className={styles.legend}>Technique</legend>
            <ul className={styles.choices}>
              {availableTechniques.map((technique) => (
                <li key={technique}>
                  <label className={styles.choice}>
                    <input
                      type="checkbox"
                      name="technique"
                      value={technique}
                      defaultChecked={filters.techniques.includes(technique)}
                    />
                    <span>{techniqueLabels[technique]}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Price (₹)</legend>
          <div className={styles.range}>
            <label className={styles.field}>
              <span className={styles.label}>From</span>
              <input
                type="number"
                name="minPrice"
                inputMode="numeric"
                min={0}
                step={1}
                defaultValue={rupees(filters.minPriceInPaise)}
                className={styles.input}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>To</span>
              <input
                type="number"
                name="maxPrice"
                inputMode="numeric"
                min={0}
                step={1}
                defaultValue={rupees(filters.maxPriceInPaise)}
                className={styles.input}
              />
            </label>
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>Availability</legend>
          <label className={styles.choice}>
            <input
              type="checkbox"
              name="inStock"
              value="1"
              defaultChecked={filters.inStock}
            />
            <span>In stock only</span>
          </label>
        </fieldset>
      </FilterDisclosure>

      <div className={styles.bar}>
        <SortSelect value={filters.sort} hasQuery={filters.q !== null} />
        <div className={styles.actions}>
          <button type="submit" className={styles.apply}>
            Apply
          </button>
          {hasActiveFilters ? (
            <a href={clearHref} className={styles.clear}>
              Clear filters
            </a>
          ) : null}
        </div>
      </div>
    </form>
  );
}
