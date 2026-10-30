import type { MetadataRoute } from "next";

import { isProduction } from "@/server/env";

export default function robots(): MetadataRoute.Robots {
  if (!isProduction) {
    // Development and preview deployments must never be indexed.
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/account", "/cart", "/checkout", "/api"],
    },
    // The sitemap is added with the catalog in Phase 3.
  };
}
