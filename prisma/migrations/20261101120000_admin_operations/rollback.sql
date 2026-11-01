-- Manual rollback for 20261101120000_admin_operations.
-- Apply by hand only if the migration must be reverted, then delete its row
-- from "_prisma_migrations". Discards the audit log, adjustments, shipments,
-- staff second factors, reveal grants and the upload ledger.
-- PostgreSQL cannot drop enum values: PROCESSING, SHIPPED, DELIVERED,
-- DELIVERY_FAILED, RETURNED (order_status), COD_REFUSED, DELIVERY_FAILED
-- (cancellation_reason) and STAFF (order_actor) remain, unused and harmless.
BEGIN;
DROP TRIGGER IF EXISTS "users_keep_one_admin" ON "users";
DROP TRIGGER IF EXISTS "order_events_immutable" ON "order_events";
DROP TRIGGER IF EXISTS "inventory_adjustments_immutable" ON "inventory_adjustments";
DROP TRIGGER IF EXISTS "admin_audit_log_immutable" ON "admin_audit_log";
DROP FUNCTION IF EXISTS users_keep_one_admin();
DROP FUNCTION IF EXISTS refuse_row_mutation();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'madhuyamini_app') THEN
    GRANT UPDATE, DELETE ON "order_events" TO madhuyamini_app;
  END IF;
END
$$;
DROP TABLE IF EXISTS "product_image_uploads";
DROP TABLE IF EXISTS "staff_pii_reveals";
DROP TABLE IF EXISTS "staff_pii_grants";
DROP TABLE IF EXISTS "staff_session_verifications";
DROP TABLE IF EXISTS "staff_recovery_codes";
DROP TABLE IF EXISTS "staff_two_factor";
DROP TABLE IF EXISTS "shipments";
DROP TABLE IF EXISTS "inventory_adjustments";
DROP TABLE IF EXISTS "admin_audit_log";
DROP TYPE IF EXISTS "upload_status";
DROP TYPE IF EXISTS "inventory_adjustment_kind";
DROP TYPE IF EXISTS "audit_outcome";
COMMIT;
