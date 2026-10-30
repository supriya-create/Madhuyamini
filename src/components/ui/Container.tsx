import type { ComponentProps } from "react";

import { cx } from "@/lib/cx";

import styles from "./Container.module.css";

type ContainerProps = ComponentProps<"div"> & { width?: "content" | "narrow" };

/** Centres content with the site's fluid gutters and maximum line length. */
export function Container({
  width = "content",
  className,
  ...props
}: ContainerProps) {
  return (
    <div
      className={cx(styles.container, styles[width], className)}
      {...props}
    />
  );
}
