import { MotifDivider } from "@/components/motifs/MotifDivider";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Section } from "@/components/ui/Section";
import { heritage } from "@/content/home";

import styles from "./Heritage.module.css";

export const HERITAGE_SECTION_ID = "heritage";

export function Heritage() {
  return (
    <Section
      id={HERITAGE_SECTION_ID}
      surface="ink"
      labelledBy="heritage-heading"
    >
      <Container className={styles.grid}>
        <div className={styles.story}>
          <Eyebrow>{heritage.eyebrow}</Eyebrow>
          <h2 id="heritage-heading">{heritage.heading}</h2>
          {heritage.paragraphs.map((paragraph, index) => (
            // Static copy: order never changes, so the index is a stable key.
            <p key={index} className={styles.paragraph}>
              {paragraph}
            </p>
          ))}
        </div>

        <div className={styles.stylesPanel}>
          <h3 className={styles.stylesHeading}>{heritage.stylesHeading}</h3>
          <MotifDivider />
          <dl className={styles.list}>
            {heritage.styles.map((style) => (
              <div key={style.name} className={styles.item}>
                <dt className={styles.term}>
                  <span>{style.name}</span>
                  <span className={styles.meaning}>{style.meaning}</span>
                </dt>
                <dd className={styles.description}>{style.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </Section>
  );
}
