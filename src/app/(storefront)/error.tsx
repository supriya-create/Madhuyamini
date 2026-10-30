"use client";

import { useEffect } from "react";

import { Button, ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { routes } from "@/lib/routes";

import styles from "../status-page.module.css";

type ErrorPageProps = {
  error: unknown;
  retry: () => void;
};

export default function StorefrontError({ error, retry }: ErrorPageProps) {
  useEffect(() => {
    // Production builds receive only a digest here; details stay in server logs.
    // Phase 10 forwards this to the chosen error-monitoring service (D9).
    console.error(error);
  }, [error]);

  return (
    <Container width="narrow" className={styles.page}>
      <h1>Something went wrong</h1>
      <p className={styles.body}>
        This page didn’t load properly. Please try again. If it keeps happening,
        the homepage is still available.
      </p>
      <div className={styles.actions}>
        <Button onClick={retry}>Try again</Button>
        <ButtonLink href={routes.home} variant="secondary">
          Go to the homepage
        </ButtonLink>
      </div>
    </Container>
  );
}
