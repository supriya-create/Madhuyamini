import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db";

import { resetDatabase, testDb } from "./db";

/**
 * The durable-alerts migration (audit batch 4) and its hand-written
 * rollback, exercised against the test database: roll back, check the old
 * shape, re-apply, check the new one. The file ends with the schema in its
 * migrated state so the suites after it run unchanged.
 */

const DIR = join(
  process.cwd(),
  "prisma/migrations/20261116090000_durable_ops_alerts",
);

/** Runs a script statement by statement; BEGIN/COMMIT are left to the caller. */
async function runScript(file: string): Promise<void> {
  const statements = readFileSync(join(DIR, file), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter(
      (statement) =>
        statement.length > 0 && statement !== "BEGIN" && statement !== "COMMIT",
    );
  for (const statement of statements) {
    await testDb.$executeRawUnsafe(statement);
  }
}

async function enumValues(): Promise<string[]> {
  const rows = await testDb.$queryRaw<Array<{ enumlabel: string }>>`
    SELECT enumlabel FROM pg_enum
     WHERE enumtypid = 'notification_status'::regtype
     ORDER BY enumsortorder
  `;
  return rows.map((row) => row.enumlabel);
}

async function recipientNullable(): Promise<boolean> {
  const rows = await testDb.$queryRaw<Array<{ is_nullable: string }>>`
    SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'notification_outbox' AND column_name = 'recipient'
  `;
  return rows[0]?.is_nullable === "YES";
}

async function hasPendingCheck(): Promise<boolean> {
  const rows = await testDb.$queryRaw<Array<{ conname: string }>>`
    SELECT conname FROM pg_constraint
     WHERE conname = 'notification_outbox_pending_has_recipient'
  `;
  return rows.length === 1;
}

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

describe("migration 20261116090000_durable_ops_alerts", () => {
  it("rolls back to the previous shape, keeping recorded alerts, and re-applies cleanly", async () => {
    expect(await enumValues()).toEqual([
      "PENDING",
      "SENT",
      "FAILED",
      "SKIPPED",
    ]);
    expect(await recipientNullable()).toBe(true);
    expect(await hasPendingCheck()).toBe(true);

    // A SKIPPED alert exists when the migration is reverted.
    const alert = await testDb.notificationOutbox.create({
      data: {
        kind: "ops.alert",
        dedupeKey: "ops.alert:rollback-test",
        orderId: null,
        recipient: null,
        status: "SKIPPED",
        payload: { reason: "test" },
      },
      select: { id: true },
    });

    await runScript("rollback.sql");
    expect(await enumValues()).toEqual(["PENDING", "SENT", "FAILED"]);
    expect(await recipientNullable()).toBe(false);
    expect(await hasPendingCheck()).toBe(false);
    const kept = await testDb.$queryRaw<
      Array<{ status: string; recipient: string; last_error: string | null }>
    >`SELECT status::text, recipient, last_error FROM notification_outbox WHERE id = ${alert.id}::uuid`;
    expect(kept).toEqual([
      {
        status: "FAILED",
        recipient: "",
        last_error: "Recorded without an operations inbox; never sent",
      },
    ]);

    await runScript("migration.sql");
    expect(await enumValues()).toEqual([
      "PENDING",
      "SENT",
      "FAILED",
      "SKIPPED",
    ]);
    expect(await recipientNullable()).toBe(true);
    expect(await hasPendingCheck()).toBe(true);
    // Re-applying is idempotent for the enum value and refuses nothing.
    await testDb.$executeRawUnsafe(
      `ALTER TYPE "notification_status" ADD VALUE IF NOT EXISTS 'SKIPPED'`,
    );
    await testDb.notificationOutbox.deleteMany({ where: { id: alert.id } });
  });
});
