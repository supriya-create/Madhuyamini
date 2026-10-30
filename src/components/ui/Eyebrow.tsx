import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

import styles from "./Eyebrow.module.css";

/** Small uppercase label above a heading. Use at most one per section. */
export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
  return <p className={cx(styles.eyebrow, className)} {...props} />;
}
