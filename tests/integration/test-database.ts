import { existsSync } from "node:fs";

const DEFAULT_TEST_DATABASE_URL =
  "postgresql://localhost:5432/madhuyamini_test";

/**
 * Resolves the integration-test database URL and refuses anything that does
 * not look like a dedicated test database, because the suite truncates every
 * table between tests.
 */
export function resolveTestDatabaseUrl(): string {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }

  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const databaseName = new URL(url).pathname.replace(/^\//, "");
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `TEST_DATABASE_URL must point at a database whose name ends in "_test" (got "${databaseName}").`,
    );
  }
  return url;
}
