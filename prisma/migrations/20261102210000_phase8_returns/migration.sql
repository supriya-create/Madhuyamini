-- Phase 8 step 8.1: customer returns foundation
-- (docs/phase-8-returns-custom-artwork.md §3, §7.2, §16). Additive: new
-- enum types and tables only; nothing existing changes meaning.

CREATE TYPE "return_status" AS ENUM ('REQUESTED', 'INFO_REQUESTED', 'APPROVED', 'IN_TRANSIT', 'OVERDUE', 'RECEIVED', 'INSPECTED', 'CLOSED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'LOST');
CREATE TYPE "return_reason" AS ENUM ('DAMAGED_ON_ARRIVAL', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'SIZE_OR_FIT', 'CHANGED_MIND', 'QUALITY', 'OTHER');
CREATE TYPE "return_resolution" AS ENUM ('REFUND', 'EXCHANGE');
CREATE TYPE "return_item_condition" AS ENUM ('AS_NEW', 'OPENED', 'USED', 'DAMAGED', 'WRONG_ITEM', 'NOT_RECEIVED');
CREATE TYPE "return_shipment_direction" AS ENUM ('INBOUND', 'OUTBOUND_TO_CUSTOMER');
CREATE TYPE "return_party" AS ENUM ('CUSTOMER', 'STAFF');
CREATE TYPE "upload_purpose" AS ENUM ('RETURN_EVIDENCE', 'RETURN_LABEL', 'RETURN_INSPECTION', 'ARTWORK_REFERENCE', 'ARTWORK_PREVIEW', 'ARTWORK_PRODUCTION');

-- Private file ledger -------------------------------------------------------
CREATE TABLE "customer_uploads" (
    "id" UUID NOT NULL,
    "purpose" "upload_purpose" NOT NULL,
    "owner_user_id" UUID,
    "issued_by_staff_id" UUID,
    "target_type" TEXT,
    "target_id" UUID,
    "public_id" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "delivery_type" TEXT NOT NULL DEFAULT 'authenticated',
    "status" "upload_status" NOT NULL DEFAULT 'ISSUED',
    "format" TEXT,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT,
    "verified_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "sweep_error" TEXT,

    CONSTRAINT "customer_uploads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_uploads_public_id_key" ON "customer_uploads"("public_id");
CREATE INDEX "customer_uploads_status_issued_at_idx" ON "customer_uploads"("status", "issued_at");
CREATE INDEX "customer_uploads_target_type_target_id_idx" ON "customer_uploads"("target_type", "target_id");
CREATE INDEX "customer_uploads_owner_user_id_issued_at_idx" ON "customer_uploads"("owner_user_id", "issued_at");
ALTER TABLE "customer_uploads" ADD CONSTRAINT "customer_uploads_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_uploads" ADD CONSTRAINT "customer_uploads_issued_by_staff_id_fkey" FOREIGN KEY ("issued_by_staff_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_uploads"
  ADD CONSTRAINT "customer_uploads_has_issuer"
    CHECK ("owner_user_id" IS NOT NULL OR "issued_by_staff_id" IS NOT NULL);
ALTER TABLE "customer_uploads"
  ADD CONSTRAINT "customer_uploads_folder_scoped"
    CHECK ("public_id" LIKE 'madhuyamini/returns/%' OR "public_id" LIKE 'madhuyamini/commissions/%');
ALTER TABLE "customer_uploads"
  ADD CONSTRAINT "customer_uploads_facts_non_negative"
    CHECK (("bytes" IS NULL OR "bytes" >= 0) AND ("width" IS NULL OR "width" >= 0) AND ("height" IS NULL OR "height" >= 0));

-- Return requests -----------------------------------------------------------
CREATE TABLE "return_requests" (
    "id" UUID NOT NULL,
    "request_number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID,
    "access_token_id" UUID,
    "status" "return_status" NOT NULL DEFAULT 'REQUESTED',
    "operation_key" UUID NOT NULL,
    "settlement_operation_key" UUID,
    "policy_snapshot" JSONB NOT NULL,
    "instructions_snapshot" JSONB,
    "decision_due_at" TIMESTAMP(3),
    "ship_by_at" TIMESTAMP(3),
    "receive_by_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "received_note" TEXT,
    "inspected_at" TIMESTAMP(3),
    "inspection_note" TEXT,
    "settled_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "lost_decision" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "return_requests_request_number_key" ON "return_requests"("request_number");
CREATE UNIQUE INDEX "return_requests_operation_key_key" ON "return_requests"("operation_key");
CREATE UNIQUE INDEX "return_requests_settlement_operation_key_key" ON "return_requests"("settlement_operation_key");
CREATE UNIQUE INDEX "return_requests_one_open_per_order" ON "return_requests"("order_id")
  WHERE "status" IN ('REQUESTED', 'INFO_REQUESTED', 'APPROVED', 'IN_TRANSIT', 'OVERDUE', 'RECEIVED', 'INSPECTED');
CREATE INDEX "return_requests_order_id_created_at_idx" ON "return_requests"("order_id", "created_at");
CREATE INDEX "return_requests_status_decision_due_at_idx" ON "return_requests"("status", "decision_due_at");
CREATE INDEX "return_requests_status_ship_by_at_idx" ON "return_requests"("status", "ship_by_at");
CREATE INDEX "return_requests_status_receive_by_at_idx" ON "return_requests"("status", "receive_by_at");
CREATE INDEX "return_requests_user_id_created_at_idx" ON "return_requests"("user_id", "created_at");
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "return_requests"
  ADD CONSTRAINT "return_requests_has_owner"
    CHECK ("user_id" IS NOT NULL OR "access_token_id" IS NOT NULL);
ALTER TABLE "return_requests"
  ADD CONSTRAINT "return_requests_clocks_after_creation"
    CHECK (("decision_due_at" IS NULL OR "decision_due_at" >= "created_at")
       AND ("ship_by_at" IS NULL OR "ship_by_at" >= "created_at")
       AND ("receive_by_at" IS NULL OR "receive_by_at" >= "created_at")
       AND ("received_at" IS NULL OR "received_at" >= "created_at")
       AND ("inspected_at" IS NULL OR "inspected_at" >= "created_at")
       AND ("settled_at" IS NULL OR "settled_at" >= "created_at")
       AND ("closed_at" IS NULL OR "closed_at" >= "created_at"));
ALTER TABLE "return_requests"
  ADD CONSTRAINT "return_requests_closed_has_timestamp"
    CHECK (("status" IN ('CLOSED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'LOST')) = ("closed_at" IS NOT NULL));

-- Return items --------------------------------------------------------------
CREATE TABLE "return_items" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "requested_qty" INTEGER NOT NULL,
    "approved_qty" INTEGER,
    "received_qty" INTEGER,
    "restock_qty" INTEGER NOT NULL DEFAULT 0,
    "repair_qty" INTEGER NOT NULL DEFAULT 0,
    "quarantine_qty" INTEGER NOT NULL DEFAULT 0,
    "write_off_qty" INTEGER NOT NULL DEFAULT 0,
    "return_to_customer_qty" INTEGER NOT NULL DEFAULT 0,
    "not_received_qty" INTEGER NOT NULL DEFAULT 0,
    "held_qty" INTEGER NOT NULL DEFAULT 0,
    "released_qty" INTEGER NOT NULL DEFAULT 0,
    "reason" "return_reason" NOT NULL,
    "description" TEXT,
    "resolution_preference" "return_resolution" NOT NULL DEFAULT 'REFUND',
    "exchange_variant_id" UUID,
    "condition" "return_item_condition",
    "inspection_note" TEXT,
    "deduction_in_paise" INTEGER NOT NULL DEFAULT 0,
    "deduction_reason" TEXT,
    "inspected" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "return_items_return_request_id_order_item_id_key" ON "return_items"("return_request_id", "order_item_id");
CREATE INDEX "return_items_order_item_id_idx" ON "return_items"("order_item_id");
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_exchange_variant_id_fkey" FOREIGN KEY ("exchange_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_quantities_bounded"
    CHECK ("requested_qty" >= 1
       AND ("approved_qty" IS NULL OR ("approved_qty" >= 0 AND "approved_qty" <= "requested_qty"))
       AND ("received_qty" IS NULL OR ("approved_qty" IS NOT NULL AND "received_qty" >= 0 AND "received_qty" <= "approved_qty"))
       AND "restock_qty" >= 0 AND "repair_qty" >= 0 AND "quarantine_qty" >= 0 AND "write_off_qty" >= 0
       AND "return_to_customer_qty" >= 0 AND "not_received_qty" >= 0 AND "held_qty" >= 0 AND "released_qty" >= 0);
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_inspection_sums"
    CHECK (NOT "inspected" OR ("received_qty" IS NOT NULL
       AND "restock_qty" + "repair_qty" + "quarantine_qty" + "write_off_qty" + "return_to_customer_qty" = "received_qty"));
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_exchange_names_variant"
    CHECK ("resolution_preference" <> 'EXCHANGE' OR "exchange_variant_id" IS NOT NULL);
ALTER TABLE "return_items"
  ADD CONSTRAINT "return_items_deduction_rules"
    CHECK ("deduction_in_paise" >= 0
       AND ("deduction_in_paise" = 0 OR "deduction_reason" IS NOT NULL)
       AND ("deduction_in_paise" = 0 OR "reason" NOT IN ('DAMAGED_ON_ARRIVAL', 'WRONG_ITEM')));

-- Return shipments ----------------------------------------------------------
CREATE TABLE "return_shipments" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "direction" "return_shipment_direction" NOT NULL DEFAULT 'INBOUND',
    "carrier" TEXT NOT NULL,
    "tracking_number" TEXT,
    "tracking_url" TEXT,
    "shipped_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3),
    "recorded_by" "return_party" NOT NULL,
    "recorded_by_user_id" UUID,
    "label_file_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_shipments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "return_shipments_return_request_id_shipped_at_idx" ON "return_shipments"("return_request_id", "shipped_at");
ALTER TABLE "return_shipments" ADD CONSTRAINT "return_shipments_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "return_shipments"
  ADD CONSTRAINT "return_shipments_tracking_url_https"
    CHECK ("tracking_url" IS NULL OR "tracking_url" LIKE 'https://%');

-- Return events (append-only) ----------------------------------------------
CREATE TABLE "return_events" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor" "order_actor" NOT NULL,
    "actor_user_id" UUID,
    "from_status" "return_status",
    "to_status" "return_status",
    "visible_to_customer" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "return_events_return_request_id_created_at_idx" ON "return_events"("return_request_id", "created_at");
ALTER TABLE "return_events" ADD CONSTRAINT "return_events_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Return messages (append-only) --------------------------------------------
CREATE TABLE "return_messages" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "author" "return_party" NOT NULL,
    "author_user_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "return_messages_return_request_id_created_at_idx" ON "return_messages"("return_request_id", "created_at");
ALTER TABLE "return_messages" ADD CONSTRAINT "return_messages_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Immutability: the application never updates or deletes timeline rows.
CREATE TRIGGER "return_events_immutable"
  BEFORE UPDATE OR DELETE ON "return_events"
  FOR EACH ROW EXECUTE FUNCTION refuse_row_mutation();
CREATE TRIGGER "return_messages_immutable"
  BEFORE UPDATE OR DELETE ON "return_messages"
  FOR EACH ROW EXECUTE FUNCTION refuse_row_mutation();

-- Runtime role: default privileges (migration 7) grant the new tables; the
-- append-only ones lose UPDATE/DELETE/TRUNCATE again.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'madhuyamini_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_uploads", "return_requests", "return_items", "return_shipments" TO madhuyamini_app;
    GRANT SELECT, INSERT ON "return_events", "return_messages" TO madhuyamini_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "return_events", "return_messages" FROM madhuyamini_app;
  END IF;
END
$$;
