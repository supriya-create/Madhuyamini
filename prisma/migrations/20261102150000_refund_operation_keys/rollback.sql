-- Manual rollback for 20261102150000_refund_operation_keys.
-- Apply by hand only if the migration must be reverted, then delete its row
-- from "_prisma_migrations". Drops the keys; refunds themselves are kept.
BEGIN;
DROP INDEX IF EXISTS "refunds_operation_key_key";
ALTER TABLE "refunds" DROP COLUMN IF EXISTS "operation_key";
COMMIT;
