import type { ReactNode } from "react";

import { ButtonLink } from "@/components/ui/Button";
import { MotifDivider } from "@/components/motifs/MotifDivider";

import styles from "./EmptyState.module.css";

type EmptyStateProps = {
  heading: string;
  children: ReactNode;
  action?: { label: string; href: string };
};

export function EmptyState({ heading, children, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <MotifDivider width="short" />
      <h2 className={styles.heading}>{heading}</h2>
      <div className={styles.body}>{children}</div>
      {action ? (
        <ButtonLink href={action.href} variant="secondary">
          {action.label}
        </ButtonLink>
      ) : null}
    </div>
  );
}
