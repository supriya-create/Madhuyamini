import type { ComponentProps, ReactNode } from "react";

import { cx } from "@/lib/cx";

import styles from "./Field.module.css";

type TextareaFieldProps = Omit<ComponentProps<"textarea">, "id" | "name"> & {
  id: string;
  name: string;
  label: string;
  hint?: ReactNode;
  error?: string;
};

/** Labelled textarea with hint and error wired through aria-describedby. */
export function TextareaField({
  id,
  name,
  label,
  hint,
  error,
  className,
  rows = 3,
  ...props
}: TextareaFieldProps) {
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
      <textarea
        id={id}
        name={name}
        rows={rows}
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
