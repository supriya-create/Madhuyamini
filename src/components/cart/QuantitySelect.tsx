"use client";

import type { ChangeEvent } from "react";

import styles from "./CartLine.module.css";

type QuantitySelectProps = {
  name: string;
  value: number;
  max: number;
  available: number;
  label: string;
};

/** Submits its form on change; a noscript "Update" button covers the rest. */
export function QuantitySelect({
  name,
  value,
  max,
  available,
  label,
}: QuantitySelectProps) {
  const options = Array.from(
    { length: Math.max(1, Math.min(max, 10)) },
    (_, i) => i + 1,
  );
  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    event.currentTarget.form?.requestSubmit();
  }
  return (
    <span className={styles.quantity}>
      <select
        name={name}
        aria-label={label}
        defaultValue={String(value)}
        onChange={handleChange}
        className={styles.select}
      >
        {options.map((option) => (
          <option key={option} value={option} disabled={option > available}>
            {option}
            {option > available ? " (not available)" : ""}
          </option>
        ))}
        {value > max ? (
          <option value={value} disabled>
            {value} (not available)
          </option>
        ) : null}
      </select>
    </span>
  );
}
