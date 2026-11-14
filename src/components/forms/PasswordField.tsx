"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import type { ComponentProps, ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { cx } from "@/lib/cx";

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
  /**
   * `default` places the toggle beside the input; `inset` places it inside
   * the input's box with an eye icon. Both keep the same accessible name.
   */
  variant?: "default" | "inset";
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
  variant = "default",
  ...props
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const toggleId = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const inset = variant === "inset";

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
      <div
        className={cx(passwordStyles.wrap, inset && passwordStyles.insetWrap)}
      >
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            [hintId, errorId].filter(Boolean).join(" ") || undefined
          }
          className={cx(styles.input, inset && passwordStyles.insetInput)}
          spellCheck={false}
          {...props}
        />
        <button
          type="button"
          id={toggleId}
          className={cx(
            passwordStyles.toggle,
            inset && passwordStyles.insetToggle,
          )}
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((current) => !current)}
        >
          {inset ? <Icon icon={visible ? EyeOff : Eye} size={16} /> : null}
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
