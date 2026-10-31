-- Manual rollback for 20261031150000_better_auth_sessions_accounts.
-- Prisma Migrate has no down migrations; apply this by hand only if the
-- migration must be reverted, then delete its row from "_prisma_migrations".
-- Signs everyone out and discards password hashes: users would need a reset.
BEGIN;
DROP TABLE IF EXISTS "rate_limits";
DROP TABLE IF EXISTS "verifications";
DROP TABLE IF EXISTS "accounts";
DROP TABLE IF EXISTS "sessions";
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "image",
  DROP COLUMN IF EXISTS "email_verified",
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "email_verified_at" TIMESTAMP(3);
COMMIT;
