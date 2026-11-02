-- Manual rollback for 20261102180000_phase8_foundation.
-- Apply by hand only if the migration must be reverted, then delete its row
-- from "_prisma_migrations". Refuses while replacement or instalment orders
-- exist (the columns carry their links). PostgreSQL cannot drop enum values:
-- STORE_CREDIT (payment_method), EXCHANGE_LAPSED and COMMISSION_CANCELLED
-- (cancellation_reason) remain, unused and harmless.
BEGIN;
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_store_credit_is_free";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_parent_links_match_kind";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_instalment_has_commission";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_replacement_has_parent";
DROP INDEX IF EXISTS "orders_commission_request_id_instalment_key";
DROP INDEX IF EXISTS "orders_exchange_of_order_id_idx";
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_exchange_of_order_id_fkey";
ALTER TABLE "orders"
  DROP COLUMN IF EXISTS "instalment",
  DROP COLUMN IF EXISTS "commission_request_id",
  DROP COLUMN IF EXISTS "exchange_of_order_id",
  DROP COLUMN IF EXISTS "kind";
ALTER TABLE "products" DROP COLUMN IF EXISTS "kind";
DROP TYPE IF EXISTS "product_kind";
DROP TYPE IF EXISTS "instalment_kind";
DROP TYPE IF EXISTS "order_kind";
COMMIT;
