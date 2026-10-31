-- Manual rollback for 20261031170000_carts_and_wishlist.
-- Apply by hand only if the migration must be reverted, then delete its row
-- from "_prisma_migrations". Discards every cart and wishlist.
BEGIN;
DROP TABLE IF EXISTS "wishlist_items";
DROP TABLE IF EXISTS "cart_items";
DROP TABLE IF EXISTS "carts";
DROP TYPE IF EXISTS "cart_status";
COMMIT;
