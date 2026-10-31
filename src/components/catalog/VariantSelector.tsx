"use client";

import { useId, useState } from "react";

import { findVariantForSelection } from "@/features/catalog/rules";
import type {
  ProductOptionDto,
  ProductVariantDto,
} from "@/features/catalog/types";

import { Availability } from "./Availability";
import { Price } from "./Price";
import styles from "./VariantSelector.module.css";

type VariantSelectorProps = {
  options: readonly ProductOptionDto[];
  variants: readonly ProductVariantDto[];
  isOneOfAKind: boolean;
};

function initialSelection(
  options: readonly ProductOptionDto[],
  variants: readonly ProductVariantDto[],
): Record<string, string> {
  const preferred =
    variants.find((variant) => variant.isPurchasable) ?? variants[0];
  const selection: Record<string, string> = {};
  if (!preferred) return selection;
  for (const option of options) {
    const match = option.values.find((value) =>
      preferred.optionValueIds.includes(value.id),
    );
    if (match) selection[option.id] = match.id;
  }
  return selection;
}

/**
 * Accessible option picker: one radio group per option. The matching
 * variant's price and availability are announced through a live region.
 */
export function VariantSelector({
  options,
  variants,
  isOneOfAKind,
}: VariantSelectorProps) {
  const [selection, setSelection] = useState(() =>
    initialSelection(options, variants),
  );
  const baseId = useId();

  const selectedIds = options.flatMap((option) => {
    const value = selection[option.id];
    return value ? [value] : [];
  });
  const variant = findVariantForSelection(
    variants,
    selectedIds,
    options.length,
  );

  const valueHasStock = (valueId: string) =>
    variants.some(
      (candidate) =>
        candidate.isPurchasable && candidate.optionValueIds.includes(valueId),
    );

  return (
    <div className={styles.selector}>
      {options.map((option) => (
        <fieldset key={option.id} className={styles.group}>
          <legend className={styles.legend}>{option.name}</legend>
          <div className={styles.values}>
            {option.values.map((value) => {
              const inputId = `${baseId}-${value.id}`;
              const inStock = valueHasStock(value.id);
              return (
                <div key={value.id} className={styles.value}>
                  <input
                    type="radio"
                    id={inputId}
                    name={`${baseId}-${option.id}`}
                    value={value.id}
                    checked={selection[option.id] === value.id}
                    onChange={() =>
                      setSelection((current) => ({
                        ...current,
                        [option.id]: value.id,
                      }))
                    }
                    className={styles.input}
                  />
                  <label
                    htmlFor={inputId}
                    className={styles.label}
                    data-sold-out={!inStock}
                  >
                    {value.value}
                    {!inStock ? (
                      <span className="visually-hidden"> (sold out)</span>
                    ) : null}
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className={styles.outcome} aria-live="polite" aria-atomic="true">
        {variant ? (
          <>
            <p className={styles.price}>
              <Price
                price={{
                  fromInPaise: variant.priceInPaise,
                  toInPaise: variant.priceInPaise,
                }}
                compareAtInPaise={variant.compareAtPriceInPaise}
              />
            </p>
            <Availability
              status={variant.stockStatus}
              available={variant.available}
              isOneOfAKind={isOneOfAKind}
            />
            <p className={styles.sku}>
              <span className={styles.skuLabel}>SKU</span> {variant.sku}
            </p>
          </>
        ) : (
          <p className={styles.unavailable}>
            This combination is not available.
          </p>
        )}
      </div>
    </div>
  );
}
