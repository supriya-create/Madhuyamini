import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Builds a Prisma client over the `pg` driver adapter.
 *
 * Deliberately free of `server-only` so the seed script and integration
 * tests can construct clients for their own databases. Application code must
 * use the singleton in `@/server/db` instead.
 */
export function createPrismaClient(
  connectionString: string,
  options: { verbose?: boolean } = {},
) {
  const adapter = new PrismaPg({
    connectionString,
    // Prisma 7 inherits `pg` defaults (no connect timeout); fail fast instead.
    connectionTimeoutMillis: 10_000,
    max: 10,
  });

  return new PrismaClient({
    adapter,
    log: options.verbose ? ["warn", "error"] : ["error"],
  });
}

export type AppPrismaClient = ReturnType<typeof createPrismaClient>;
