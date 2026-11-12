import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Account helpers shared by journeys that need a signed-in customer. */

export const PASSWORD = "peacock on the pallu";

/** A distinct client address per test, so the per-IP limits apply to each test alone. */
export function fakeAddress(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

/**
 * Distinct per project, run and repeat: with `--repeat-each`, two repeats of
 * one test can start within the same millisecond, and sharing an account
 * (and so a cart) would send both off course.
 */
export function uniqueEmail(
  label: string,
  testInfo: { project: { name: string }; repeatEachIndex: number },
) {
  return `${label}-${testInfo.project.name}-${Date.now()}-${testInfo.repeatEachIndex}@example.com`;
}

export async function register(page: Page, email: string, name = "Asha Devi") {
  await page.goto("/register");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toContainText(
    "sent a confirmation link",
  );
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the action to finish: either we left /login or an error is shown.
  await Promise.race([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 15_000,
    }),
    page.locator("form").getByRole("alert").waitFor({ timeout: 15_000 }),
  ]);
}
