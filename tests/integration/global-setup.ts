import { execFileSync } from "node:child_process";

import { resolveTestDatabaseUrl } from "./test-database";

/** Applies all migrations to the test database once per run. */
export default function globalSetup(): void {
  const databaseUrl = resolveTestDatabaseUrl();
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
}
