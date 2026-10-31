import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
/** Emails from the server under test are captured here and read by e2e/auth.spec.ts. */
const MAIL_DIR =
  process.env.E2E_MAIL_DIR ??
  mkdtempSync(join(tmpdir(), "madhuyamini-e2e-mail-"));
process.env.E2E_MAIL_DIR = MAIL_DIR;
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

/**
 * End-to-end tests run against a production build (`next build && next start`),
 * not the dev server. Set E2E_SKIP_BUILD=1 to reuse an existing build (CI does).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD
      ? `npm run start -- --port ${PORT}`
      : `npm run build && npm run start -- --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      SITE_ENV: "development",
      // Emailed links are built from SITE_URL; it must be the e2e server's origin.
      SITE_URL: baseURL,
      EMAIL_TRANSPORT: "file",
      EMAIL_OUTBOX_DIR: MAIL_DIR,
      PASSWORD_BREACH_CHECK: "off",
    },
  },
});
