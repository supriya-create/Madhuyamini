-- Manual rollback for 20261101090000_orders_payments_and_outbox.
-- Apply by hand only if the migration must be reverted, then delete its row
-- from "_prisma_migrations". Discards every order, payment, refund, event,
-- webhook record and queued notification. Stock holds lose their order link.
BEGIN;
ALTER TABLE "inventory_reservations" DROP CONSTRAINT IF EXISTS "inventory_reservations_order_id_fkey";
DROP INDEX IF EXISTS "inventory_reservations_order_id_variant_id_key";
ALTER TABLE "inventory_reservations" DROP COLUMN IF EXISTS "order_id";
DROP TABLE IF EXISTS "notification_outbox";
DROP TABLE IF EXISTS "order_events";
DROP TABLE IF EXISTS "payment_webhook_events";
DROP TABLE IF EXISTS "order_access_tokens";
DROP TABLE IF EXISTS "refunds";
DROP TABLE IF EXISTS "payments";
DROP TABLE IF EXISTS "order_items";
DROP TABLE IF EXISTS "orders";
DROP TYPE IF EXISTS "notification_status";
DROP TYPE IF EXISTS "webhook_status";
DROP TYPE IF EXISTS "order_actor";
DROP TYPE IF EXISTS "refund_status";
DROP TYPE IF EXISTS "payment_status";
DROP TYPE IF EXISTS "payment_method";
DROP TYPE IF EXISTS "cancellation_reason";
DROP TYPE IF EXISTS "order_status";
COMMIT;
