-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "cancellation_reason" AS ENUM ('PAYMENT_FAILED', 'PAYMENT_TIMEOUT', 'CUSTOMER', 'STOCK_UNAVAILABLE', 'ADMIN');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('RAZORPAY', 'COD');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('INITIATED', 'CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('INITIATED', 'REQUESTED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "order_actor" AS ENUM ('CUSTOMER', 'SYSTEM', 'WEBHOOK', 'CRON', 'ADMIN');

-- CreateEnum
CREATE TYPE "webhook_status" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "inventory_reservations" ADD COLUMN     "order_id" UUID;

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "payment_method" "payment_method" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal_in_paise" INTEGER NOT NULL,
    "shipping_in_paise" INTEGER NOT NULL,
    "cod_fee_in_paise" INTEGER NOT NULL DEFAULT 0,
    "discount_in_paise" INTEGER NOT NULL DEFAULT 0,
    "total_in_paise" INTEGER NOT NULL,
    "tax_in_paise" INTEGER,
    "recipient_name" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "customer_note" TEXT,
    "cart_id" UUID,
    "pending_expires_at" TIMESTAMP(3),
    "deadline_extensions" INTEGER NOT NULL DEFAULT 0,
    "confirmed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" "cancellation_reason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "product_slug" TEXT NOT NULL,
    "product_title" TEXT NOT NULL,
    "variant_title" TEXT,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_in_paise" INTEGER NOT NULL,
    "line_total_in_paise" INTEGER NOT NULL,
    "tax_rate_bp" INTEGER,
    "hsn_code" TEXT,
    "image_url" TEXT,
    "image_alt" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'INITIATED',
    "amount_in_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "receipt" TEXT NOT NULL,
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "signature_verified_at" TIMESTAMP(3),
    "provider_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "authorized_at" TIMESTAMP(3),
    "captured_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_code" TEXT,
    "failure_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "status" "refund_status" NOT NULL DEFAULT 'INITIATED',
    "amount_in_paise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider_refund_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "claimed_by" TEXT,
    "last_error" TEXT,
    "requested_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_access_tokens" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" "webhook_status" NOT NULL DEFAULT 'RECEIVED',
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "order_id" UUID,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "claimed_by" TEXT,
    "last_error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor" "order_actor" NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status",
    "note" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "order_id" UUID,
    "recipient" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "claimed_by" TEXT,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_pending_expires_at_idx" ON "orders"("status", "pending_expires_at");

-- CreateIndex
CREATE INDEX "orders_email_idx" ON "orders"("email");

-- CreateIndex
CREATE UNIQUE INDEX "orders_one_live_per_cart" ON "orders"("cart_id") WHERE (status <> 'CANCELLED'::order_status);

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_variant_id_key" ON "order_items"("order_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_receipt_key" ON "payments"("receipt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_order_id_key" ON "payments"("provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_order_id_created_at_idx" ON "payments"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_attempt_no_key" ON "payments"("order_id", "attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "payments_one_open_per_order" ON "payments"("order_id") WHERE (status = ANY (ARRAY['INITIATED'::payment_status, 'CREATED'::payment_status, 'AUTHORIZED'::payment_status]));

-- CreateIndex
CREATE UNIQUE INDEX "refunds_reference_key" ON "refunds"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_refund_id_key" ON "refunds"("provider_refund_id");

-- CreateIndex
CREATE INDEX "refunds_status_next_attempt_at_idx" ON "refunds"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_access_tokens_token_hash_key" ON "order_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "order_access_tokens_order_id_idx" ON "order_access_tokens"("order_id");

-- CreateIndex
CREATE INDEX "order_access_tokens_expires_at_idx" ON "order_access_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "payment_webhook_events_status_next_attempt_at_idx" ON "payment_webhook_events"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "payment_webhook_events_provider_payment_id_idx" ON "payment_webhook_events"("provider_payment_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_dedupe_key_key" ON "notification_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_outbox_status_next_attempt_at_idx" ON "notification_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservations_order_id_variant_id_key" ON "inventory_reservations"("order_id", "variant_id");

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_access_tokens" ADD CONSTRAINT "order_access_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants (docs/checkout.md §3). Prisma cannot express CHECKs;
-- tests/integration/constraints.test.ts exercises each one.
-- ---------------------------------------------------------------------------
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_non_negative"
    CHECK ("subtotal_in_paise" >= 0 AND "shipping_in_paise" >= 0 AND "cod_fee_in_paise" >= 0
           AND "discount_in_paise" >= 0 AND "total_in_paise" >= 0),
  ADD CONSTRAINT "orders_total_consistent"
    CHECK ("total_in_paise" = "subtotal_in_paise" + "shipping_in_paise" + "cod_fee_in_paise" - "discount_in_paise"),
  ADD CONSTRAINT "orders_tax_within_total"
    CHECK ("tax_in_paise" IS NULL OR ("tax_in_paise" >= 0 AND "tax_in_paise" <= "total_in_paise")),
  ADD CONSTRAINT "orders_pending_has_deadline"
    CHECK ("status" <> 'PENDING_PAYMENT' OR "pending_expires_at" IS NOT NULL),
  ADD CONSTRAINT "orders_cancelled_has_reason"
    CHECK (("status" = 'CANCELLED') = ("cancellation_reason" IS NOT NULL)),
  ADD CONSTRAINT "orders_confirmed_has_timestamp"
    CHECK ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL),
  ADD CONSTRAINT "orders_email_lowercase" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "orders_deadline_extensions_non_negative" CHECK ("deadline_extensions" >= 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_items_prices_consistent"
    CHECK ("unit_price_in_paise" > 0 AND "line_total_in_paise" = "unit_price_in_paise" * "quantity"),
  ADD CONSTRAINT "order_items_tax_rate_range"
    CHECK ("tax_rate_bp" IS NULL OR ("tax_rate_bp" >= 0 AND "tax_rate_bp" <= 10000));

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_in_paise" > 0),
  ADD CONSTRAINT "payments_attempt_no_positive" CHECK ("attempt_no" >= 1),
  ADD CONSTRAINT "payments_provider_attempts_non_negative" CHECK ("provider_attempts" >= 0),
  -- An online capture always names the provider payment; COD is captured on delivery without one.
  ADD CONSTRAINT "payments_captured_has_payment_id"
    CHECK ("method" = 'COD' OR "status" NOT IN ('CAPTURED', 'REFUNDED') OR "provider_payment_id" IS NOT NULL),
  -- Past INITIATED (other than giving up), an online attempt has its provider order.
  ADD CONSTRAINT "payments_created_has_provider_order"
    CHECK ("method" = 'COD' OR "status" IN ('INITIATED', 'FAILED') OR "provider_order_id" IS NOT NULL),
  ADD CONSTRAINT "payments_cod_has_no_provider_ids"
    CHECK ("method" <> 'COD' OR ("provider_order_id" IS NULL AND "provider_payment_id" IS NULL));

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount_in_paise" > 0),
  ADD CONSTRAINT "refunds_requested_has_provider_id"
    CHECK ("status" IN ('INITIATED', 'FAILED') OR "provider_refund_id" IS NOT NULL),
  ADD CONSTRAINT "refunds_attempts_bounded" CHECK ("attempts" >= 0 AND "attempts" <= 10);

ALTER TABLE "order_access_tokens"
  ADD CONSTRAINT "order_access_tokens_expiry_after_issue" CHECK ("expires_at" > "created_at");

ALTER TABLE "payment_webhook_events"
  ADD CONSTRAINT "webhook_events_attempts_bounded" CHECK ("attempts" >= 0 AND "attempts" <= 10);

ALTER TABLE "notification_outbox"
  ADD CONSTRAINT "notification_outbox_attempts_bounded" CHECK ("attempts" >= 0 AND "attempts" <= 10);
