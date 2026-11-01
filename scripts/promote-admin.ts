import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { createInterface } from "node:readline/promises";

/**
 * Promotes an existing, verified account to ADMIN: `npm run admin:promote -- <email>`.
 * Safeguards (docs/admin.md §13): shell only; the database host and account
 * are printed and the email must be typed back (or `--yes` in CI); a
 * non-local database or SITE_ENV=production also needs
 * ADMIN_PROMOTE_CONFIRM=<email> for this one invocation; sessions are
 * revoked so the next sign-in enrols the second factor; an audit row records
 * the script, host and outcome.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  const email = args
    .find((arg) => !arg.startsWith("--"))
    ?.trim()
    .toLowerCase();
  if (!email) {
    process.stderr.write("Usage: npm run admin:promote -- <email> [--yes]\n");
    process.exitCode = 2;
    return;
  }
  const databaseUrl =
    process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const { createPrismaClient } = await import("../src/server/prisma-client");
  const { promoteToAdmin, isLocalDatabase } =
    await import("../src/features/admin/security/promote");
  const host = new URL(databaseUrl).hostname;
  process.stdout.write(
    `Database host: ${host} (${isLocalDatabase(databaseUrl) ? "local" : "REMOTE"})\nAccount: ${email}\n`,
  );
  if (!yes) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const typed = (await rl.question("Type the email address to confirm: "))
      .trim()
      .toLowerCase();
    rl.close();
    if (typed !== email) {
      process.stderr.write("Confirmation did not match; nothing changed.\n");
      process.exitCode = 1;
      return;
    }
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    const outcome = await promoteToAdmin(prisma, {
      email,
      confirm: process.env.ADMIN_PROMOTE_CONFIRM ?? null,
      databaseUrl,
      siteEnv: process.env.SITE_ENV ?? process.env.VERCEL_ENV,
      host: hostname(),
    });
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
