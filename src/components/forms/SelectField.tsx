import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

import styles from "./Field.module.css";

type SelectFieldProps = Omit<ComponentProps<"select">, "id" | "name"> & {
  id: string;
  name: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** Shown first with an empty value. */
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
};

/** Labelled native select; the label is linked, never wrapping, so the value stays out of its name. */
export function SelectField({
  id,
  name,
  label,
  options,
  placeholder,
  hint,
  error,
  className,
  ...props
}: SelectFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hintId, errorId].filter(Boolean).join(" ") || undefined
        }
        className={styles.input}
        {...props}
      >
        {placeholder !== undefined ? (
          <option value="">{placeholder}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
