import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

import styles from "./Field.module.css";

type FieldProps = Omit<ComponentProps<"input">, "id" | "name"> & {
  id: string;
  name: string;
  label: string;
  hint?: ReactNode;
  error?: string;
};

/** Labelled input with hint and error wired through aria-describedby. */
export function Field({
  id,
  name,
  label,
  hint,
  error,
  className,
  ...props
}: FieldProps) {
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
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [hintId, errorId].filter(Boolean).join(" ") || undefined
        }
        className={styles.input}
        {...props}
      />
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
