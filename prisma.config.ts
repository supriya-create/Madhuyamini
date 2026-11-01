import { existsSync } from "node:fs";

import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration (Prisma 7 reads the database URL from here, not
 * from schema.prisma, and does not load env files on its own).
 *
 * The application reads DATABASE_URL through `src/server/env.ts`; this file is
 * only for the CLI (migrate, generate, db seed).
 */
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Read directly (not via `env()`) so `prisma generate` works without a
    // database, e.g. on a fresh install. Migrate commands still need a real URL.
    // Migrations run as the table owner; the application may use a restricted
    // runtime role in DATABASE_URL (docs/admin.md §13).
    url:
      process.env.MIGRATION_DATABASE_URL ??
      process.env.DATABASE_URL ??
      "postgresql://localhost:5432/madhuyamini",
  },
});
