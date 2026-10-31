# Madhuyamini — Checkout and Payments (Phase 6)

Status: **Proposed, awaiting approval** · 31 Oct 2026 · Nothing in this document has been implemented or tested.

Scope: checkout from an ACTIVE cart to a confirmed order; stock reservation for online payments; Razorpay (server-created orders, signature and webhook verification, reconciliation); Cash on Delivery; address capture and snapshots; shipping and tax-inclusive totals; confirmation emails through a reliable outbox; order history and guest order lookup; the scheduled sweeps the earlier phases deferred. Out of scope (later phases): admin order management, refunds initiated by staff, shipments and tracking numbers, coupons, returns, invoices, reviews tied to purchases.

Related: [cart.md](cart.md) (C1–C6), [auth.md](auth.md), [data-model.md](data-model.md), [architecture.md](architecture.md) §7 (D6, D7).

---

## 0. What exists today versus what this phase adds

| Area             | Existing (Phases 1–5)                                                                                                                                                                                                              | Proposed in Phase 6                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cart             | `Cart` (`ACTIVE/MERGED/CONVERTED/ABANDONED`), `CartItem` with `priceSeenInPaise`; `getCartView` computes `canCheckout`; `cleanupCarts()` exists but is unscheduled                                                                 | Checkout reads the cart through the same `resolveCartContext`; the cart becomes `CONVERTED` when an order is confirmed, never before                         |
| Stock            | `Inventory.stockOnHand`, `Inventory.reserved`; `availableStock = stockOnHand − reserved` everywhere the storefront reads stock; `InventoryReservation` (`ACTIVE/RELEASED/CONSUMED/EXPIRED`, `expiresAt`, `closedAt`) with no owner | `orderId` on reservations; an inventory service (reserve, consume, release, expire) with conditional updates for concurrency; the expiry sweep on a schedule |
| Addresses        | `Address` book per user (phone required, six-digit PIN, country `IN`), one default; `addressSchema` reused by checkout                                                                                                             | Orders copy the address into the order row (snapshot); guests type one in                                                                                    |
| Identity         | Better Auth sessions; `requireUser`; `User.phone` optional (P2: required at checkout)                                                                                                                                              | Checkout requires a phone; guest checkout keyed by a hashed order-access cookie (same pattern as the guest cart)                                             |
| Rate limiting    | PostgreSQL fixed windows (`consumeRateLimit`), rules in `rate-limit-rules.ts`                                                                                                                                                      | New rules for place-order, payment confirmation, order lookup                                                                                                |
| Email            | file/log/Resend transports; `sendEmailAfterResponse` (best effort via `after()`)                                                                                                                                                   | A durable `notification_outbox` written in the order transaction and drained with retries; `after()` stays for auth emails                                   |
| Errors and audit | `AppError`, `NotFoundError`, `ValidationError`                                                                                                                                                                                     | `order_events` append-only timeline; typed errors for stock, payment and state                                                                               |
| Env and security | Zod-validated env; baseline headers (no `script-src` yet, D8); `proxy.ts` optimistic redirect for `/account/*`                                                                                                                     | Razorpay and cron secrets (checked at use, not at build, like Resend); webhook route; cron routes; CSP additions recorded for Phase 10                       |
| Tax              | `Product.taxRateBp`/`hsnCode` exist but are null for every product; prices are stored tax-inclusive (data-model open question 2)                                                                                                   | Items snapshot the rate; the included tax is computed only when a rate is known                                                                              |
| CI               | PostgreSQL service, migrations + seed, unit/integration/build/e2e                                                                                                                                                                  | Fake payment gateway for e2e (no network); cron endpoints exercised by tests                                                                                 |

---

## 1. Gaps and risks found during inspection

1. **Reservations have no owner and no service.** `InventoryReservation` cannot be tied to an order, and the expiry sweep exists only as a pattern inside `tests/integration/reservations.test.ts`. Phase 6 adds `orderId` and the service.
2. **No order, payment, webhook, event or outbox tables.** All new (migration 6).
3. **Tax is undecided (D7).** Every product has `taxRateBp = null`. Whether the business is GST-registered determines whether the order shows an included-tax line and whether invoices (Phase 8) are needed. The design works either way; the values are the owner's.
4. **Shipping and COD rules are undecided (D7).** Charges, free-shipping threshold, COD availability, fee and ceiling, serviceable area. The code will hold them as reviewed constants in one file (`pricing-rules.ts`) with unit tests; an admin-editable table is Phase 7.
5. **Razorpay live activation needs policy pages** (Contact, Terms, Privacy, Refund/Cancellation, Shipping), which are Phase 9. Phase 6 can be built and verified in **test mode**; go-live needs those pages first (roadmap already notes this).
6. **The frontend success callback is not proof of payment.** The design verifies the signature and then confirms capture from Razorpay's API or webhook before any order is marked paid.
7. **Webhooks arrive out of order and more than once** (Razorpay documents both). Every transition is guarded and every event id is stored once.
8. **`after()` is best effort.** Order emails go through a durable outbox instead.
9. **Email verification is not required to buy** (P1). Guest and unverified customers can order; the confirmation email is sent to the address given. Verification stays a nudge.
10. **Content-Security-Policy (D8, Phase 10)** must later allow `https://checkout.razorpay.com` (script, frame) and `https://api.razorpay.com` (frame, connect). Recorded now so Phase 10 does not break checkout.
11. **Secrets at build time.** Following the Resend precedent, missing Razorpay keys must not fail a build or preview; they fail the first payment attempt with a clear server-side error.
12. **Sequential order numbers reveal volume.** Recommend non-sequential numbers for customers; accounting continuity, if needed, comes from invoice numbers in Phase 8.
13. **Node 24 in `.nvmrc`, Node 22 locally.** The `razorpay` SDK (2.9.8, July 2026) has no special engine requirement; no change needed, noted for completeness.

---

## 2. Decisions needed before implementation

| #       | Question                                       | Recommendation                                                                                                                                                                                                                                                                               |
| ------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D6**  | Reservation lifetime for online payments       | **15 minutes** from order creation, extended once by 15 minutes when a new payment attempt starts inside the window (max 30). Razorpay's checkout modal itself times out well within this.                                                                                                   |
| **D7a** | Shipping charge and free-shipping threshold    | You supply the figures (for example a flat charge below a threshold, free above). India only in Phase 6; one zone. Weight-based or zoned rates can replace the rule later without schema change (`shippingInPaise` is snapshotted on the order).                                             |
| **D7b** | Cash on Delivery                               | Enabled, with a maximum order value and an optional fee you set; requires a phone number; stock is committed immediately (§5). Not offered for one-of-a-kind pieces above the ceiling.                                                                                                       |
| **D7c** | GST                                            | Prices stay tax-inclusive. If you are registered, you supply HSN and rate per product and the order shows "Includes GST ₹x"; if not, no tax line is shown. Invoices are Phase 8.                                                                                                             |
| **P6**  | Guest checkout                                 | **Allow it** (email + phone + address). Orders are reachable through a signed-in account or a guest order-access cookie, and later through order-number + email lookup. A guest order is linked to an account that signs up with the same email (Phase 8).                                   |
| **P7**  | Order numbers                                  | Non-sequential, readable: `MY-` + 8 characters from an unambiguous alphabet (e.g. `MY-7K3Q9ZHD`), unique in the database. Not guessable in practice; lookups are rate-limited anyway.                                                                                                        |
| **P8**  | Payment captured after the reservation expired | If stock is still available, confirm the order (the customer paid). If not, place the order in `NEEDS_REVIEW` and **automatically request a full refund** through the Razorpay API, email the customer, and record the event. Alternative: hold for an admin (but admin tooling is Phase 7). |
| **P9**  | Customer cancellation                          | Online orders can be cancelled by the customer only while `PENDING_PAYMENT` (abandons the attempt and releases stock). Cancelling a confirmed order needs a refund and is Phase 7 (admin) unless you want a self-service window now.                                                         |
| **P10** | Owner notification                             | Send a copy of each confirmation to an owner inbox through the same outbox (set `ORDER_NOTIFY_EMAIL`).                                                                                                                                                                                       |
| **P11** | Payment methods offered in the Razorpay modal  | Razorpay's defaults (UPI, cards, net banking, wallets). Restricting methods is a Dashboard setting, not code.                                                                                                                                                                                |
| **P12** | Pricing drift between review and submit        | Re-price on the server at submit; if any line's price or the total differs from what the page showed, do **not** place the order — show the new totals and ask again. (Never charge more than the customer saw.)                                                                             |

---

## 3. Data model additions (migration 6, `orders_payments_and_outbox`)

```prisma
enum OrderStatus        { PENDING_PAYMENT  CONFIRMED  CANCELLED  NEEDS_REVIEW }   // Phase 7/8 append PROCESSING, SHIPPED, DELIVERED, RETURNED
enum CancellationReason { PAYMENT_FAILED  PAYMENT_TIMEOUT  CUSTOMER  STOCK_UNAVAILABLE  ADMIN }
enum PaymentMethod      { RAZORPAY  COD }
enum PaymentStatus      { CREATED  AUTHORIZED  CAPTURED  FAILED  REFUNDED }
enum OrderActor         { CUSTOMER  SYSTEM  WEBHOOK  CRON  ADMIN }
enum WebhookStatus      { RECEIVED  PROCESSED  IGNORED  FAILED }
enum NotificationStatus { PENDING  SENT  FAILED }

model Order {
  id                 String             @id @default(uuid(7)) @db.Uuid
  orderNumber        String             @unique @map("order_number")
  userId             String?            @map("user_id") @db.Uuid          // null for guests
  /// Guest access: SHA-256 of a random token in an HttpOnly cookie (same pattern as the cart).
  accessTokenHash    String?            @unique @map("access_token_hash")
  email              String                                                // lower-cased
  phone              String                                                // E.164
  status             OrderStatus        @default(PENDING_PAYMENT)
  paymentMethod      PaymentMethod      @map("payment_method")
  currency           String             @default("INR")
  subtotalInPaise    Int                @map("subtotal_in_paise")
  shippingInPaise    Int                @map("shipping_in_paise")
  codFeeInPaise      Int                @default(0) @map("cod_fee_in_paise")
  discountInPaise    Int                @default(0) @map("discount_in_paise")   // coupons arrive in Phase 8
  totalInPaise       Int                @map("total_in_paise")
  /// Tax included in `totalInPaise`, informational; null when no product rate is known.
  taxInPaise         Int?               @map("tax_in_paise")
  // Shipping address snapshot (billing = shipping in Phase 6).
  recipientName      String             @map("recipient_name")
  addressLine1       String             @map("address_line1")
  addressLine2       String?            @map("address_line2")
  landmark           String?
  city               String
  state              String
  postalCode         String             @map("postal_code")
  country            String             @default("IN")
  customerNote       String?            @map("customer_note")
  cartId             String?            @map("cart_id") @db.Uuid
  /// Online orders: the reservation deadline. Null for COD.
  pendingExpiresAt   DateTime?          @map("pending_expires_at")
  confirmedAt        DateTime?          @map("confirmed_at")
  cancelledAt        DateTime?          @map("cancelled_at")
  cancellationReason CancellationReason? @map("cancellation_reason")
  createdAt          DateTime           @default(now()) @map("created_at")
  updatedAt          DateTime           @updatedAt @map("updated_at")
  user         User?                   @relation(fields: [userId], references: [id], onDelete: SetNull)  // orders outlive accounts (accounting)
  cart         Cart?                   @relation(fields: [cartId], references: [id], onDelete: SetNull)
  items        OrderItem[]
  payments     Payment[]
  reservations InventoryReservation[]
  events       OrderEvent[]
  notifications NotificationOutbox[]
  @@unique([cartId], map: "orders_one_pending_per_cart", where: { status: "PENDING_PAYMENT" })
  @@index([userId, createdAt])
  @@index([status, pendingExpiresAt])
  @@index([email])
  @@map("orders")
}

/// Immutable snapshot of what was bought, at the price it was bought.
model OrderItem {
  id               String  @id @default(uuid(7)) @db.Uuid
  orderId          String  @map("order_id") @db.Uuid
  variantId        String  @map("variant_id") @db.Uuid
  productSlug      String  @map("product_slug")
  productTitle     String  @map("product_title")
  variantTitle     String? @map("variant_title")
  sku              String
  quantity         Int
  unitPriceInPaise Int     @map("unit_price_in_paise")
  lineTotalInPaise Int     @map("line_total_in_paise")
  taxRateBp        Int?    @map("tax_rate_bp")
  hsnCode          String? @map("hsn_code")
  imageUrl         String? @map("image_url")
  imageAlt         String? @map("image_alt")
  order   Order          @relation(fields: [orderId], references: [id], onDelete: Cascade)   // orders are never deleted by the app
  variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Restrict) // sold variants are archived, not deleted (promised in data-model.md §3)
  @@unique([orderId, variantId])
  @@map("order_items")
}

/// One row per payment attempt. Razorpay needs a fresh provider order per attempt.
model Payment {
  id                 String        @id @default(uuid(7)) @db.Uuid
  orderId            String        @map("order_id") @db.Uuid
  method             PaymentMethod
  status             PaymentStatus @default(CREATED)
  amountInPaise      Int           @map("amount_in_paise")
  currency           String        @default("INR")
  providerOrderId    String?       @unique @map("provider_order_id")     // razorpay order_...
  providerPaymentId  String?       @unique @map("provider_payment_id")   // razorpay pay_...
  providerRefundId   String?       @map("provider_refund_id")
  signatureVerifiedAt DateTime?    @map("signature_verified_at")
  authorizedAt       DateTime?     @map("authorized_at")
  capturedAt         DateTime?     @map("captured_at")
  failedAt           DateTime?     @map("failed_at")
  failureCode        String?       @map("failure_code")
  failureDescription String?       @map("failure_description")
  createdAt          DateTime      @default(now()) @map("created_at")
  updatedAt          DateTime      @updatedAt @map("updated_at")
  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId, createdAt])
  @@map("payments")
}

/// Every webhook delivery, keyed by Razorpay's event id: the idempotency ledger.
model PaymentWebhookEvent {
  id          String        @id                      // x-razorpay-event-id
  eventType   String        @map("event_type")
  status      WebhookStatus @default(RECEIVED)
  orderId     String?       @map("order_id") @db.Uuid
  payload     Json
  error       String?
  receivedAt  DateTime      @default(now()) @map("received_at")
  processedAt DateTime?     @map("processed_at")
  @@index([status, receivedAt])
  @@map("payment_webhook_events")
}

/// Append-only timeline: who changed what, and why. Never updated or deleted by application code.
model OrderEvent {
  id         String       @id @default(uuid(7)) @db.Uuid
  orderId    String       @map("order_id") @db.Uuid
  type       String                                   // e.g. order.placed, payment.captured, reservation.expired
  actor      OrderActor
  fromStatus OrderStatus? @map("from_status")
  toStatus   OrderStatus? @map("to_status")
  note       String?
  data       Json?
  createdAt  DateTime     @default(now()) @map("created_at")
  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId, createdAt])
  @@map("order_events")
}

/// Durable email queue, written in the same transaction as the state it announces.
model NotificationOutbox {
  id            String             @id @default(uuid(7)) @db.Uuid
  kind          String                                  // order.confirmed, order.cancelled, order.refund_requested, owner.new_order
  dedupeKey     String             @unique @map("dedupe_key")   // `${kind}:${orderId}` — one email per fact
  orderId       String?            @map("order_id") @db.Uuid
  recipient     String
  status        NotificationStatus @default(PENDING)
  attempts      Int                @default(0)
  nextAttemptAt DateTime           @default(now()) @map("next_attempt_at")
  lastError     String?            @map("last_error")
  sentAt        DateTime?          @map("sent_at")
  createdAt     DateTime           @default(now()) @map("created_at")
  order Order? @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([status, nextAttemptAt])
  @@map("notification_outbox")
}

// Existing model, two additions:
model InventoryReservation {
  // ... existing fields unchanged ...
  orderId String? @map("order_id") @db.Uuid     // nullable so Phase 3 rows and tests stay valid
  order   Order?  @relation(fields: [orderId], references: [id], onDelete: Restrict)
  @@unique([orderId, variantId])
}
// Existing models gain back-relations only: User.orders, Cart.orders, ProductVariant.orderItems.
```

**Hand-written constraints in the migration SQL** (tested in `tests/integration/constraints.test.ts`):

| Constraint                               | Rule                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `orders_amounts_non_negative`            | every `*_in_paise` ≥ 0                                                             |
| `orders_total_consistent`                | `total = subtotal + shipping + cod_fee − discount`                                 |
| `orders_tax_within_total`                | `tax_in_paise IS NULL OR tax_in_paise BETWEEN 0 AND total_in_paise`                |
| `orders_owner_present`                   | `user_id IS NOT NULL OR access_token_hash IS NOT NULL`                             |
| `orders_pending_has_deadline`            | `status <> 'PENDING_PAYMENT' OR pending_expires_at IS NOT NULL`                    |
| `orders_cancelled_has_reason`            | `status <> 'CANCELLED' OR cancellation_reason IS NOT NULL`                         |
| `orders_email_lowercase`                 | `email = lower(email)`                                                             |
| `order_items_quantity_positive`          | `quantity > 0`                                                                     |
| `order_items_prices_consistent`          | `unit_price_in_paise > 0 AND line_total_in_paise = unit_price_in_paise * quantity` |
| `payments_amount_positive`               | `amount_in_paise > 0`                                                              |
| `payments_captured_has_payment_id`       | `status <> 'CAPTURED' OR provider_payment_id IS NOT NULL`                          |
| `payments_cod_has_no_provider_ids`       | `method <> 'COD' OR (provider_order_id IS NULL AND provider_payment_id IS NULL)`   |
| `notification_outbox_attempts_bounded`   | `attempts BETWEEN 0 AND 10`                                                        |
| `inventory_reservations_order_or_legacy` | none: `order_id` stays nullable (see §1.1)                                         |

`rollback.sql` drops the new tables and enums in reverse dependency order and removes `inventory_reservations.order_id` (+ its index). It is exercised on the test database before the phase is reported, as in Phases 4–5.

---

## 4. Money, shipping and tax

- All arithmetic in integer paise (`src/lib/money.ts` stays display-only).
- `subtotal = Σ unitPrice × quantity` over the order items, read from `ProductVariant.priceInPaise` **at placement**, never from the cart's `priceSeenInPaise` and never from the client.
- `shipping = shippingCharge(subtotal, postalCode)` from `src/features/checkout/pricing-rules.ts` (D7a). Pure, unit-tested; values are the owner's.
- `codFee` only for COD (D7b); `discount = 0` until Phase 8.
- `total = subtotal + shipping + codFee − discount` (also a CHECK).
- Tax (D7c): per item `includedTax = round(lineTotal × rate / (10000 + rate))`; `order.taxInPaise = Σ` only when every item has a rate, else null and no tax line is displayed. The included tax never changes the total.
- Minimum order: Razorpay requires ≥ ₹1.00; a `total < 100` paise order is refused.
- Razorpay receives `amount = total` and `currency = "INR"`; the capture is compared back to exactly those values.

---

## 5. Order lifecycle and stock

### 5.1 Order states

```
                        ┌───────────────────────── capture verified (callback+API, or webhook) ──────────────┐
                        │                                                                                      ▼
  place (online) ──► PENDING_PAYMENT ──(timeout, customer cancel, stock lost)──► CANCELLED              CONFIRMED
                        │                                                           ▲                       ▲
                        └──(capture with amount/currency mismatch)──► NEEDS_REVIEW ─┴── admin (Phase 7) ────┘
  place (COD) ──────────────────────────────────────────────────────────────────────────────────────────────► CONFIRMED
  capture arrives after CANCELLED: stock available → CONFIRMED (event "late capture"); not available → NEEDS_REVIEW + automatic refund (P8)
```

Phase 7/8 append `PROCESSING → SHIPPED → DELIVERED` and `RETURNED` after `CONFIRMED`; adding enum values is an online migration.

### 5.2 Payment attempt states

`CREATED → AUTHORIZED → CAPTURED`, `CREATED → FAILED`, `AUTHORIZED → FAILED` (auto-refund by Razorpay if never captured), `CAPTURED → REFUNDED` (Phase 6 only for the automatic P8 path). Guard: `FAILED` never overwrites `CAPTURED`; `CAPTURED` is terminal except for `REFUNDED`.

### 5.3 Reservation states (existing enum)

`ACTIVE → CONSUMED` (order confirmed), `ACTIVE → RELEASED` (order cancelled before expiry), `ACTIVE → EXPIRED` (sweep). Invariant kept by every transition: `Inventory.reserved = Σ quantity of ACTIVE holds` (the Phase 3 test already pins this).

### 5.4 Stock handling, concurrency-safe

All stock changes are **conditional single-row updates**, so no read-then-write race exists and no explicit locking order is needed:

```sql
-- reserve (online placement); 0 rows affected = not enough stock
UPDATE inventory SET reserved = reserved + $q
 WHERE variant_id = $v AND stock_on_hand - reserved >= $q;

-- commit (COD placement, or a late capture re-securing stock)
UPDATE inventory SET stock_on_hand = stock_on_hand - $q
 WHERE variant_id = $v AND stock_on_hand - reserved >= $q;

-- consume (online confirmation): the hold becomes a sale
UPDATE inventory SET stock_on_hand = stock_on_hand - $q, reserved = reserved - $q
 WHERE variant_id = $v AND reserved >= $q;

-- release / expire
UPDATE inventory SET reserved = reserved - $q WHERE variant_id = $v AND reserved >= $q;
```

Each runs inside the transaction that changes the matching reservation/order rows; variants are processed in sorted id order; a 0-row result aborts the transaction with `StockUnavailableError` naming the line, and the cart page then shows that line as limited/sold out (Phase 5 states). The existing `cart_items`/`clampQuantity` limits still apply, but **placement trusts only the conditional update**, never the cart's earlier availability read.

### 5.5 Transaction boundaries

| Operation                  | One transaction containing                                                                                                                                                                                                                                          | Outside the transaction                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Place order (online)       | lock cart row (existing `lockCart`); re-read lines + live prices; price/`canCheckout` checks; totals; insert order + items; reserve stock (conditional updates) + reservations with `orderId`; `order_events: order.placed`                                         | Razorpay `orders.create` → insert `payments` row `CREATED`; redirect to the pay page          |
| Place order (COD)          | as above but commit stock (`stock_on_hand −= q`), no reservations; status `CONFIRMED`; cart → `CONVERTED`; outbox rows (customer + owner); events                                                                                                                   | —                                                                                             |
| Start another attempt      | insert `payments` row after a successful `orders.create`; optionally extend `pendingExpiresAt` once (D6)                                                                                                                                                            | Razorpay call first                                                                           |
| Confirm capture (callback) | — (verification only)                                                                                                                                                                                                                                               | signature check → `payments.fetch` → then `confirmOrderPayment` (below)                       |
| `confirmOrderPayment`      | lock order row; if already `CONFIRMED` → no-op; mark payment `CAPTURED`; consume reservations; order → `CONFIRMED`; cart → `CONVERTED`; outbox rows; event. Mismatch → `NEEDS_REVIEW` + event. Late capture → re-secure or `NEEDS_REVIEW` + refund-requested outbox |
| Webhook                    | insert `payment_webhook_events` (unique id; duplicate → return 200 without processing); then the matching transition in its own transaction; mark event `PROCESSED`/`FAILED`                                                                                        | HTTP 200 only after the event row is committed; 500 on processing failure so Razorpay retries |
| Expiry sweep               | per order: `SELECT … FOR UPDATE SKIP LOCKED` on the order; expire its holds + release; order → `CANCELLED (PAYMENT_TIMEOUT)`; event                                                                                                                                 | before cancelling, `orders.fetch` on Razorpay: if `paid`, confirm instead (missed webhook)    |
| Outbox drain               | claim rows `FOR UPDATE SKIP LOCKED`; send; mark `SENT` or schedule retry with backoff (1, 5, 15, 60, 180 min; `FAILED` after 10)                                                                                                                                    | the send itself                                                                               |

Prisma interactive transactions are used (`db.$transaction(async tx => …)`), as the cart merge already does; the conditional updates run through `tx.$executeRaw` with parameters (`Prisma.sql`), as the catalog listing does.

---

## 6. Razorpay integration

Verified against Razorpay's documentation on 31 Oct 2026 (Orders API, server integration guide, webhook validation, capture settings):

- **Order creation:** `POST /v1/orders` with Basic auth (`key_id:key_secret`), `amount` in paise, `currency: "INR"`, `receipt` (≤ 40 ASCII chars, unique — we use `${orderNumber}-${attemptNo}`), `notes: { orderId, orderNumber }`. Razorpay states that an `order_id` must not be reused after a failed payment, hence one `payments` row per attempt.
- **Capture:** configure **auto-capture** in the Dashboard (the capture settings page confirms this is the default and that uncaptured payments are auto-refunded after the configured window). The app treats `authorized` as "not yet paid" and only `captured` as paid.
- **Checkout:** `https://checkout.razorpay.com/v1/checkout.js` in a client component on the pay page, with `key` (public key id), `order_id`, `amount`, `currency`, `prefill` (name, email, phone), `notes`, `theme.color` and `modal.ondismiss`. No card data touches our server.
- **Callback verification:** `HMAC-SHA256(key_secret, "<our provider_order_id>|<razorpay_payment_id>")` compared to `razorpay_signature` with `timingSafeEqual`. The docs say to use the order id from our server, not from the callback — we look the attempt up by `providerOrderId` and require it to belong to the order in the request. A valid signature then triggers `payments.fetch(razorpay_payment_id)`; the order is confirmed only if `status === "captured"`, `amount === total`, `currency === "INR"` and `order_id` matches. `authorized` → "payment is being confirmed" page that polls (webhook/reconciliation will finish it).
- **Webhooks:** `POST /api/webhooks/razorpay`; raw body (`await request.text()`), `X-Razorpay-Signature` = HMAC-SHA256 of the raw body with the webhook secret, constant-time compare; `x-razorpay-event-id` stored with a unique constraint (Razorpay says duplicates and out-of-order delivery are expected). Subscribed events: `payment.captured`, `payment.failed`, `payment.authorized` (recorded), `order.paid` (treated like `payment.captured`); refund events are stored and ignored until Phase 7. Secret rotation: `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` optional, tried second.
- **Reconciliation:** `orders.fetch` / `orders.fetchPayments` from the sweep and a 15-minute reconciliation cron for `PENDING_PAYMENT` orders with attempts older than 2 minutes, so a missed webhook never strands a paid order.
- **Refunds (automatic path only, P8):** `POST /v1/payments/:id/refund` for the full amount with `notes: { orderId, reason }`; recorded on the `payments` row (`providerRefundId`, `REFUNDED`) and in events; the customer is emailed. Staff-initiated refunds are Phase 7.
- **SDK:** `razorpay` 2.9.8 (npm `latest`, July 2026), server-only, wrapped behind a `PaymentGateway` interface so services and tests never import the SDK directly:

```ts
interface PaymentGateway {
  createOrder(input: {
    amountInPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<{ providerOrderId: string }>;
  fetchPayment(providerPaymentId: string): Promise<GatewayPayment>; // status, amount, currency, orderId, method
  fetchOrderPayments(providerOrderId: string): Promise<GatewayPayment[]>;
  refund(
    providerPaymentId: string,
    input: { amountInPaise: number; notes: Record<string, string> },
  ): Promise<{ providerRefundId: string }>;
  verifyCheckoutSignature(
    providerOrderId: string,
    providerPaymentId: string,
    signature: string,
  ): boolean;
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}
```

Implementations: `razorpayGateway` (production/preview/manual testing) and `fakeGateway` (development, tests, CI) chosen by `PAYMENT_GATEWAY=razorpay|fake`; the env schema **refuses `fake` in production**, exactly as `EMAIL_TRANSPORT` refuses non-Resend there.

---

## 7. Checkout flow and pages

| Route                                                                                                                | Purpose                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/checkout`                                                                                                          | Single page: contact (email, phone; prefilled and locked to the account email when signed in), address (saved addresses as a radio list with "use a different address", or the `addressSchema` form), payment method (Razorpay / COD when eligible), order summary with live totals, "Place order". Requires `canCheckout`; otherwise sends back to `/cart` with the issues shown. Works without JavaScript. |
| `/checkout/pay/[orderId]`                                                                                            | Online orders in `PENDING_PAYMENT`: opens the Razorpay modal; "Try again" starts a new attempt; countdown to `pendingExpiresAt`; "Cancel order" (P9). Reached only by the owner (session or order-access cookie).                                                                                                                                                                                            |
| `/checkout/confirming/[orderId]`                                                                                     | Shown when the callback was verified but capture is not yet visible (`authorized`): polls every few seconds via a Server Action until confirmed, failed or expired.                                                                                                                                                                                                                                          |
| `/checkout/confirmation/[orderId]`                                                                                   | Order placed: number, items, totals, address, payment method, what happens next. `noindex`.                                                                                                                                                                                                                                                                                                                  |
| `/account/orders`, `/account/orders/[orderNumber]`                                                                   | History and detail with the event timeline in customer language; "Pay now" for pending online orders.                                                                                                                                                                                                                                                                                                        |
| `/orders/track`                                                                                                      | Guest lookup by order number + email (rate-limited; identical response for unknown pairs).                                                                                                                                                                                                                                                                                                                   |
| `/api/webhooks/razorpay`                                                                                             | Webhook receiver (POST only, no cookies, raw body).                                                                                                                                                                                                                                                                                                                                                          |
| `/api/cron/expire-reservations`, `/api/cron/reconcile-payments`, `/api/cron/send-notifications`, `/api/cron/cleanup` | Vercel Cron (`vercel.json`), each requiring `Authorization: Bearer ${CRON_SECRET}`; safe to run concurrently (`SKIP LOCKED`) and to run by hand or from tests.                                                                                                                                                                                                                                               |

**Server Actions** (all Zod strict, all rate-limited, all resolve the cart/order from the request):

| Action                       | Input                                                                                         | Result                                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `placeOrderAction`           | contact, address (saved `addressId` or fields), `paymentMethod`, `customerNote?`, `quoteHash` | redirect to pay page (online) or confirmation (COD); typed errors: prices changed, stock lost, address invalid, COD not eligible |
| `startPaymentAttemptAction`  | `orderId`                                                                                     | new provider order; re-renders the pay page                                                                                      |
| `confirmPaymentAction`       | `orderId`, `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`                   | confirmed → confirmation page; authorized → confirming page; invalid → error, nothing changes                                    |
| `recordPaymentFailureAction` | `orderId`, Razorpay error fields from the modal                                               | records on the attempt; order stays pending until timeout                                                                        |
| `cancelPendingOrderAction`   | `orderId`                                                                                     | `CANCELLED (CUSTOMER)`, stock released, cart stays `ACTIVE`                                                                      |
| `checkOrderStatusAction`     | `orderId`                                                                                     | status for the confirming page's polling                                                                                         |
| `trackOrderAction`           | `orderNumber`, `email`                                                                        | issues the order-access cookie and redirects to the order; generic failure otherwise                                             |

`quoteHash` (P12) is a SHA-256 over the server-computed quote (line ids, quantities, unit prices, shipping, total) rendered into the form; at submit the server recomputes and compares. It is a consistency check, not a trusted price.

**States and accessibility:** loading skeletons; empty cart → cart page; stock lost → the exact lines named; price changed → new totals and a re-confirm; payment failed → reason in plain words + retry; expired → "this checkout timed out, your cart is still here"; all live regions polite, buttons disabled while pending, axe on every page, keyboard-only path through address radio → payment radio → place order. Design: existing tokens and components (`Button`, `Container`, forms from Phase 4), Madhubani motif dividers; no Tailwind.

---

## 8. Cash on Delivery (D7b)

- Offered when: COD enabled, `total ≤ codMaxInPaise`, no line is one-of-a-kind above the ceiling, PIN serviceable (single zone in Phase 6), phone present.
- Placement commits stock immediately (`stock_on_hand −= q` conditionally) and the order is `CONFIRMED`; a `payments` row with `method: COD, status: CREATED, amount: total` records what is to be collected (marked `CAPTURED` on delivery in Phase 7/8).
- No reservation rows for COD (nothing is pending).
- Cancellation before dispatch returns stock (Phase 7 admin; customer self-service per P9).
- Abuse controls: rate limits on placement per identity and per IP; the confirmation email states the amount due; repeated COD refusals are a Phase 7 admin concern (flag on the customer).

---

## 9. Failure scenarios

| #   | Scenario                                                        | Handling                                                                                                                                                                                |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Double submit of "Place order"                                  | Cart row lock serialises; the partial unique index `orders_one_pending_per_cart` makes the second insert fail → the action returns the existing pending order (resume), no second order |
| 2   | Razorpay `orders.create` fails/times out after our order commit | Order stays `PENDING_PAYMENT` without an attempt; pay page shows "Try again"; sweep cancels at the deadline                                                                             |
| 3   | Customer closes the modal                                       | Attempt stays `CREATED`; "Try again" creates a new provider order; nothing else changes                                                                                                 |
| 4   | Payment fails at the bank                                       | `payment.failed` (modal + webhook) → attempt `FAILED` with Razorpay's `error_code/description/reason`; order pending; retry allowed until the deadline                                  |
| 5   | Success callback never reaches us (tab closed, network)         | Webhook `payment.captured` confirms; if the webhook is also missed, the reconciliation cron fetches payments and confirms                                                               |
| 6   | Webhook arrives before the callback                             | Webhook confirms; the callback finds `CONFIRMED` and shows the confirmation (idempotent)                                                                                                |
| 7   | Duplicate webhook delivery                                      | Unique event id → 200 without processing                                                                                                                                                |
| 8   | Invalid webhook signature                                       | 401, logged without the body, no state change                                                                                                                                           |
| 9   | Out-of-order events (`failed` after `captured`)                 | Guarded transitions; `FAILED` never overwrites `CAPTURED`                                                                                                                               |
| 10  | Capture after the reservation expired and the order cancelled   | Re-secure stock conditionally → `CONFIRMED` with a "late capture" event; otherwise `NEEDS_REVIEW` + automatic full refund + email (P8)                                                  |
| 11  | Captured amount or currency differs from the order              | `NEEDS_REVIEW`, never `CONFIRMED`; event with both figures; owner emailed                                                                                                               |
| 12  | Two customers buy the last unit                                 | The conditional update admits exactly one; the other sees "stock lost" naming the line                                                                                                  |
| 13  | Prices change between review and submit                         | Server re-prices; `quoteHash` differs → no order; the page shows the new totals (P12)                                                                                                   |
| 14  | Email provider down                                             | Outbox retries with backoff; the order is unaffected; `FAILED` rows are visible to Phase 7 admin                                                                                        |
| 15  | Replaying someone else's verified callback                      | The attempt is looked up by provider order id and must belong to the order the caller owns; the signature binds order id + payment id                                                   |
| 16  | Cron runs overlap or run twice                                  | Row claims with `FOR UPDATE SKIP LOCKED`; every transition idempotent                                                                                                                   |
| 17  | Webhook secret rotated                                          | Previous secret accepted during the overlap window                                                                                                                                      |
| 18  | Server crash mid-transaction                                    | Nothing partial persists; the customer retries                                                                                                                                          |
| 19  | Razorpay keys missing in a preview deployment                   | Build succeeds; the first `orders.create` fails with a clear server-side error and the customer sees "online payment is unavailable"; COD still works                                   |

---

## 10. Security, authorization and auditability

- **Trust boundary:** the server computes every amount; the client sends only an address, a method and ids. Payment status comes from a verified signature **plus** Razorpay's API or webhook, never from the browser alone.
- **Ownership:** orders are read by `(id, userId)` for customers, by `(id, accessTokenHash)` for guests; the access cookie (`__Host-my_order` in production, HttpOnly, SameSite=Lax, 7 days) carries a random 256-bit token stored only as a hash. Account pages use `requireUser`; `proxy.ts` is unchanged (optimistic only).
- **CSRF:** Server Actions are origin-checked by Next; the webhook route accepts POST without cookies; cron routes require the bearer secret and reject GET without it.
- **Rate limits (new rules in `rate-limit-rules.ts`):** place order 5/10 min per identity and 20/10 min per IP; confirm payment 20/10 min per order; start attempt 5/15 min per order; order lookup 10/15 min per IP and 5/hour per email; webhook route 600/min per IP (defensive).
- **Secrets:** `RAZORPAY_KEY_ID` (public), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_SECRET_PREVIOUS?`, `CRON_SECRET`, `PAYMENT_GATEWAY`, `ORDER_NOTIFY_EMAIL?` added to `env-schema.ts`; required in production **at use time**; never logged.
- **PII:** address snapshots are personal data; logs carry order ids only; the Phase 8/10 DPDP work must anonymise `email/phone/address` on account deletion while keeping amounts (accounting) — noted, not done here.
- **Audit:** `order_events` is append-only by convention (no update/delete code paths; a DB-level rule needs a second role and is a Phase 10 hardening item); every status change, payment transition, stock change, cron action and email send writes an event with its actor.
- **Webhook hygiene:** body limited to 256 KB; signature verified before parsing; parsed with a Zod schema; unknown event types stored as `IGNORED`.
- **CSP (Phase 10):** add `script-src https://checkout.razorpay.com`, `frame-src https://api.razorpay.com https://checkout.razorpay.com`, `connect-src https://api.razorpay.com https://lumberjack.razorpay.com`; recorded in architecture.md D8.
- **PCI:** hosted checkout; no card data is received, stored or logged.

---

## 11. Emails and notifications

Templates (plain text + minimal HTML, same `layout` as auth): order confirmation (items, totals, address, payment method, order number, link), payment-failed/timeout notice (optional, P9), refund requested (P8 path), owner new-order notice (P10). All go through `notification_outbox` rows created **inside** the confirming transaction (`dedupeKey = kind:orderId`), drained by the cron and, opportunistically, by `after()` right after the transaction (fast path; the cron is the guarantee).

---

## 12. Files

| Area      | Files                                                                                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema    | `prisma/schema.prisma`, `prisma/migrations/<ts>_orders_payments_and_outbox/{migration.sql,rollback.sql}`                                                                                                                                               |
| Env       | `src/server/env-schema.ts` (+ tests), `.env.example`, `README.md`                                                                                                                                                                                      |
| Inventory | `src/features/inventory/{data,service}.ts` (reserve/commit/consume/release/expire), tests                                                                                                                                                              |
| Checkout  | `src/features/checkout/{pricing-rules,rules,schemas,types,data,service,actions}.ts` (quote, placement, cancellation, order access), `src/components/checkout/*`, `src/app/(storefront)/checkout/**`                                                    |
| Payments  | `src/server/payments/{gateway,razorpay,fake,signatures}.ts`, `src/features/payments/{data,service,actions,webhook}.ts`, `src/app/api/webhooks/razorpay/route.ts`                                                                                       |
| Orders    | `src/features/orders/{data,service,types}.ts` (history, detail, tracking, state machine `transitions.ts`), `src/app/(storefront)/account/orders/**`, `src/app/(storefront)/orders/track/page.tsx`, `src/components/orders/*`                           |
| Jobs      | `src/server/jobs/{expire-reservations,reconcile-payments,send-notifications,cleanup}.ts`, `src/app/api/cron/*/route.ts`, `vercel.json`                                                                                                                 |
| Email     | `src/server/email/templates.ts` (+ order templates), `src/server/notifications/{outbox,service}.ts`                                                                                                                                                    |
| Routes    | `src/lib/routes.ts` (`checkout`, `checkoutPay`, `checkoutConfirmation`, `accountOrders`, `accountOrder`, `trackOrder`); `/cart` gains "Proceed to checkout" gated on `canCheckout`; `account/page.tsx` loses its "orders will appear here" placeholder |
| Docs      | `docs/checkout.md` (this file → implemented notes), `docs/business-rules.md` (D7 values as approved), `docs/roadmap.md`, `docs/data-model.md`, `docs/architecture.md` (D6 decided, D8 CSP list), `CLAUDE.md` (payment rules), `README.md`              |

---

## 13. Test matrix

| Level                  | What is proven                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Unit**               | pricing rules (shipping tiers, COD eligibility and fee, included-tax split and rounding, totals, minimum amount); `quoteHash` stability; order-number alphabet and uniqueness probability; state-machine transitions (every allowed and forbidden edge, incl. `FAILED` never after `CAPTURED`); HMAC verification with known vectors for checkout and webhook signatures, timing-safe compare, previous-secret fallback; webhook payload schemas; env schema (fake gateway refused in production, secrets optional at build); outbox backoff schedule; email templates contain no secrets                                                                                                                                                                                                                                                                                            |
| **Integration**        | placement: snapshots match live prices (not `priceSeenInPaise`), totals and CHECKs, reservations with `orderId`, `Inventory.reserved` invariant; the last unit under concurrent placements (`Promise.all`); double submit → one order; COD commits stock and confirms; price drift → refused; `canCheckout` false → refused; guest vs user ownership (another user, another token, anonymous → not found); confirm via callback with the fake gateway (captured / authorized / mismatch / wrong order); confirm via webhook; duplicate event; out-of-order events; late capture with and without stock (refund requested); expiry sweep cancels, releases and reconciles a paid order; cancel pending releases stock and keeps the cart; outbox dedupe, retry, backoff, failure after 10; order lookup rate limit and generic response; migration 6 CHECKs; `rollback.sql` exercised |
| **E2E** (fake gateway) | signed-in checkout with a saved address → pay → simulated success → confirmation → order in `/account/orders`; guest checkout → confirmation → tracking by number + email; COD order; simulated failure → retry → success; abandon → cron endpoint called by the test → cancelled, cart intact; double-click "Place order"; price drift and stock loss between review and submit stay at integration level (the e2e server must not alter the seeded catalog); keyboard-only checkout; axe on checkout, pay, confirming, confirmation, orders, tracking; no-JavaScript placement (form post)                                                                                                                                                                                                                                                                                         |
| **Manual**             | Razorpay **test mode** smoke on a preview deployment: UPI `success@razorpay` / `failure@razorpay`, card success and failure, webhook delivery to the preview URL, duplicate delivery via "resend" in the Dashboard. Documented as a checklist in `docs/checkout.md` §15 and reported with actual results; **not automated** and not claimed until run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

The fake gateway is a deterministic in-process implementation (signatures with a fixed test secret; `fetchPayment` returns what the test told it to); the e2e pay page shows a development-only "Simulate" panel **only** when `PAYMENT_GATEWAY=fake`, which production refuses.

**CI changes:** `PAYMENT_GATEWAY=fake`, `CRON_SECRET`, fake Razorpay values in the workflow env; no outbound network; the cron routes are hit by e2e with the secret. `npm audit` continues to run; `razorpay` is a runtime dependency and must pass `--audit-level=high`.

---

## 14. Implementation sequence (each step: code + tests + gates green before the next)

1. **Rules and schema:** migration 6 + rollback; `pricing-rules.ts` with the approved D7 values; state machine; env schema; `PaymentGateway` interface + fake. Unit + constraint tests.
2. **Inventory service:** conditional updates, reservation lifecycle, sweep function. Integration tests incl. concurrency.
3. **Order placement:** quote, snapshots, online + COD placement, cancellation, order access cookie, history/detail/tracking data. Integration tests.
4. **Razorpay:** gateway implementation, attempts, callback verification + API confirmation, webhook route with event ledger, reconciliation. Integration tests with the fake gateway; unit tests for signatures.
5. **Jobs and notifications:** outbox, templates, cron routes, `vercel.json`, cleanup of carts/sessions/rate limits (closing the Phase 4/5 follow-ups).
6. **UI:** checkout, pay, confirming, confirmation, account orders, tracking; cart "Proceed to checkout"; states; design review on mobile and desktop.
7. **E2E, docs, CI, security checklist**, then the manual test-mode smoke; report with real numbers; commit and push.

Estimated size: comparable to Phases 4 and 5 together; steps 1–3 are the bulk of the risk and are front-loaded.

---

## 15. Acceptance criteria

1. Every gate passes with real output; CI green; migration 6 applied and rolled back on the test database with zero drift.
2. No order is ever `CONFIRMED` without a verified signature **and** a captured payment confirmed by Razorpay's API or webhook (COD excepted), proven by tests that send a valid signature with an uncaptured payment, a tampered signature, a mismatched amount, and a replayed callback.
3. No duplicate orders, attempts, deductions or emails under double submits, duplicate webhooks, overlapping crons or concurrent captures, proven by tests.
4. `Inventory.reserved` equals the sum of `ACTIVE` holds after every test; `stockOnHand` never goes negative; the last unit is sold once.
5. Order items are immutable snapshots; changing a product price after placement changes nothing on the order.
6. Guests and customers can only see their own orders; lookup responses do not reveal whether an order number exists.
7. Confirmation emails are delivered at least once and at most once per fact, surviving a transport failure.
8. axe reports zero violations on every checkout and order page; the full checkout is keyboard-operable and works without JavaScript.
9. Phases 1–5 behaviour unchanged: the existing 131 unit, 101 integration and 249 e2e tests still pass unmodified (additions only).
