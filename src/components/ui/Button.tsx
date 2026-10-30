import Link from "next/link";
import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "quiet";

type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant };

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles[variant], className)}
      {...props}
    />
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
};

/** A link styled as a button. Use for navigation; use `Button` for actions. */
export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={cx(styles.button, styles[variant], className)}
      {...props}
    />
  );
}
