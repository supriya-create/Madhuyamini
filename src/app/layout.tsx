import type { Metadata, Viewport } from "next";

import { site } from "@/content/site";
import { env, isProduction } from "@/server/env";
import { sans, serif } from "@/styles/fonts";

import "@/styles/reset.css";
import "@/styles/tokens.css";
import "@/styles/globals.css";

export const metadata: Metadata = {
  metadataBase: env.siteUrl,
  title: {
    default: `${site.name} | Madhubani clothing, wall art and home décor`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  openGraph: {
    siteName: site.name,
    locale: "en_IN",
    type: "website",
  },
  // Only the production deployment may be indexed.
  robots: isProduction ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#fbf7ef",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${serif.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
