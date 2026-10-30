"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { sans, serif } from "@/styles/fonts";

import "@/styles/reset.css";
import "@/styles/tokens.css";
import "@/styles/globals.css";

import styles from "./status-page.module.css";

type GlobalErrorProps = {
  error: unknown;
  retry: () => void;
};

/** Replaces the root layout when it fails, so it must render its own document. */
export default function GlobalError({ error, retry }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en-IN" className={`${serif.variable} ${sans.variable}`}>
      <body>
        <title>Something went wrong | Madhuyamini</title>
        <main>
          <Container width="narrow" className={styles.page}>
            <h1>Something went wrong</h1>
            <p className={styles.body}>
              We couldn’t load the site just now. Please try again in a moment.
            </p>
            <Button onClick={retry}>Try again</Button>
          </Container>
        </main>
      </body>
    </html>
  );
}
