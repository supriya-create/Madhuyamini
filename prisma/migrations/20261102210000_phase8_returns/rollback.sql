-- Manual rollback for 20261102210000_phase8_returns.
-- Apply by hand only if the migration must be reverted, then delete its row
-- from "_prisma_migrations". Discards every return request, item, parcel,
-- event, message and the private file ledger (the files themselves stay at
-- Cloudinary until deleted by hand). Drops the enum types created here;
-- PostgreSQL cannot drop individual enum values, but this migration added
-- none to existing types, so nothing lingers.
BEGIN;
DROP TRIGGER IF EXISTS "return_messages_immutable" ON "return_messages";
DROP TRIGGER IF EXISTS "return_events_immutable" ON "return_events";
DROP TABLE IF EXISTS "return_messages";
DROP TABLE IF EXISTS "return_events";
DROP TABLE IF EXISTS "return_shipments";
DROP TABLE IF EXISTS "return_items";
DROP TABLE IF EXISTS "return_requests";
DROP TABLE IF EXISTS "customer_uploads";
DROP TYPE IF EXISTS "upload_purpose";
DROP TYPE IF EXISTS "return_party";
DROP TYPE IF EXISTS "return_shipment_direction";
DROP TYPE IF EXISTS "return_item_condition";
DROP TYPE IF EXISTS "return_resolution";
DROP TYPE IF EXISTS "return_reason";
DROP TYPE IF EXISTS "return_status";
COMMIT;
