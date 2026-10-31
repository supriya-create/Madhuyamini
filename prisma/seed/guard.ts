const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface SeedGuardInput {
  readonly databaseUrl: string;
  readonly siteEnv: string | undefined;
  readonly allowRemote: boolean;
}

/**
 * Seed data is for development and tests only. Refuse to touch production or
 * any non-local database unless explicitly overridden.
 */
export function assertSeedAllowed({
  databaseUrl,
  siteEnv,
  allowRemote,
}: SeedGuardInput): void {
  if (siteEnv === "production") {
    throw new Error("Refusing to seed: SITE_ENV is production.");
  }

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("Refusing to seed: DATABASE_URL is not a valid URL.");
  }

  if (!LOCAL_HOSTS.has(host) && !allowRemote) {
    throw new Error(
      `Refusing to seed the non-local database host "${host}". Set SEED_ALLOW_REMOTE=1 to override deliberately.`,
    );
  }
}
