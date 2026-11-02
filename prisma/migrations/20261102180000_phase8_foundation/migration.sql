-- Phase 8 foundation (docs/phase-8-returns-custom-artwork.md §7.1, step 8.0).
-- Additive only: every existing row keeps its meaning (kind STANDARD,
-- product kind CATALOGUE). Enum values added below are compared as text
-- where a CHECK needs them, because a value added in this transaction cannot
-- be referenced as an enum literal until it commits.

CREATE TYPE "order_kind" AS ENUM ('STANDARD', 'EXCHANGE_REPLACEMENT', 'COMMISSION_INSTALMENT');
CREATE TYPE "instalment_kind" AS ENUM ('DEPOSIT', 'BALANCE');
CREATE TYPE "product_kind" AS ENUM ('CATALOGUE', 'COMMISSION');

ALTER TYPE "payment_method" ADD VALUE IF NOT EXISTS 'STORE_CREDIT';
ALTER TYPE "cancellation_reason" ADD VALUE IF NOT EXISTS 'EXCHANGE_LAPSED';
ALTER TYPE "cancellation_reason" ADD VALUE IF NOT EXISTS 'COMMISSION_CANCELLED';

ALTER TABLE "products"
  ADD COLUMN "kind" "product_kind" NOT NULL DEFAULT 'CATALOGUE';

ALTER TABLE "orders"
  ADD COLUMN "kind" "order_kind" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "exchange_of_order_id" UUID,
  ADD COLUMN "commission_request_id" UUID,
  ADD COLUMN "instalment" "instalment_kind";

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_exchange_of_order_id_fkey"
    FOREIGN KEY ("exchange_of_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "orders_exchange_of_order_id_idx" ON "orders"("exchange_of_order_id");

-- One deposit and one balance order per commission; NULLs are distinct.
CREATE UNIQUE INDEX "orders_commission_request_id_instalment_key"
  ON "orders"("commission_request_id", "instalment");

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_replacement_has_parent"
    CHECK ("kind" <> 'EXCHANGE_REPLACEMENT' OR "exchange_of_order_id" IS NOT NULL);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_instalment_has_commission"
    CHECK ("kind" <> 'COMMISSION_INSTALMENT' OR ("commission_request_id" IS NOT NULL AND "instalment" IS NOT NULL));

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_parent_links_match_kind"
    CHECK (("exchange_of_order_id" IS NULL OR "kind" = 'EXCHANGE_REPLACEMENT')
       AND ("commission_request_id" IS NULL OR "kind" = 'COMMISSION_INSTALMENT')
       AND ("instalment" IS NULL OR "kind" = 'COMMISSION_INSTALMENT'));

-- Store credit never carries an amount; compared as text (see the note above).
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_store_credit_is_free"
    CHECK ("payment_method"::text <> 'STORE_CREDIT' OR "total_in_paise" = 0);
