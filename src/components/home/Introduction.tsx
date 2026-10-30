import { MotifDivider } from "@/components/motifs/MotifDivider";
import { Container } from "@/components/ui/Container";
import { Section } from "@/components/ui/Section";
import { introduction } from "@/content/home";

import styles from "./Introduction.module.css";

export function Introduction() {
  return (
    <Section surface="cream" labelledBy="introduction-heading">
      <Container width="narrow" className={styles.inner}>
        <MotifDivider width="short" />
        <h2 id="introduction-heading">{introduction.heading}</h2>
        <p className={styles.body}>{introduction.body}</p>
      </Container>
    </Section>
  );
}
