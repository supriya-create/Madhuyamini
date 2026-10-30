import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Section } from "@/components/ui/Section";
import { craftsmanship } from "@/content/home";

import styles from "./Craftsmanship.module.css";

const NUMERALS = ["i", "ii", "iii"] as const;

export function Craftsmanship() {
  return (
    <Section labelledBy="craft-heading">
      <Container>
        <div className={styles.header}>
          <Eyebrow>{craftsmanship.eyebrow}</Eyebrow>
          <h2 id="craft-heading">{craftsmanship.heading}</h2>
        </div>
        <ol className={styles.list}>
          {craftsmanship.principles.map((principle, index) => (
            <li key={principle.title} className={styles.item}>
              <span aria-hidden="true" className={styles.numeral}>
                {NUMERALS[index]}
              </span>
              <h3 className={styles.title}>{principle.title}</h3>
              <p className={styles.body}>{principle.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
