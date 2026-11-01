import { existsSync } from "node:fs";

import { createPrismaClient } from "../src/server/prisma-client";

import { seedCatalog } from "./seed/catalog";
import { assertSeedAllowed } from "./seed/guard";
import { seedStaff } from "./seed/staff";

/**
 * Development seed. Run with `npx prisma db seed` (never automatically).
 * Safe to run repeatedly; see seed/catalog.ts.
 */
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  assertSeedAllowed({
    databaseUrl,
    siteEnv: process.env.SITE_ENV ?? process.env.VERCEL_ENV,
    allowRemote: process.env.SEED_ALLOW_REMOTE === "1",
  });

  const prisma = createPrismaClient(databaseUrl);
  try {
    const summary = await seedCatalog(prisma);
    const staff = await seedStaff(prisma, process.env.SEED_ADMIN_PASSWORD);
    console.warn(
      `Seeded ${summary.categories} categories, ${summary.products} products, ${summary.variants} variants, ${staff} staff accounts.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
