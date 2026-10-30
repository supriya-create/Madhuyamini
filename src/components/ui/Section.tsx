import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

import styles from "./Section.module.css";

export type Surface = "ivory" | "cream" | "ink";

type SectionProps = ComponentProps<"section"> & {
  surface?: Surface;
  /** id of the section's heading, so the region is announced by name. */
  labelledBy: string;
};

export function Section({
  surface = "ivory",
  labelledBy,
  className,
  ...props
}: SectionProps) {
  return (
    <section
      data-surface={surface}
      aria-labelledby={labelledBy}
      className={cx(styles.section, className)}
      {...props}
    />
  );
}
