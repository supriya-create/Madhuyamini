import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AnnouncementBar } from "@/components/layout/AnnouncementBar";
import { FramedPanel } from "@/components/motifs/FramedPanel";
import { MotifDivider } from "@/components/motifs/MotifDivider";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ImagePending } from "@/components/ui/ImagePending";
import { Section } from "@/components/ui/Section";
import { formatINR } from "@/lib/money";
import { isProduction } from "@/server/env";

import styles from "./page.module.css";

/**
 * Development-only specimen for design sign-off (docs/design-system.md).
 * Returns 404 in production.
 */

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

const swatches = [
  { token: "--color-ivory", hex: "#FBF7EF", role: "Page background" },
  { token: "--color-cream", hex: "#F4ECDD", role: "Alternate background" },
  {
    token: "--color-sand",
    hex: "#E7DAC2",
    role: "Decorative surfaces, hairlines",
  },
  { token: "--color-ink", hex: "#231A15", role: "Text 15.98:1 · dark panels" },
  { token: "--color-umber", hex: "#5A4335", role: "Secondary text 8.59:1" },
  { token: "--color-muted", hex: "#6E5A4A", role: "Tertiary text 6.10:1" },
  { token: "--color-sindoor", hex: "#9B2D20", role: "Brand red 7.04:1" },
  {
    token: "--color-sindoor-deep",
    hex: "#7A2118",
    role: "Hover, pressed 9.55:1",
  },
  {
    token: "--color-terracotta",
    hex: "#B4583A",
    role: "Large text, ornament 4.47:1",
  },
  {
    token: "--color-gold",
    hex: "#B08D3E",
    role: "Ornament only on light (2.92:1)",
  },
  {
    token: "--color-gold-text",
    hex: "#7A5F22",
    role: "Gold-toned text 5.64:1",
  },
  { token: "--color-leaf", hex: "#3D5A3A", role: "Success 7.22:1" },
  { token: "--color-indigo", hex: "#2E3E5C", role: "Information 10.03:1" },
  {
    token: "--color-error",
    hex: "#B42318",
    role: "Error 6.15:1 (with icon + text)",
  },
  { token: "--color-warning", hex: "#8A5300", role: "Warning 5.92:1" },
  {
    token: "--color-border-strong",
    hex: "#8C7862",
    role: "Control borders 3.95:1",
  },
] as const;

const typeScale = [
  { token: "--text-4xl", sample: "Madhubani, in every thread", serif: true },
  {
    token: "--text-3xl",
    sample: "A painted language from Mithila",
    serif: true,
  },
  { token: "--text-2xl", sample: "Kohbar, the marriage painting", serif: true },
  { token: "--text-xl", sample: "Hand-painted tussar silk saree", serif: true },
  {
    token: "--text-lg",
    sample: "Lead paragraph and product price text.",
    serif: false,
  },
  {
    token: "--text-base",
    sample: "Body copy for descriptions, forms and navigation.",
    serif: false,
  },
  {
    token: "--text-sm",
    sample: "Metadata, captions and helper text.",
    serif: false,
  },
] as const;

const prices = [0, 49_900, 149_950, 14_999_900] as const;

export default function DesignSystemPage() {
  if (isProduction) notFound();

  return (
    <main className={styles.page}>
      <Container>
        <header className={styles.intro}>
          <Eyebrow>Internal · development only</Eyebrow>
          <h1>Madhuyamini design system</h1>
          <p>Specimen for sign-off. Source of truth: docs/design-system.md.</p>
        </header>
      </Container>

      <Section labelledBy="ds-colour">
        <Container>
          <h2 id="ds-colour" className={styles.sectionTitle}>
            Colour
          </h2>
          <ul className={styles.swatches}>
            {swatches.map((swatch) => (
              <li key={swatch.token} className={styles.swatch}>
                <span className={styles.chip} data-token={swatch.token} />
                <code>{swatch.token}</code>
                <span className={styles.hex}>{swatch.hex}</span>
                <span className={styles.role}>{swatch.role}</span>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section surface="cream" labelledBy="ds-type">
        <Container>
          <h2 id="ds-type" className={styles.sectionTitle}>
            Typography
          </h2>
          <p className={styles.note}>
            Headings: Cormorant Garamond 500/600. Text and UI: Mukta
            400/500/600.
          </p>
          <ul className={styles.typeList}>
            {typeScale.map((step) => (
              <li key={step.token} className={styles.typeRow}>
                <code>{step.token}</code>
                <span
                  className={styles.typeSample}
                  data-step={step.token}
                  data-serif={step.serif}
                >
                  {step.sample}
                </span>
              </li>
            ))}
          </ul>
          <h3 className={styles.subTitle}>
            Prices (Mukta, Indian digit grouping)
          </h3>
          <ul className={styles.prices}>
            {prices.map((paise) => (
              <li key={paise}>
                <code>{paise} paise</code> → <strong>{formatINR(paise)}</strong>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      <Section labelledBy="ds-controls">
        <Container>
          <h2 id="ds-controls" className={styles.sectionTitle}>
            Controls
          </h2>
          <div className={styles.row}>
            <Button>Primary action</Button>
            <Button variant="secondary">Secondary action</Button>
            <Button variant="quiet">Quiet action</Button>
            <Button disabled>Disabled</Button>
            <ButtonLink href="/">Link as button</ButtonLink>
          </div>
        </Container>
      </Section>

      <Section surface="ink" labelledBy="ds-dark">
        <Container>
          <h2 id="ds-dark" className={styles.sectionTitle}>
            Dark surface
          </h2>
          <p className={styles.note}>
            Ivory text, sand secondary text, gold ornament.
          </p>
          <MotifDivider />
          <div className={styles.row}>
            <Button>Primary action</Button>
            <Button variant="secondary">Secondary action</Button>
            <Button variant="quiet">Quiet action</Button>
          </div>
        </Container>
      </Section>

      <Section labelledBy="ds-ornament">
        <Container>
          <h2 id="ds-ornament" className={styles.sectionTitle}>
            Ornament and placeholders
          </h2>
          <div className={styles.ornamentGrid}>
            <div className={styles.stack}>
              <MotifDivider />
              <MotifDivider width="short" />
            </div>
            <FramedPanel caption="FramedPanel around an ImagePending placeholder">
              <ImagePending
                description="Example: product detail in daylight"
                aspect="landscape"
              />
            </FramedPanel>
          </div>
          <h3 className={styles.subTitle}>
            Announcement bar (sample text, not live)
          </h3>
          <AnnouncementBar
            announcement={{ message: "Sample announcement for layout review" }}
          />
        </Container>
      </Section>
    </main>
  );
}
