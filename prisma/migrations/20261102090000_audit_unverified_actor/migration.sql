-- A refusal must be recorded even when the actor in a forged context is
-- unknown to the database (docs/admin.md §17, audit addendum). Such rows have
-- no actor_id and carry the claimed id in actor_label as "unverified:<id>".
ALTER TABLE "admin_audit_log"
  DROP CONSTRAINT "admin_audit_log_actor_present";

ALTER TABLE "admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_actor_present"
    CHECK (
      "actor_id" IS NOT NULL
      OR "actor_label" LIKE 'script:%'
      OR "actor_label" LIKE 'system:%'
      OR "actor_label" LIKE 'unverified:%'
    );
