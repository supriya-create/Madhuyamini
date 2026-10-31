import type { ReactNode } from "react";

import { MotifDivider } from "@/components/motifs/MotifDivider";
import { Container } from "@/components/ui/Container";

import styles from "./AuthPage.module.css";

type AuthPageProps = {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
};

/** Narrow, centred layout shared by sign-in, registration and password pages. */
export function AuthPage({ title, intro, children }: AuthPageProps) {
  return (
    <Container width="narrow" className={styles.page}>
      <MotifDivider width="short" />
      <h1 className={styles.title}>{title}</h1>
      {intro ? <div className={styles.intro}>{intro}</div> : null}
      {children}
    </Container>
  );
}
