import { existsSync } from "node:fs";

/**
 * Runs one scheduled job by hand: `npm run job -- expire-reservations`.
 * Loads .env.local like the Prisma CLI does, then calls the same function the
 * cron route calls. Exits non-zero on failure so it can be scripted.
 */

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const name = process.argv[2];

async function main(): Promise<void> {
  const { isJobName, runJob, jobs } = await import("../src/server/jobs");
  if (!name || !isJobName(name)) {
    console.error(`Usage: npm run job -- <${Object.keys(jobs).join("|")}>`);
    process.exitCode = 2;
    return;
  }
  const summary = await runJob(name);
  process.stdout.write(`${JSON.stringify({ job: name, ...summary })}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
