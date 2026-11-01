-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'REFUSED', 'FAILED');

-- CreateEnum
CREATE TYPE "inventory_adjustment_kind" AS ENUM ('RECEIVED', 'CORRECTION', 'WRITE_OFF', 'RESTOCK_ON_CANCEL', 'RESTOCK_ON_RETURN');

-- CreateEnum
CREATE TYPE "upload_status" AS ENUM ('ISSUED', 'ATTACHED', 'DISCARDED', 'SWEPT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "cancellation_reason" ADD VALUE IF NOT EXISTS 'COD_REFUSED';
ALTER TYPE "cancellation_reason" ADD VALUE IF NOT EXISTS 'DELIVERY_FAILED';

-- AlterEnum
ALTER TYPE "order_actor" ADD VALUE IF NOT EXISTS 'STAFF';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'SHIPPED';
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'DELIVERY_FAILED';
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'RETURNED';

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_label" TEXT NOT NULL,
    "actor_role" "user_role",
    "session_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "outcome" "audit_outcome" NOT NULL,
    "reason" TEXT,
    "error_code" TEXT,
    "grant_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "request_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_adjustments" (
    "id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "kind" "inventory_adjustment_kind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "stock_before" INTEGER NOT NULL,
    "stock_after" INTEGER NOT NULL,
    "reserved_at_time" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" UUID,
    "order_id" UUID,
    "audit_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "carrier" TEXT NOT NULL,
    "tracking_number" TEXT,
    "tracking_url" TEXT,
    "shipped_at" TIMESTAMP(3) NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "delivery_failed_at" TIMESTAMP(3),
    "delivery_failure_reason" TEXT,
    "returned_at" TIMESTAMP(3),
    "inspected_at" TIMESTAMP(3),
    "inspection_note" TEXT,
    "carrier_claim_reference" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_two_factor" (
    "user_id" UUID NOT NULL,
    "secret_ciphertext" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL,
    "enabled_at" TIMESTAMP(3),
    "last_accepted_step" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_two_factor_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "staff_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_session_verifications" (
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_session_verifications_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "staff_pii_grants" (
    "id" UUID NOT NULL,
    "grantee_id" UUID NOT NULL,
    "granted_by_id" UUID NOT NULL,
    "customer_id" UUID,
    "fields" TEXT[],
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_pii_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_pii_reveals" (
    "id" UUID NOT NULL,
    "grant_id" UUID,
    "staff_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "fields" TEXT[],
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_pii_reveals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image_uploads" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "public_id" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "issued_by_id" UUID NOT NULL,
    "status" "upload_status" NOT NULL DEFAULT 'ISSUED',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "sweep_error" TEXT,

    CONSTRAINT "product_image_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_log_target_type_target_id_created_at_idx" ON "admin_audit_log"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_actor_id_created_at_idx" ON "admin_audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_action_created_at_idx" ON "admin_audit_log"("action", "created_at");

-- CreateIndex
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at");

-- CreateIndex
CREATE INDEX "inventory_adjustments_variant_id_created_at_idx" ON "inventory_adjustments"("variant_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_adjustments_order_id_idx" ON "inventory_adjustments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_order_id_key" ON "shipments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_recovery_codes_code_hash_key" ON "staff_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "staff_recovery_codes_user_id_idx" ON "staff_recovery_codes"("user_id");

-- CreateIndex
CREATE INDEX "staff_session_verifications_user_id_idx" ON "staff_session_verifications"("user_id");

-- CreateIndex
CREATE INDEX "staff_pii_grants_grantee_id_expires_at_idx" ON "staff_pii_grants"("grantee_id", "expires_at");

-- CreateIndex
CREATE INDEX "staff_pii_reveals_staff_id_expires_at_idx" ON "staff_pii_reveals"("staff_id", "expires_at");

-- CreateIndex
CREATE INDEX "staff_pii_reveals_customer_id_created_at_idx" ON "staff_pii_reveals"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_image_uploads_public_id_key" ON "product_image_uploads"("public_id");

-- CreateIndex
CREATE INDEX "product_image_uploads_status_issued_at_idx" ON "product_image_uploads"("status", "issued_at");

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_two_factor" ADD CONSTRAINT "staff_two_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_recovery_codes" ADD CONSTRAINT "staff_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_session_verifications" ADD CONSTRAINT "staff_session_verifications_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_session_verifications" ADD CONSTRAINT "staff_session_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_pii_grants" ADD CONSTRAINT "staff_pii_grants_grantee_id_fkey" FOREIGN KEY ("grantee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_pii_grants" ADD CONSTRAINT "staff_pii_grants_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_pii_reveals" ADD CONSTRAINT "staff_pii_reveals_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_pii_reveals" ADD CONSTRAINT "staff_pii_reveals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants, triggers and privileges (docs/admin.md §3, §13).
-- ---------------------------------------------------------------------------
ALTER TABLE "inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_delta_nonzero" CHECK ("delta" <> 0),
  ADD CONSTRAINT "inventory_adjustments_quantities_consistent"
    CHECK ("stock_after" = "stock_before" + "delta" AND "stock_before" >= 0 AND "stock_after" >= "reserved_at_time"),
  ADD CONSTRAINT "inventory_adjustments_reason_present" CHECK (length(btrim("reason")) >= 3),
  ADD CONSTRAINT "inventory_adjustments_actor_or_cancel"
    CHECK (("kind" = 'RESTOCK_ON_CANCEL' AND "order_id" IS NOT NULL) OR "actor_id" IS NOT NULL),
  ADD CONSTRAINT "inventory_adjustments_return_has_order"
    CHECK ("kind" <> 'RESTOCK_ON_RETURN' OR "order_id" IS NOT NULL);

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_delivered_after_shipped"
    CHECK ("delivered_at" IS NULL OR "delivered_at" >= "shipped_at"),
  ADD CONSTRAINT "shipments_returned_after_failed"
    CHECK ("returned_at" IS NULL OR ("delivery_failed_at" IS NOT NULL AND "returned_at" >= "delivery_failed_at")),
  ADD CONSTRAINT "shipments_inspected_after_returned"
    CHECK ("inspected_at" IS NULL OR ("returned_at" IS NOT NULL AND "inspected_at" >= "returned_at")),
  ADD CONSTRAINT "shipments_tracking_url_https"
    CHECK ("tracking_url" IS NULL OR "tracking_url" LIKE 'https://%');

ALTER TABLE "admin_audit_log"
  ADD CONSTRAINT "admin_audit_log_actor_present"
    CHECK ("actor_id" IS NOT NULL OR "actor_label" LIKE 'script:%' OR "actor_label" LIKE 'system:%');

ALTER TABLE "staff_two_factor"
  ADD CONSTRAINT "staff_two_factor_key_version_positive" CHECK ("key_version" >= 1);

ALTER TABLE "staff_pii_grants"
  ADD CONSTRAINT "staff_pii_grants_window"
    CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '24 hours'),
  ADD CONSTRAINT "staff_pii_grants_fields_known"
    CHECK ("fields" <@ ARRAY['email', 'phone', 'address']::text[] AND cardinality("fields") >= 1),
  ADD CONSTRAINT "staff_pii_grants_reason_present" CHECK (length(btrim("reason")) >= 3);

ALTER TABLE "staff_pii_reveals"
  ADD CONSTRAINT "staff_pii_reveals_fields_known"
    CHECK ("fields" <@ ARRAY['email', 'phone', 'address']::text[] AND cardinality("fields") >= 1),
  ADD CONSTRAINT "staff_pii_reveals_window" CHECK ("expires_at" > "created_at");

ALTER TABLE "product_image_uploads"
  ADD CONSTRAINT "product_image_uploads_folder_scoped"
    CHECK ("public_id" LIKE 'madhuyamini/products/%' AND "folder" = 'madhuyamini/products/' || "product_id"::text);

-- Append-only tables: the application never updates or deletes these rows.
CREATE OR REPLACE FUNCTION refuse_row_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Default SQLSTATE P0001: the message reaches the application unchanged.
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER "admin_audit_log_immutable"
  BEFORE UPDATE OR DELETE ON "admin_audit_log"
  FOR EACH ROW EXECUTE FUNCTION refuse_row_mutation();
CREATE TRIGGER "inventory_adjustments_immutable"
  BEFORE UPDATE OR DELETE ON "inventory_adjustments"
  FOR EACH ROW EXECUTE FUNCTION refuse_row_mutation();
CREATE TRIGGER "order_events_immutable"
  BEFORE UPDATE OR DELETE ON "order_events"
  FOR EACH ROW EXECUTE FUNCTION refuse_row_mutation();

-- Last line of defence for the last ADMIN (the service also serialises role
-- changes with an advisory lock).
CREATE OR REPLACE FUNCTION users_keep_one_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE' AND OLD."role" = 'ADMIN')
     OR (TG_OP = 'UPDATE' AND OLD."role" = 'ADMIN' AND NEW."role" <> 'ADMIN') THEN
    IF (SELECT count(*) FROM "users" WHERE "role" = 'ADMIN' AND "id" <> OLD."id") = 0 THEN
      RAISE EXCEPTION 'users_keep_one_admin: at least one ADMIN must remain' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

CREATE TRIGGER "users_keep_one_admin"
  BEFORE UPDATE OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION users_keep_one_admin();

-- Runtime role privileges, applied only where the role exists
-- (scripts/provision-db-roles.sql creates it locally and in CI).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'madhuyamini_app') THEN
    GRANT USAGE ON SCHEMA public TO madhuyamini_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO madhuyamini_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO madhuyamini_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO madhuyamini_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO madhuyamini_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "admin_audit_log", "inventory_adjustments", "order_events" FROM madhuyamini_app;
    REVOKE ALL ON "_prisma_migrations" FROM madhuyamini_app;
  END IF;
END
$$;
