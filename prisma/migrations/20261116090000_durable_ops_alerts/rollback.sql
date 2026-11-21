-- Manual rollback for 20261116090000_durable_ops_alerts.
-- Apply by hand only if the migration must be reverted, then delete its row
-- from "_prisma_migrations". Alerts recorded without an inbox are kept as
-- FAILED rows with an empty recipient and a note, so no fact is lost.
-- PostgreSQL cannot drop an enum value, so the type is rebuilt without
-- SKIPPED once no row uses it.
BEGIN;
ALTER TABLE "notification_outbox" DROP CONSTRAINT IF EXISTS "notification_outbox_pending_has_recipient";
UPDATE "notification_outbox"
   SET "status" = 'FAILED',
       "recipient" = COALESCE("recipient", ''),
       "last_error" = COALESCE("last_error", 'Recorded without an operations inbox; never sent')
 WHERE "status" = 'SKIPPED' OR "recipient" IS NULL;
ALTER TABLE "notification_outbox" ALTER COLUMN "recipient" SET NOT NULL;
ALTER TYPE "notification_status" RENAME TO "notification_status_old";
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED');
ALTER TABLE "notification_outbox"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "notification_status" USING "status"::text::"notification_status",
  ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "notification_status_old";
COMMIT;
