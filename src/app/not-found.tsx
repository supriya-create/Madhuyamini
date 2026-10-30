import type { Metadata } from "next";

import { StorefrontShell } from "@/components/layout/StorefrontShell";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { routes } from "@/lib/routes";

import styles from "./status-page.module.css";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <StorefrontShell>
      <Container width="narrow" className={styles.page}>
        <p className={styles.code}>404</p>
        <h1>We couldn’t find that page</h1>
        <p className={styles.body}>
          The link may be out of date, or the page may have moved. Our
          collections and the story of the Madhubani tradition start from the
          homepage.
        </p>
        <ButtonLink href={routes.home}>Back to the homepage</ButtonLink>
      </Container>
    </StorefrontShell>
  );
}
