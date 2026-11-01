-- Manual rollback for 20261102090000_audit_unverified_actor.
-- Apply by hand only if the migration must be reverted, then delete its row
-- from "_prisma_migrations". Fails if "unverified:%" rows exist; delete them
-- first as the migration owner (the runtime role cannot).
BEGIN;
ALTER TABLE "admin_audit_log"
  DROP CONSTRAINT "admin_audit_log_actor_present";
ALTER TABLE "admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_actor_present"
    CHECK ("actor_id" IS NOT NULL OR "actor_label" LIKE 'script:%' OR "actor_label" LIKE 'system:%');
COMMIT;
