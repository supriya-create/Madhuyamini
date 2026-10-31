import Image from "next/image";

import { FramedPanel } from "@/components/motifs/FramedPanel";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ImagePending } from "@/components/ui/ImagePending";
import { hero, heroImage } from "@/content/home";
import { isProduction } from "@/server/env";

import styles from "./Hero.module.css";

// Evaluated when the module loads during `next build`, so a production build
// fails before deployment rather than serving a placeholder (decision D2).
if (isProduction && heroImage === null) {
  throw new Error(
    "Hero image is missing: set heroImage in src/content/home.ts before a production build.",
  );
}

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
          {heroImage ? (
            <Image
              src={heroImage.url}
              alt={heroImage.alt}
              width={heroImage.width}
              height={heroImage.height}
              sizes="(min-width: 64em) 40vw, (min-width: 48em) 50vw, 100vw"
              priority
            />
          ) : (
            <ImagePending
              description={hero.imageDescription}
              aspect="portrait"
            />
          )}
        </FramedPanel>
      </Container>
    </section>
  );
}
