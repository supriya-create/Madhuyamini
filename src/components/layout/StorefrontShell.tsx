import type { ReactNode } from "react";

import { site } from "@/content/site";

import { AnnouncementBar } from "./AnnouncementBar";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { MAIN_CONTENT_ID, SkipLink } from "./SkipLink";

/**
 * Storefront chrome. Used by the (storefront) layout and by the root
 * not-found page, which renders outside that route group.
 */
export function StorefrontShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      {site.announcement ? (
        <AnnouncementBar announcement={site.announcement} />
      ) : null}
      <Header />
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </>
  );
}
