import type { ReactNode } from "react";

import { MotifDivider } from "@/components/motifs/MotifDivider";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { hero } from "@/content/home";
import { site } from "@/content/site";

import styles from "./SignInPage.module.css";

export type SignInNotice = {
  readonly message: string;
  readonly tone: "success" | "warning";
};

type SignInPageProps = {
  notice?: SignInNotice | null;
  children: ReactNode;
};

/** What an account already does today; nothing here promises a future feature. */
const ACCOUNT_BENEFITS = [
  "Follow your orders and returns in one place",
  "Keep your addresses for a quicker checkout",
  "Save pieces to your wishlist",
] as const;

/**
 * The customer sign-in page: a Madhubani-framed brand panel beside the form on
 * wide screens, the form first on small ones. The brand panel is
 * complementary content with no controls, so its visual position never
 * changes the focus order.
 */
export function SignInPage({ notice, children }: SignInPageProps) {
  return (
    <Container className={styles.page}>
      <div className={styles.layout}>
        <aside
          className={styles.brand}
          aria-labelledby="sign-in-brand"
          data-surface="cream"
        >
          <div className={styles.brandInner}>
            <Eyebrow className={styles.eyebrow}>{hero.eyebrow}</Eyebrow>
            <p id="sign-in-brand" className={styles.wordmark}>
              {site.name}
            </p>
            <div className={styles.rule}>
              <MotifDivider />
            </div>
            <p className={styles.statement}>{site.description}</p>
            <ul className={styles.benefits} aria-label="With an account">
              {ACCOUNT_BENEFITS.map((benefit) => (
                <li key={benefit}>{benefit}</li>
              ))}
            </ul>
          </div>
        </aside>

        <section className={styles.panel} aria-labelledby="sign-in-heading">
          <div className={styles.panelHeader}>
            <MotifDivider width="short" className={styles.panelRule} />
            <h1 id="sign-in-heading" className={styles.title}>
              Welcome back
            </h1>
            <p className={styles.intro}>
              Sign in to your {site.name} account to continue.
            </p>
          </div>
          {notice ? (
            <p role="status" className={styles.notice} data-tone={notice.tone}>
              {notice.message}
            </p>
          ) : null}
          {children}
        </section>
      </div>
    </Container>
  );
}
