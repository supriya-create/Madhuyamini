import { Cormorant_Garamond, Mukta } from "next/font/google";

/**
 * Self-hosted at build time by next/font — no runtime requests to Google.
 * `subsets` controls preloading only; other glyph ranges (e.g. ₹ in latin-ext)
 * are still declared and load on demand.
 */
export const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  variable: "--font-cormorant",
});

export const sans = Mukta({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-mukta",
});
