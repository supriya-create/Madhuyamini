import { existsSync } from "node:fs";

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { Client } from "pg";

import { base32Decode, currentStep, totpAt } from "../src/server/security/totp";

import { PASSWORD } from "./accounts";

/**
 * Staff fixtures for the admin journeys. Accounts are created straight in
 * the e2e database (the same one the server under test uses), one per
 * test, so parallel projects never share a second factor or a rate limit.
 * Plain SQL over `pg`: the generated Prisma client is ESM-only, which the
 * Playwright runner cannot load.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function withDb<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is needed for the admin journeys");
  }
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function createStaffAccount(
  role: "STAFF" | "ADMIN",
  email: string,
  name = role === "ADMIN" ? "Test Admin" : "Test Staff",
): Promise<{ id: string; email: string }> {
  const password = await hashPassword(PASSWORD);
  return withDb(async (client) => {
    const user = await client.query<{ id: string; email: string }>(
      `INSERT INTO users (id, email, email_verified, name, role, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, true, $2, $3::user_role, now(), now())
       RETURNING id, email`,
      [email, name, role],
    );
    const row = user.rows[0];
    if (!row) throw new Error("staff account not created");
    await client.query(
      `INSERT INTO accounts (id, user_id, provider_id, account_id, password, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, 'credential', $1::text, $2, now(), now())`,
      [row.id, password],
    );
    return row;
  });
}

/** What an authenticator app would show for the key on the enrolment page. */
export function codeFor(setupKey: string, now = new Date()): string {
  return totpAt(
    base32Decode(setupKey.replace(/\s+/g, "")),
    currentStep(now, 30),
    6,
  );
}

/** Enrols a freshly signed-in staff member and lands on `next`. */
export async function enrolTwoFactor(page: Page): Promise<string[]> {
  await expect(page).toHaveURL(/\/account\/security\/two-factor/);
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByRole("button", { name: "Start setup" }).click();
  const key = await page.getByLabel("Setup key").textContent();
  if (!key) throw new Error("no setup key shown");
  await page.getByLabel("Six-digit code from the app").fill(codeFor(key));
  await page
    .getByRole("button", { name: "Turn on two-factor sign-in" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Two-factor sign-in is on",
  );
  const codes = await page
    .getByRole("list", { name: "Recovery codes" })
    .locator("code")
    .allTextContents();
  expect(codes).toHaveLength(10);
  await page
    .getByRole("link", { name: "I have saved my recovery codes" })
    .click();
  return codes;
}

/**
 * Ages a session's second-factor verification so sensitive actions ask
 * again. The columns hold UTC wall-clock time (Prisma), so the SQL must too.
 */
export async function ageVerification(
  userId: string,
  minutes: number,
): Promise<number> {
  const result = await withDb((client) =>
    client.query(
      `UPDATE staff_session_verifications
          SET verified_at = timezone('UTC', now()) - ($2 || ' minutes')::interval
        WHERE user_id = $1::uuid`,
      [userId, String(minutes)],
    ),
  );
  return result.rowCount ?? 0;
}
