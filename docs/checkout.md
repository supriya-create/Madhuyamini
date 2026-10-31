# Madhuyamini — Checkout and Payments (Phase 6)

Status: **Proposed, awaiting approval** · 31 Oct 2026, revised 1 Nov 2026 · Nothing in this document has been implemented or tested.

Revision 2 incorporates the owner's seven refinements: no transaction spans a provider call (§5.6), durable recovery for late captures, refunds and webhooks (§5.6, §5.8), placement idempotency (§5.7), guest access tokens (§10.1), one policy configuration (§4.1), a full catalogue of transaction boundaries and lock order (§5.5), and worker-safe outbox and webhook processing (§5.8, §11.1).

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
4. **Shipping and COD rules are undecided (D7).** Charges, free-shipping threshold, COD availability, fee and ceiling, serviceable area. They live in one validated policy object (`src/config/checkout-policy.ts`, §4.1) read through a single accessor, so Phase 7 can move them to a table without touching callers.
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
/// INITIATED = our intent row exists, no provider order yet (§5.6); CREATED = provider order id persisted.
enum PaymentStatus      { INITIATED  CREATED  AUTHORIZED  CAPTURED  FAILED  REFUNDED }
enum RefundStatus       { INITIATED  REQUESTED  PROCESSED  FAILED }
enum OrderActor         { CUSTOMER  SYSTEM  WEBHOOK  CRON  ADMIN }
enum WebhookStatus      { RECEIVED  PROCESSED  IGNORED  FAILED }
enum NotificationStatus { PENDING  SENT  FAILED }

model Order {
  id                 String             @id @default(uuid(7)) @db.Uuid
  orderNumber        String             @unique @map("order_number")
  userId             String?            @map("user_id") @db.Uuid          // null for guests; guest access is in OrderAccessToken (§10.1)
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
  refunds      Refund[]
  accessTokens OrderAccessToken[]
  reservations InventoryReservation[]
  events       OrderEvent[]
  notifications NotificationOutbox[]
  // Idempotency anchor (§5.7): at most one live order per cart. Written as SQL in the
  // migration: CREATE UNIQUE INDEX orders_one_live_per_cart ON orders (cart_id) WHERE status <> 'CANCELLED';
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
/// The row is written BEFORE the provider call (status INITIATED) and carries the
/// `receipt` Razorpay also stores, so a lost response can always be recovered (§5.6).
model Payment {
  id                 String        @id @default(uuid(7)) @db.Uuid
  orderId            String        @map("order_id") @db.Uuid
  attemptNo          Int           @map("attempt_no")
  method             PaymentMethod
  status             PaymentStatus @default(INITIATED)
  amountInPaise      Int           @map("amount_in_paise")
  currency           String        @default("INR")
  /// Our idempotency reference at the provider: `${orderNumber}-${attemptNo}` (Razorpay: unique, ≤ 40 chars).
  receipt            String        @unique
  providerOrderId    String?       @unique @map("provider_order_id")     // razorpay order_...
  providerPaymentId  String?       @unique @map("provider_payment_id")   // razorpay pay_...
  signatureVerifiedAt DateTime?    @map("signature_verified_at")
  providerAttempts   Int           @default(0) @map("provider_attempts")  // createOrder tries (recovery)
  lastError          String?       @map("last_error")
  authorizedAt       DateTime?     @map("authorized_at")
  capturedAt         DateTime?     @map("captured_at")
  failedAt           DateTime?     @map("failed_at")
  failureCode        String?       @map("failure_code")
  failureDescription String?       @map("failure_description")
  createdAt          DateTime      @default(now()) @map("created_at")
  updatedAt          DateTime      @updatedAt @map("updated_at")
  order   Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  refunds Refund[]
  @@unique([orderId, attemptNo])
  @@index([orderId, createdAt])
  // SQL: CREATE UNIQUE INDEX payments_one_open_per_order ON payments (order_id)
  //      WHERE status IN ('INITIATED', 'CREATED', 'AUTHORIZED');   -- one open attempt at a time (§5.7)
  @@map("payments")
}

/// Refund intent and outcome (Phase 6: only the automatic late-capture path, P8).
/// Written in the transaction that decided it; the provider call happens later (§5.6).
model Refund {
  id                String       @id @default(uuid(7)) @db.Uuid
  orderId           String       @map("order_id") @db.Uuid
  paymentId         String       @map("payment_id") @db.Uuid
  status            RefundStatus @default(INITIATED)
  amountInPaise     Int          @map("amount_in_paise")
  reason            String                                   // late_capture_no_stock, amount_mismatch, …
  /// Sent to Razorpay as `receipt` and `notes.refundId`, so an unanswered request can be found again.
  reference         String       @unique
  providerRefundId  String?      @unique @map("provider_refund_id")
  attempts          Int          @default(0)
  nextAttemptAt     DateTime     @default(now()) @map("next_attempt_at")
  claimedAt         DateTime?    @map("claimed_at")
  claimedBy         String?      @map("claimed_by")
  lastError         String?      @map("last_error")
  requestedAt       DateTime?    @map("requested_at")
  processedAt       DateTime?    @map("processed_at")
  createdAt         DateTime     @default(now()) @map("created_at")
  updatedAt         DateTime     @updatedAt @map("updated_at")
  order   Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  payment Payment @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  @@index([status, nextAttemptAt])
  @@map("refunds")
}

/// Guest access to one order (§10.1). Random 256-bit token in an HttpOnly cookie; only the hash is stored.
model OrderAccessToken {
  id         String    @id @default(uuid(7)) @db.Uuid
  orderId    String    @map("order_id") @db.Uuid
  tokenHash  String    @unique @map("token_hash")
  expiresAt  DateTime  @map("expires_at")
  lastUsedAt DateTime? @map("last_used_at")
  revokedAt  DateTime? @map("revoked_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId])
  @@index([expiresAt])
  @@map("order_access_tokens")
}

/// Every webhook delivery, keyed by Razorpay's event id: the idempotency ledger and
/// the retry queue for processing (§5.8). Stored before anything else happens.
model PaymentWebhookEvent {
  id                String        @id                      // x-razorpay-event-id
  eventType         String        @map("event_type")
  status            WebhookStatus @default(RECEIVED)
  providerOrderId   String?       @map("provider_order_id")
  providerPaymentId String?       @map("provider_payment_id")
  orderId           String?       @map("order_id") @db.Uuid
  payload           Json
  attempts          Int           @default(0)
  nextAttemptAt     DateTime      @default(now()) @map("next_attempt_at")
  claimedAt         DateTime?     @map("claimed_at")
  claimedBy         String?       @map("claimed_by")
  lastError         String?       @map("last_error")
  receivedAt        DateTime      @default(now()) @map("received_at")
  processedAt       DateTime?     @map("processed_at")
  @@index([status, nextAttemptAt])
  @@index([providerPaymentId])
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

/// Durable email queue, written in the same transaction as the state it announces (§11.1).
model NotificationOutbox {
  id            String             @id @default(uuid(7)) @db.Uuid
  kind          String                                  // order.confirmed, order.cancelled, order.refund_requested, owner.new_order, ops.alert
  dedupeKey     String             @unique @map("dedupe_key")   // `${kind}:${orderId}` — one email per fact; also the provider idempotency key
  orderId       String?            @map("order_id") @db.Uuid
  recipient     String
  /// Everything the template needs, captured at enqueue time so a retry renders the same email.
  payload       Json
  status        NotificationStatus @default(PENDING)
  attempts      Int                @default(0)
  nextAttemptAt DateTime           @default(now()) @map("next_attempt_at")
  claimedAt     DateTime?          @map("claimed_at")
  claimedBy     String?            @map("claimed_by")
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
| `orders_pending_has_deadline`            | `status <> 'PENDING_PAYMENT' OR pending_expires_at IS NOT NULL`                    |
| `orders_cancelled_has_reason`            | `status <> 'CANCELLED' OR cancellation_reason IS NOT NULL`                         |
| `orders_email_lowercase`                 | `email = lower(email)`                                                             |
| `order_items_quantity_positive`          | `quantity > 0`                                                                     |
| `order_items_prices_consistent`          | `unit_price_in_paise > 0 AND line_total_in_paise = unit_price_in_paise * quantity` |
| `payments_amount_positive`               | `amount_in_paise > 0`                                                              |
| `payments_captured_has_payment_id`       | `status <> 'CAPTURED' OR provider_payment_id IS NOT NULL`                          |
| `payments_created_has_provider_order`    | `status = 'INITIATED' OR method = 'COD' OR provider_order_id IS NOT NULL`          |
| `payments_cod_has_no_provider_ids`       | `method <> 'COD' OR (provider_order_id IS NULL AND provider_payment_id IS NULL)`   |
| `payments_attempt_no_positive`           | `attempt_no >= 1`                                                                  |
| `orders_one_live_per_cart` (index)       | `UNIQUE (cart_id) WHERE status <> 'CANCELLED'` (§5.7)                              |
| `payments_one_open_per_order` (index)    | `UNIQUE (order_id) WHERE status IN ('INITIATED','CREATED','AUTHORIZED')` (§5.7)    |
| `refunds_amount_positive`                | `amount_in_paise > 0`                                                              |
| `refunds_requested_has_provider_id`      | `status IN ('INITIATED','FAILED') OR provider_refund_id IS NOT NULL`               |
| `order_access_tokens_expiry_after_issue` | `expires_at > created_at`                                                          |
| `notification_outbox_attempts_bounded`   | `attempts BETWEEN 0 AND 10`                                                        |
| `webhook_events_attempts_bounded`        | `attempts BETWEEN 0 AND 10`                                                        |
| `inventory_reservations_order_or_legacy` | none: `order_id` stays nullable (see §1.1)                                         |

`rollback.sql` drops the new tables and enums in reverse dependency order and removes `inventory_reservations.order_id` (+ its index). It is exercised on the test database before the phase is reported, as in Phases 4–5.

---

## 4. Money, shipping and tax

- All arithmetic in integer paise (`src/lib/money.ts` stays display-only).
- `subtotal = Σ unitPrice × quantity` over the order items, read from `ProductVariant.priceInPaise` **at placement**, never from the cart's `priceSeenInPaise` and never from the client.
- `shipping = shippingCharge(policy.shipping, subtotal, postalCode)` — a pure function over the policy (§4.1), unit-tested; values are the owner's (D7a).
- `codFee = policy.cod.feeInPaise` only for COD (D7b); `discount = 0` until Phase 8.
- `total = subtotal + shipping + codFee − discount` (also a CHECK).
- Tax (D7c): per item `includedTax = round(lineTotal × rate / (10000 + rate))`; `order.taxInPaise = Σ` only when every item has a rate, else null and no tax line is displayed. The included tax never changes the total.
- Minimum order: Razorpay requires ≥ ₹1.00; a `total < 100` paise order is refused.
- Razorpay receives `amount = total` and `currency = "INR"`; the capture is compared back to exactly those values.

### 4.1 One policy configuration, no scattered constants

Every business and operational knob lives in **one** Zod-validated object, `src/config/checkout-policy.ts`, read only through `getCheckoutPolicy()` (memoised per process). Services, actions, jobs and pages take the policy as an argument or call the accessor; no module declares its own numbers. Phase 7 can back the accessor with a `store_settings` table without touching callers.

```ts
interface CheckoutPolicy {
  shipping: {
    flatInPaise: number;
    freeAboveInPaise: number | null;
    serviceableCountries: ["IN"];
  };
  cod: {
    enabled: boolean;
    feeInPaise: number;
    maxOrderInPaise: number;
    excludeOneOfAKind: boolean;
  };
  payment: {
    minOrderInPaise: 100;
    currency: "INR";
    confirmingPollSeconds: number;
    reconcileAfterMinutes: number;
  };
  reservation: {
    ttlMinutes: number;
    extensionMinutes: number;
    maxExtensions: number;
  }; // D6
  guestAccess: { tokenTtlDays: number }; // §10.1
  jobs: {
    leaseMinutes: number;
    backoffMinutes: readonly number[];
    maxAttempts: number;
  }; // §5.8
  rateLimits: {
    placeOrder: RateLimitRule;
    startAttempt: RateLimitRule;
    confirmPayment: RateLimitRule;
    trackOrder: RateLimitRule;
  };
  notifications: { ownerEmail: string | null }; // P10 (value from env, shape here)
}
```

Rules: the values approved under D6/D7/P-decisions are the initial contents; the object is validated at startup (invalid policy fails fast, like `env`); **orders snapshot every applied value** (`shippingInPaise`, `codFeeInPaise`, `pendingExpiresAt`, token expiry), so changing the policy never alters an existing order; unit tests cover each rule against the policy, and a test asserts no other module in `src/features/checkout|payments|orders|inventory` or `src/server/jobs` contains a literal paise amount or minute count (a simple source scan).

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

`INITIATED → CREATED` (provider order id persisted, §5.6), `INITIATED → FAILED` (provider creation gave up), `CREATED → AUTHORIZED → CAPTURED`, `CREATED → FAILED`, `AUTHORIZED → FAILED` (auto-refund by Razorpay if never captured), `CAPTURED → REFUNDED` (Phase 6 only for the automatic P8 path, through a `refunds` row). Guards: `FAILED` never overwrites `CAPTURED`; `CAPTURED` is terminal except for `REFUNDED`; transitions are a pure function `nextPaymentStatus(current, event)` with a table-driven unit test.

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

### 5.5 Transaction catalogue and lock order

**Global lock order.** Every transaction acquires row locks in this order and never in reverse, so two transactions cannot deadlock: **(1) `carts`** (via the existing `lockCart`) → **(2) `orders`** (`SELECT … FOR UPDATE`) → **(3) `payments`, `refunds`** → **(4) `inventory`** rows in **ascending `variant_id`** (the conditional `UPDATE`s take the row locks) → **(5) `inventory_reservations`** → **(6) append-only inserts** (`order_items`, `order_events`, `notification_outbox`, `payment_webhook_events`, `order_access_tokens`), which take no locks other transactions wait on. Jobs claim their unit of work with `FOR UPDATE SKIP LOCKED` first and then follow the same order inside the unit. Isolation is READ COMMITTED (Prisma's default) plus explicit row locks and conditional updates; SERIALIZABLE is not needed and would only add retries.

**No transaction contains network I/O.** Provider calls, email sends and `fetch` happen between transactions (§5.6). Transactions are expected to finish in tens of milliseconds; Prisma's interactive-transaction `timeout` is set to 5 s and `maxWait` to 2 s so a stuck transaction fails loudly instead of holding locks.

| ID  | Transaction                             | Locks (in order)                                                           | Writes                                                                                                                                                                                                                       | Re-checks inside the lock                                                                                        | If the process dies after commit                                                              |
| --- | --------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| T1  | Place order (online)                    | cart → inventory (asc)                                                     | order `PENDING_PAYMENT` + items; conditional reserves; reservations with `orderId`; **payment attempt 1 `INITIATED` with `receipt`**; event `order.placed`; guest access token (§10.1)                                       | cart `ACTIVE`, no live order for the cart, `canCheckout`, live prices = `quoteHash`                              | attempt stays `INITIATED`; recovered by the pay page or `recover-payments` (§5.6)             |
| T2  | Place order (COD)                       | cart → inventory (asc)                                                     | order `CONFIRMED`; conditional stock commit; COD payment row; cart `CONVERTED`; outbox rows; events                                                                                                                          | as T1 plus COD eligibility                                                                                       | nothing pending                                                                               |
| T3  | Persist provider order                  | order → payment                                                            | attempt `INITIATED → CREATED` with `providerOrderId`; optional deadline extension (D6)                                                                                                                                       | attempt still `INITIATED`, order still `PENDING_PAYMENT`                                                         | nothing pending                                                                               |
| T4  | Provider creation gave up               | order → payment                                                            | attempt `INITIATED → FAILED` with `lastError`; event                                                                                                                                                                         | attempt still `INITIATED`                                                                                        | nothing pending                                                                               |
| T5  | Confirm capture (`confirmOrderPayment`) | order → payment → inventory (asc) → reservations                           | payment `CAPTURED`; holds `CONSUMED`; order `CONFIRMED`; cart `CONVERTED`; outbox rows; event. Branches: mismatch → `NEEDS_REVIEW` + event; late capture → re-secure stock or `NEEDS_REVIEW` + **`refunds` row `INITIATED`** | order status (no-op if already `CONFIRMED`), attempt belongs to the order, gateway facts passed in as parameters | emails and refunds are durable rows; nothing pending                                          |
| T6  | Record payment failure                  | order → payment                                                            | attempt `FAILED` with provider error fields; event                                                                                                                                                                           | guard: never overwrite `CAPTURED`                                                                                | nothing pending                                                                               |
| T7  | Cancel pending (customer)               | order → inventory (asc) → reservations                                     | holds `RELEASED`; order `CANCELLED (CUSTOMER)`; event; cart stays `ACTIVE`                                                                                                                                                   | order still `PENDING_PAYMENT`                                                                                    | nothing pending                                                                               |
| T8  | Expire one order (sweep unit)           | order (claimed with `SKIP LOCKED`) → inventory → reservations              | holds `EXPIRED`; order `CANCELLED (PAYMENT_TIMEOUT)`; event — **or** the T5 path if the pre-check found a capture                                                                                                            | status and deadline again (a capture may have landed meanwhile)                                                  | nothing pending                                                                               |
| T9  | Webhook ingest                          | none (insert)                                                              | `payment_webhook_events` row `RECEIVED` (unique id)                                                                                                                                                                          | —                                                                                                                | the row is the queue; `process-webhooks` picks it up                                          |
| T10 | Webhook apply                           | webhook event (`SKIP LOCKED`) → order → payment → inventory → reservations | the guarded transition (T5/T6 bodies); event `PROCESSED`/`IGNORED`/retry                                                                                                                                                     | event not already `PROCESSED`                                                                                    | nothing pending                                                                               |
| T11 | Refund intent                           | (inside T5/T10)                                                            | `refunds` row `INITIATED` with `reference`; outbox "refund requested"; event                                                                                                                                                 | —                                                                                                                | the row is the queue; `refund-payments` picks it up                                           |
| T12 | Refund persisted                        | refund → payment                                                           | refund `REQUESTED` with `providerRefundId` (or `FAILED` after max attempts + ops alert outbox); payment `REFUNDED` when `PROCESSED`                                                                                          | refund not already `REQUESTED`/`PROCESSED`                                                                       | nothing pending                                                                               |
| T13 | Claim queue rows                        | queue rows (`SKIP LOCKED`)                                                 | `claimedAt/claimedBy`, `attempts + 1`                                                                                                                                                                                        | lease not held by a live worker                                                                                  | lease expires; another worker reclaims                                                        |
| T14 | Complete queue row                      | the claimed row                                                            | `SENT`/`PROCESSED`/`REQUESTED` or `nextAttemptAt` with backoff or `FAILED`                                                                                                                                                   | still claimed by this worker                                                                                     | a duplicate side effect is possible only between the external call and T14 (mitigated, §11.1) |
| T15 | Issue or rotate guest token             | order                                                                      | new `order_access_tokens` row; previous token `revokedAt`                                                                                                                                                                    | order exists and is owned by the caller                                                                          | nothing pending                                                                               |

Prisma interactive transactions (`db.$transaction(async tx => …)`) as the cart merge already uses; conditional updates and locks run through `tx.$executeRaw` with `Prisma.sql` parameters, as the catalog listing does.

### 5.6 Recoverable multi-step operations

Rule: **a provider call happens only between transactions, only after a durable intent row exists, and always with an idempotency reference the provider stores too** (`receipt` for orders, `reference` for refunds). Each operation is therefore a short sequence of _commit → call → commit_ that can be resumed from any point.

**Placement and first attempt**

```
S1  T1   order + reservations + payment attempt #1 INITIATED (receipt = MY-XXXXXXXX-1)      ← commit
S2  —    gateway.createOrder({ amount, receipt, notes })                                      ← network, no locks
S3  T3   payment attempt CREATED + providerOrderId                                             ← commit
S4  —    redirect to /checkout/pay/[orderId]
```

| Failure                                     | Recovery                                                                                                                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dies after S1                               | The pay page (and `recover-payments`, §5.8) sees an `INITIATED` attempt: `gateway.findOrderByReceipt(receipt)` → found → S3; not found → S2 then S3                                                                                        |
| S2 times out but Razorpay created the order | A retry of S2 gets Razorpay's duplicate-receipt error; the recovery path above resolves it by receipt. An orphan provider order is harmless: it is never paid and stays `created`                                                          |
| S2 fails with a provider/credentials error  | `providerAttempts + 1`, `lastError`; the pay page shows "online payment is unavailable, try again" (COD remains); after `policy.jobs.maxAttempts` the attempt is `FAILED` (T4); the order still expires at its deadline and releases stock |
| Dies after S3 before S4                     | The customer lands on `/checkout/pay` through the cart ("you have an order awaiting payment") or `/account/orders`; nothing to repair                                                                                                      |

**Another attempt** (customer retries after a failure): `startPaymentAttemptAction` inserts a new attempt row (`attemptNo + 1`, `INITIATED`) in a transaction that first locks the order and checks there is no open attempt (the partial unique index backs this), then S2/S3 as above.

**Confirmation from the browser callback**: verify signature (pure) → `gateway.fetchPayment` (network) → T5 with the fetched facts as parameters. If the fetch fails, nothing changes and the customer sees "we are confirming your payment" (the confirming page); the webhook or the reconciliation job completes it. T5 never calls the gateway.

**Late capture, no stock (P8)**: the decision and the intent commit together in T5/T10 (`refunds` row `INITIATED`, order `NEEDS_REVIEW`, outbox "refund requested"). The `refund-payments` worker then runs: claim (T13) → `gateway.listRefunds(providerPaymentId)` to find a refund carrying our `reference` (an earlier request whose answer was lost) → else `gateway.refund(providerPaymentId, { amount, reference, notes: { refundId } })` → T12. A refund that keeps failing becomes `FAILED` after max attempts with an ops alert email; the order stays `NEEDS_REVIEW` and the money is never silently forgotten. `refund.processed` webhooks and `listRefunds` reconciliation move it to `PROCESSED`.

**Expiry of one order** (sweep unit): claim the order (T13 pattern) → if it has an open attempt, `gateway.fetchOrderPayments(providerOrderId)` (network) → T8: lock, re-check status and deadline, and either confirm (a capture was found) or expire and cancel. Two workers may fetch the same order's payments; only one holds the row in T8, and the other finds the order no longer pending.

### 5.7 Placement idempotency

The **cart is the idempotency key** for placement: every checkout submission is resolved to the request's single ACTIVE cart (`resolveCartContext`, Phase 5), T1 locks that cart row, and the unique index `orders_one_live_per_cart (cart_id) WHERE status <> 'CANCELLED'` is the database backstop. No client-generated key is needed, and none is trusted.

| Situation                                                       | Outcome                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Double-click "Place order"                                      | The second request waits on the cart lock, then finds the live order → redirect to its pay page (online) or confirmation (COD). One order, one reservation set.                                                                                        |
| Refresh after placing                                           | Server Actions redirect; the browser re-requests a GET page, never the action.                                                                                                                                                                         |
| Browser or proxy retries the POST                               | Same as a double-click.                                                                                                                                                                                                                                |
| Two tabs submit the same cart (even with different methods)     | Serialised by the lock; the loser sees the winner's order. A COD winner has converted the cart, so the online loser is told the order is already placed.                                                                                               |
| Submit while a cancelled order exists for the cart              | Allowed: the index ignores `CANCELLED`; the cart is still `ACTIVE`; a new order is created.                                                                                                                                                            |
| Submit after the order was confirmed                            | The cart is `CONVERTED`; the action redirects to the confirmation page.                                                                                                                                                                                |
| Submit with a stale page (prices changed)                       | `quoteHash` differs → no order; the page shows the new totals (P12).                                                                                                                                                                                   |
| "Try again" clicked twice on the pay page                       | `payments_one_open_per_order` makes the second insert fail; the action returns the open attempt's provider order id.                                                                                                                                   |
| Callback replayed, webhook duplicated, both arrive              | T5 is a no-op once `CONFIRMED`; the ledger stores one row per event id.                                                                                                                                                                                |
| The same browser places an order, signs in, and merges the cart | A cart with a live order is not merged into: the Phase 5 merge (which already requires `status = 'ACTIVE'`) additionally skips carts with a live order and leaves the guest cart for the pending order; the customer sees it under "awaiting payment". |

### 5.8 Recovery jobs and concurrent workers

Every deferred or retryable effect is a **row in a queue table** with the same worker contract, so recovery never depends on process memory, timers or a single running instance:

| Queue (table, state)                                        | Job                   | Schedule               | Work per unit                                                                                              | Terminal failure                                 |
| ----------------------------------------------------------- | --------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `payments` `INITIATED` older than 1 min                     | `recover-payments`    | every 5 min            | find-or-create the provider order by `receipt` (§5.6), T3/T4                                               | attempt `FAILED`; order expires normally         |
| `orders` `PENDING_PAYMENT` past `pendingExpiresAt`          | `expire-reservations` | every 5 min            | pre-check captures, then T8                                                                                | —                                                |
| `orders` `PENDING_PAYMENT` with a `CREATED` attempt > N min | `reconcile-payments`  | every 15 min           | `fetchOrderPayments`; captured → T5; failed → T6                                                           | —                                                |
| `payment_webhook_events` `RECEIVED` (incl. retries)         | `process-webhooks`    | every 5 min (+ inline) | T10                                                                                                        | `FAILED` after max attempts + ops alert          |
| `refunds` `INITIATED` / `REQUESTED` (unresolved)            | `refund-payments`     | every 15 min           | list-or-create by `reference`, then T12; poll `REQUESTED` until processed                                  | `FAILED` + ops alert; order stays `NEEDS_REVIEW` |
| `notification_outbox` `PENDING` (incl. retries)             | `send-notifications`  | every 5 min (+ inline) | render from `payload`, send with idempotency key, T14                                                      | `FAILED` + ops alert                             |
| carts, sessions, verifications, rate limits, expired tokens | `cleanup`             | daily                  | existing `cleanupCarts()`, `cleanupRateLimits()`, expired `sessions`/`verifications`/`order_access_tokens` | —                                                |

**Worker contract (identical for every job):**

1. **Claim** a small batch atomically: `UPDATE <queue> SET claimed_at = now(), claimed_by = $worker, attempts = attempts + 1 WHERE id IN (SELECT id FROM <queue> WHERE status = $pending AND next_attempt_at <= now() AND (claimed_at IS NULL OR claimed_at < now() − lease) ORDER BY next_attempt_at LIMIT $n FOR UPDATE SKIP LOCKED) RETURNING *`. Two workers never hold the same row; a crashed worker's rows are reclaimed when the lease (`policy.jobs.leaseMinutes`, 5) lapses.
2. **Do the external call** outside any transaction, with the row's idempotency reference.
3. **Complete** (T14): success → terminal state; retryable failure → `next_attempt_at = now() + backoff[attempts]` (`policy.jobs.backoffMinutes`, e.g. 1, 5, 15, 60, 180, 360) and `claimed_at = NULL`; `attempts ≥ maxAttempts` → `FAILED` plus an `ops.alert` outbox row (deduped per unit) to `ORDER_NOTIFY_EMAIL`.
4. Every handler is **idempotent**: it re-reads the current state under the lock and applies a guarded transition, so running a unit twice (overlapping cron, Vercel's at-least-once invocation, a manual re-run) changes nothing the second time.
5. Jobs are plain functions in `src/server/jobs/*.ts`; the cron routes call them with a bearer check; `npm run job -- <name>` runs one locally; integration tests call them directly, including two workers concurrently.

**Webhook handling under concurrency:** the route verifies the signature, then runs T9 (insert `RECEIVED`; on a duplicate id: if the existing row is `PROCESSED`/`IGNORED` → 200 immediately, otherwise fall through), then tries T10 inline with `SKIP LOCKED` — if another worker holds the row, respond 200 and let it finish. Response codes: 401 bad signature; 200 once the event is durably stored, **even if applying it failed** (the queue retries; this avoids retry storms); 500 only if the insert itself failed, so Razorpay retries delivery. Events are applied as guarded transitions independent of arrival order (`payment.failed` after `CAPTURED` → `IGNORED` with a note).

---

## 6. Razorpay integration

Verified against Razorpay's documentation on 31 Oct 2026 (Orders API, server integration guide, webhook validation, capture settings):

- **Order creation:** `POST /v1/orders` with Basic auth (`key_id:key_secret`), `amount` in paise, `currency: "INR"`, `receipt` (≤ 40 ASCII chars, unique — we use `${orderNumber}-${attemptNo}`), `notes: { orderId, orderNumber }`. Razorpay states that an `order_id` must not be reused after a failed payment, hence one `payments` row per attempt.
- **Capture:** configure **auto-capture** in the Dashboard (the capture settings page confirms this is the default and that uncaptured payments are auto-refunded after the configured window). The app treats `authorized` as "not yet paid" and only `captured` as paid.
- **Checkout:** `https://checkout.razorpay.com/v1/checkout.js` in a client component on the pay page, with `key` (public key id), `order_id`, `amount`, `currency`, `prefill` (name, email, phone), `notes`, `theme.color` and `modal.ondismiss`. No card data touches our server.
- **Callback verification:** `HMAC-SHA256(key_secret, "<our provider_order_id>|<razorpay_payment_id>")` compared to `razorpay_signature` with `timingSafeEqual`. The docs say to use the order id from our server, not from the callback — we look the attempt up by `providerOrderId` and require it to belong to the order in the request. A valid signature then triggers `payments.fetch(razorpay_payment_id)`; the order is confirmed only if `status === "captured"`, `amount === total`, `currency === "INR"` and `order_id` matches. `authorized` → "payment is being confirmed" page that polls (webhook/reconciliation will finish it).
- **Webhooks:** `POST /api/webhooks/razorpay`; raw body (`await request.text()`), `X-Razorpay-Signature` = HMAC-SHA256 of the raw body with the webhook secret, constant-time compare; `x-razorpay-event-id` stored with a unique constraint (Razorpay says duplicates and out-of-order delivery are expected). Subscribed events: `payment.captured`, `payment.failed`, `payment.authorized` (recorded), `order.paid` (treated like `payment.captured`); refund events are stored and ignored until Phase 7. Secret rotation: `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` optional, tried second.
- **Reconciliation:** `orders.fetch` / `orders.fetchPayments` from the sweep and a 15-minute reconciliation cron for `PENDING_PAYMENT` orders with attempts older than 2 minutes, so a missed webhook never strands a paid order.
- **Refunds (automatic path only, P8):** `POST /v1/payments/:id/refund` for the full amount with `receipt: <our reference>` and `notes: { refundId, orderId, reason }`, driven by the `refunds` queue (§5.6, §5.8) so a lost response is found again through `GET /v1/payments/:id/refunds`; recorded on the `refunds` row and in events; the customer is emailed. Staff-initiated refunds are Phase 7.
- **Recovery lookups:** `GET /v1/orders?receipt=<receipt>` finds a provider order created for an attempt whose response was lost; `GET /v1/orders/:id/payments` lists captures for reconciliation. Both are read-only and safe to repeat.
- **SDK:** `razorpay` 2.9.8 (npm `latest`, July 2026), server-only, wrapped behind a `PaymentGateway` interface so services and tests never import the SDK directly:

```ts
interface PaymentGateway {
  createOrder(input: {
    amountInPaise: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<{ providerOrderId: string }>;
  findOrderByReceipt(
    receipt: string,
  ): Promise<{ providerOrderId: string } | null>; // recovery (§5.6)
  fetchPayment(providerPaymentId: string): Promise<GatewayPayment>; // status, amount, currency, orderId, method
  fetchOrderPayments(providerOrderId: string): Promise<GatewayPayment[]>;
  refund(
    providerPaymentId: string,
    input: {
      amountInPaise: number;
      reference: string;
      notes: Record<string, string>;
    },
  ): Promise<{ providerRefundId: string }>;
  listRefunds(providerPaymentId: string): Promise<
    Array<{
      providerRefundId: string;
      reference: string | null;
      status: string;
    }>
  >;
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
| 20  | Process dies between order commit and the Razorpay call         | The `INITIATED` attempt carries the `receipt`; the pay page or `recover-payments` finds or creates the provider order (§5.6)                                                            |
| 21  | Razorpay created the order but our response was lost            | The retry gets a duplicate-receipt error; `findOrderByReceipt` resolves it; no second provider order per attempt                                                                        |
| 22  | Refund request fails or its response is lost                    | The `refunds` row is retried with backoff; `listRefunds` finds an already-created refund by our reference; after max attempts → `FAILED` + ops alert, order stays `NEEDS_REVIEW`        |
| 23  | Webhook stored but applying it crashed                          | Row stays `RECEIVED` with `lastError`; `process-webhooks` retries with backoff; the delivery itself was acknowledged with 200, so no retry storm                                        |
| 24  | Two workers drain the same queue                                | `FOR UPDATE SKIP LOCKED` claims disjoint rows; a lease covers crashes; each unit is idempotent                                                                                          |
| 25  | Worker crashes after the email was sent but before marking it   | Lease lapses; a second send carries the same idempotency key (§11.1)                                                                                                                    |
| 26  | Guest cookie stolen or shared                                   | Scope is one order for 7 days with minimal fields; tokens rotate on lookup and can be revoked; no payment or account data is reachable                                                  |

---

## 10. Security, authorization and auditability

- **Trust boundary:** the server computes every amount; the client sends only an address, a method and ids. Payment status comes from a verified signature **plus** Razorpay's API or webhook, never from the browser alone.
- **Ownership:** orders are read by `(id, userId)` for customers and through a valid access token for guests (§10.1); never by id alone. Account pages use `requireUser`; `proxy.ts` is unchanged (optimistic only).
- **CSRF:** Server Actions are origin-checked by Next; the webhook route accepts POST without cookies; cron routes require the bearer secret and reject GET without it.
- **Rate limits (new rules in `rate-limit-rules.ts`):** place order 5/10 min per identity and 20/10 min per IP; confirm payment 20/10 min per order; start attempt 5/15 min per order; order lookup 10/15 min per IP and 5/hour per email; webhook route 600/min per IP (defensive).
- **Secrets:** `RAZORPAY_KEY_ID` (public), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_WEBHOOK_SECRET_PREVIOUS?`, `CRON_SECRET`, `PAYMENT_GATEWAY`, `ORDER_NOTIFY_EMAIL?` added to `env-schema.ts`; required in production **at use time**; never logged.
- **PII:** address snapshots are personal data; logs carry order ids only; the Phase 8/10 DPDP work must anonymise `email/phone/address` on account deletion while keeping amounts (accounting) — noted, not done here.
- **Audit:** `order_events` is append-only by convention (no update/delete code paths; a DB-level rule needs a second role and is a Phase 10 hardening item); every status change, payment transition, stock change, cron action and email send writes an event with its actor.
- **Webhook hygiene:** body limited to 256 KB; signature verified before parsing; parsed with a Zod schema; unknown event types stored as `IGNORED`.
- **CSP (Phase 10):** add `script-src https://checkout.razorpay.com`, `frame-src https://api.razorpay.com https://checkout.razorpay.com`, `connect-src https://api.razorpay.com https://lumberjack.razorpay.com`; recorded in architecture.md D8.
- **PCI:** hosted checkout; no card data is received, stored or logged.

### 10.1 Guest order access

- **Token:** 32 bytes from `crypto.randomBytes` (256 bits), base64url, generated server-side only; never derived from the order number, email or time. Only `SHA-256(token)` is stored (`order_access_tokens.token_hash`, unique); a plausibility check (length and alphabet, as `isPlausibleCartToken`) runs before any lookup, and lookups are by hash equality, so no secret comparison happens in application code.
- **Issue and transport:** issued in T1/T2 for guest orders and set as `__Host-my_order` (`my_order` outside production): `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/`, `Max-Age` = `policy.guestAccess.tokenTtlDays` (7). The cookie holds one token for one order (the most recent); tokens never appear in URLs, emails or logs. Email links point at `/orders/track`, which asks for the order number and email.
- **Rotation and revocation:** a successful `trackOrderAction` issues a new token and revokes the previous one (T15); tokens expire at `expiresAt` and are not extended; expired and revoked rows are swept by `cleanup`. A guest who signs up with the order's email later sees it in their account (Phase 8 linking) — the token path is for the days after purchase, not a permanent key.
- **Minimal exposure:** the guest views (`/checkout/confirmation`, `/checkout/pay`, `/orders/track` result) show order number, status, items, totals, payment method and the delivery address as recipient name, city, state and PIN; the full address lines, phone and email are shown only on the confirmation page reached with the cookie issued at placement, and even there the email is masked (`a***@example.com`). Nothing about the account, other orders or payment identifiers beyond the last four characters of the Razorpay payment id is rendered.
- **Signed-in customers** never use tokens: their orders resolve by `userId`, and an order placed as a guest is not visible through an account until linked.
- **Rate limits:** `trackOrder` 10/15 min per IP and 5/hour per email (hashed keys, as Phase 4); the response for an unknown number/email pair is identical to a wrong one.

---

## 11. Emails and notifications

Templates (plain text + minimal HTML, same `layout` as auth): order confirmation (items, totals, address, payment method, order number, link), payment-failed/timeout notice (optional, P9), refund requested (P8 path), owner new-order notice (P10). All go through `notification_outbox` rows created **inside** the confirming transaction (`dedupeKey = kind:orderId`, `payload` = the template's inputs captured at that moment), drained by the `send-notifications` worker and, opportunistically, by `after()` right after the transaction (which calls the same worker for that one row, so it obeys the same claim and lease; the cron is the guarantee).

### 11.1 Outbox delivery under concurrent workers and retries

- **At-least-once by design:** a row is `SENT` only after the provider accepted the message; a crash between the send and T14 leaves the row claimed, the lease lapses, and another worker sends again. To make that duplicate harmless, the send passes `dedupeKey` as the provider's idempotency key (Resend's `Idempotency-Key` header, to be verified against its current API when implemented; the file and log transports accept it as a no-op). If the provider offers no idempotency, the only duplicate window is that crash gap, and the event log records both attempts.
- **Exactly one row per fact:** `dedupeKey` is unique, so re-running a transition never enqueues a second confirmation; a re-send on purpose (Phase 7 admin) creates a row with a new key (`order.confirmed:<orderId>:resend:<n>`).
- **Ordering is not assumed:** each email is self-contained (its `payload` is a snapshot), so a cancellation email cannot be invalidated by a confirmation that is sent later.
- **Failures are visible:** `FAILED` rows (after `policy.jobs.maxAttempts`) raise one `ops.alert` to the owner inbox and remain for Phase 7's admin screen; nothing is deleted.
- **Transport outages** do not affect orders: the outbox is written in the same transaction as the state, and the drain is independent of the request that created it.

---

## 12. Files

| Area      | Files                                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema    | `prisma/schema.prisma`, `prisma/migrations/<ts>_orders_payments_and_outbox/{migration.sql,rollback.sql}`                                                                                                                                                            |
| Env       | `src/server/env-schema.ts` (+ tests), `.env.example`, `README.md`                                                                                                                                                                                                   |
| Inventory | `src/features/inventory/{data,service}.ts` (reserve/commit/consume/release/expire), tests                                                                                                                                                                           |
| Policy    | `src/config/checkout-policy.ts` (+ unit tests and the no-literal-constants scan)                                                                                                                                                                                    |
| Checkout  | `src/features/checkout/{rules,schemas,types,data,service,actions}.ts` (quote, placement, cancellation), `src/features/orders/access.ts` (guest tokens), `src/components/checkout/*`, `src/app/(storefront)/checkout/**`                                             |
| Payments  | `src/server/payments/{gateway,razorpay,fake,signatures}.ts`, `src/features/payments/{data,service,actions,webhook}.ts`, `src/app/api/webhooks/razorpay/route.ts`                                                                                                    |
| Orders    | `src/features/orders/{data,service,types}.ts` (history, detail, tracking, state machine `transitions.ts`), `src/app/(storefront)/account/orders/**`, `src/app/(storefront)/orders/track/page.tsx`, `src/components/orders/*`                                        |
| Jobs      | `src/server/jobs/{queue,recover-payments,expire-reservations,reconcile-payments,process-webhooks,refund-payments,send-notifications,cleanup}.ts` (shared claim/complete contract in `queue.ts`), `src/app/api/cron/*/route.ts`, `scripts/run-job.ts`, `vercel.json` |
| Email     | `src/server/email/templates.ts` (+ order templates), `src/server/notifications/{outbox,service}.ts`                                                                                                                                                                 |
| Routes    | `src/lib/routes.ts` (`checkout`, `checkoutPay`, `checkoutConfirmation`, `accountOrders`, `accountOrder`, `trackOrder`); `/cart` gains "Proceed to checkout" gated on `canCheckout`; `account/page.tsx` loses its "orders will appear here" placeholder              |
| Docs      | `docs/checkout.md` (this file → implemented notes), `docs/business-rules.md` (D7 values as approved), `docs/roadmap.md`, `docs/data-model.md`, `docs/architecture.md` (D6 decided, D8 CSP list), `CLAUDE.md` (payment rules), `README.md`                           |

---

## 13. Test matrix

| Level                  | What is proven                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**               | pricing rules (shipping tiers, COD eligibility and fee, included-tax split and rounding, totals, minimum amount); `quoteHash` stability; order-number alphabet and uniqueness probability; state-machine transitions (every allowed and forbidden edge, incl. `FAILED` never after `CAPTURED`); HMAC verification with known vectors for checkout and webhook signatures, timing-safe compare, previous-secret fallback; webhook payload schemas; env schema (fake gateway refused in production, secrets optional at build); outbox backoff schedule; email templates contain no secrets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Integration**        | placement: snapshots match live prices (not `priceSeenInPaise`), totals and CHECKs, reservations with `orderId`, `Inventory.reserved` invariant; the last unit under concurrent placements (`Promise.all`); double submit → one order; COD commits stock and confirms; price drift → refused; `canCheckout` false → refused; guest vs user ownership (another user, another token, anonymous → not found); confirm via callback with the fake gateway (captured / authorized / mismatch / wrong order); confirm via webhook; duplicate event; out-of-order events; late capture with and without stock (refund requested); expiry sweep cancels, releases and reconciles a paid order; cancel pending releases stock and keeps the cart; outbox dedupe, retry, backoff, failure after 10; order lookup rate limit and generic response; **recovery:** a fake gateway that fails or "loses" responses at each step (after S1, during S2, after S3) with `recover-payments` repairing to exactly one provider order per attempt; refund retry, lost-response lookup by reference, `FAILED` after max attempts with an alert; webhook stored-but-failed retried by `process-webhooks`; **workers:** two concurrent drains of each queue deliver every row once, a lapsed lease is reclaimed, overlapping sweeps cancel once; **tokens:** issue, rotate, revoke, expire, plausibility check, minimal-field rendering; **policy:** snapshot immunity (changing the policy after placement changes nothing) and the no-literal-constants scan; migration 6 CHECKs and partial indexes; `rollback.sql` exercised |
| **E2E** (fake gateway) | signed-in checkout with a saved address → pay → simulated success → confirmation → order in `/account/orders`; guest checkout → confirmation → tracking by number + email; COD order; simulated failure → retry → success; abandon → cron endpoint called by the test → cancelled, cart intact; double-click "Place order"; price drift and stock loss between review and submit stay at integration level (the e2e server must not alter the seeded catalog); keyboard-only checkout; axe on checkout, pay, confirming, confirmation, orders, tracking; no-JavaScript placement (form post)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Manual**             | Razorpay **test mode** smoke on a preview deployment: UPI `success@razorpay` / `failure@razorpay`, card success and failure, webhook delivery to the preview URL, duplicate delivery via "resend" in the Dashboard. Documented as a checklist in `docs/checkout.md` §15 and reported with actual results; **not automated** and not claimed until run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

The fake gateway is a deterministic in-process implementation (signatures with a fixed test secret; `fetchPayment` returns what the test told it to); the e2e pay page shows a development-only "Simulate" panel **only** when `PAYMENT_GATEWAY=fake`, which production refuses.

**CI changes:** `PAYMENT_GATEWAY=fake`, `CRON_SECRET`, fake Razorpay values in the workflow env; no outbound network; the cron routes are hit by e2e with the secret. `npm audit` continues to run; `razorpay` is a runtime dependency and must pass `--audit-level=high`.

---

## 14. Implementation sequence (each step: code + tests + gates green before the next)

1. **Rules and schema:** migration 6 + rollback; `checkout-policy.ts` with the approved D6/D7 values; state machines; env schema; `PaymentGateway` interface + fake; the shared queue contract (`queue.ts`). Unit + constraint tests.
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
