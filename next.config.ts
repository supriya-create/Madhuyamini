import type { NextConfig } from "next";

/**
 * Baseline security headers for every response.
 *
 * The full Content-Security-Policy (script/style/connect sources for Razorpay,
 * Cloudinary, etc.) is decided in Phase 10 — see docs/architecture.md, D8.
 * The directives below restrict framing, plugins, base URLs and form targets
 * without affecting script execution, so they are safe to apply now.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value:
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // Ignored by browsers over plain http (local development). `includeSubDomains`
  // and `preload` are deliberately left for the launch checklist (Phase 11).
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    // Cloudinary delivers the optimised variants; see src/lib/image-loader.ts.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Admin pages carry staff and customer data: never cached anywhere.
      {
        source: "/admin/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
