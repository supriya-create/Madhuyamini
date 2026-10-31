import "server-only";

import { env } from "./env";
import { createPrismaClient } from "./prisma-client";
import type { AppPrismaClient } from "./prisma-client";

declare global {
  // Augmenting globalThis requires `var`. A single client survives Next.js
  // dev-server hot reloads instead of leaking a connection pool per reload.
  var madhuyaminiPrisma: AppPrismaClient | undefined;
}

/** The application's single Prisma client. Server-only. */
export const db: AppPrismaClient =
  globalThis.madhuyaminiPrisma ??
  createPrismaClient(env.databaseUrl, {
    verbose: env.siteEnv === "development",
  });

if (env.siteEnv !== "production") {
  globalThis.madhuyaminiPrisma = db;
}
