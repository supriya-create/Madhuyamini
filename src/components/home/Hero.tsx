import { FramedPanel } from "@/components/motifs/FramedPanel";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ImagePending } from "@/components/ui/ImagePending";
import { hero } from "@/content/home";

import styles from "./Hero.module.css";

export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className={styles.hero}>
      <Container className={styles.grid}>
        <div className={styles.copy}>
          <Eyebrow>{hero.eyebrow}</Eyebrow>
          <h1 id="hero-heading" className={styles.heading}>
            {hero.heading}
          </h1>
          <p className={styles.lead}>{hero.lead}</p>
          <div className={styles.actions}>
            <ButtonLink href={hero.primaryAction.href}>
              {hero.primaryAction.label}
            </ButtonLink>
            <ButtonLink href={hero.secondaryAction.href} variant="quiet">
              {hero.secondaryAction.label}
            </ButtonLink>
          </div>
        </div>
        <FramedPanel className={styles.media}>
          <ImagePending description={hero.imageDescription} aspect="portrait" />
        </FramedPanel>
      </Container>
    </section>
  );
}
