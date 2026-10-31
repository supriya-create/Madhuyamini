"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import styles from "./ListingControls.module.css";

/**
 * Collapsible filter panel. Rendered closed so phones see results first;
 * opens itself on wide screens, where it sits in its own column. Without
 * JavaScript the summary still toggles it.
 */
export function FilterDisclosure({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 64em)");
    const sync = () => {
      if (ref.current && wide.matches) ref.current.open = true;
    };
    sync();
    wide.addEventListener("change", sync);
    return () => wide.removeEventListener("change", sync);
  }, []);

  return (
    <details ref={ref} className={styles.filters}>
      <summary className={styles.summary}>Filters</summary>
      {children}
    </details>
  );
}
