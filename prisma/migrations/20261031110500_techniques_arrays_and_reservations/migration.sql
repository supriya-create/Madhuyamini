-- Products: several decorative techniques and construction methods per product.
-- Inventory: time-limited stock holds with explicit expiry and release.
-- Rules and rationale: docs/data-model.md.

-- CreateEnum
CREATE TYPE "construction_method" AS ENUM ('HANDWOVEN', 'MILL_WOVEN', 'HAND_STITCHED', 'MACHINE_STITCHED', 'HANDMADE_PAPER', 'STRETCHED_CANVAS', 'FRAMED');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED');

-- 1. Add the array columns alongside the old single-value column.
ALTER TABLE "products"
  ADD COLUMN "techniques" "technique"[] NOT NULL DEFAULT '{}',
  ADD COLUMN "construction_methods" "construction_method"[] NOT NULL DEFAULT '{}';

-- 2. Back-fill. HANDWOVEN was really a construction method, and MIXED_MEDIA is now
--    expressed by listing several techniques. No production database exists yet
--    (first deployment is Phase 11), so the HAND_PAINTED fallback only ever touches
--    development rows; those fixtures are re-seeded with explicit values anyway.
UPDATE "products" SET
  "techniques" = CASE
    WHEN "technique" IN ('HANDWOVEN', 'MIXED_MEDIA') THEN ARRAY['HAND_PAINTED']::"technique"[]
    ELSE ARRAY["technique"]
  END,
  "construction_methods" = CASE
    WHEN "technique" = 'HANDWOVEN' THEN ARRAY['HANDWOVEN']::"construction_method"[]
    ELSE '{}'::"construction_method"[]
  END;

ALTER TABLE "products" DROP COLUMN "technique";

-- 3. Retire HANDWOVEN and MIXED_MEDIA, add APPLIQUE. PostgreSQL cannot drop enum
--    values in place, so the type is rebuilt.
CREATE TYPE "technique_new" AS ENUM ('HAND_PAINTED', 'HAND_BLOCK_PRINTED', 'SCREEN_PRINTED', 'DIGITAL_PRINT', 'EMBROIDERED', 'APPLIQUE');
ALTER TABLE "products" ALTER COLUMN "techniques" DROP DEFAULT;
ALTER TABLE "products" ALTER COLUMN "techniques" TYPE "technique_new"[] USING ("techniques"::text[]::"technique_new"[]);
ALTER TABLE "products" ALTER COLUMN "techniques" SET DEFAULT '{}';
ALTER TYPE "technique" RENAME TO "technique_old";
ALTER TYPE "technique_new" RENAME TO "technique";
DROP TYPE "technique_old";

-- 4. Every product names at least one technique; filtering uses a GIN index.
ALTER TABLE "products"
  ADD CONSTRAINT "products_techniques_not_empty" CHECK (cardinality("techniques") >= 1);
CREATE INDEX "products_techniques_idx" ON "products" USING GIN ("techniques");

-- 5. Stock holds. Inventory.reserved must equal the sum of ACTIVE holds per variant;
--    the application maintains both inside one transaction (Phase 6).
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("quantity" > 0),
    -- A hold is open exactly while it is ACTIVE.
    CONSTRAINT "inventory_reservations_closed_at_matches_status"
      CHECK (("status" = 'ACTIVE') = ("closed_at" IS NULL))
);

-- The expiry sweep scans ACTIVE holds by expiry; stock maths scans by variant.
CREATE INDEX "inventory_reservations_status_expires_at_idx" ON "inventory_reservations"("status", "expires_at");
CREATE INDEX "inventory_reservations_variant_id_status_idx" ON "inventory_reservations"("variant_id", "status");

-- A variant with holds cannot be deleted; close the holds first.
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "inventory"("variant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
