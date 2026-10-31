"use client";

import { useId, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import styles from "./Field.module.css";
import passwordStyles from "./PasswordField.module.css";

type PasswordFieldProps = Omit<
  ComponentProps<"input">,
  "id" | "name" | "type"
> & {
  id: string;
  name: string;
  label: string;
  hint?: ReactNode;
  error?: string;
};

/**
 * Password input with a show/hide toggle (WCAG 3.3.8). Paste is allowed and
 * `autocomplete` is passed through so password managers work.
 */
export function PasswordField({
  id,
  name,
  label,
  hint,
  error,
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const toggleId = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <div className={passwordStyles.wrap}>
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [hintId, errorId].filter(Boolean).join(" ") || undefined
          }
          className={styles.input}
          spellCheck={false}
          {...props}
        />
        <button
          type="button"
          id={toggleId}
          className={passwordStyles.toggle}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? "Hide" : "Show"}
          <span className="visually-hidden"> password</span>
        </button>
      </div>
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
