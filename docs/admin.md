# Madhuyamini — Admin Dashboard and Store Operations (Phase 7)

Status: **Proposed, awaiting approval** · 1 Nov 2026 · Nothing in this document has been implemented or tested.

Scope: a role-gated admin area for running the shop day to day — overview, catalogue (products, categories, variants, images), inventory, orders and fulfilment, payment and refund investigation, background-job and webhook monitoring with safe retries, customers, reports, audit logging and admin two-factor sign-in. Everything money- or stock-related calls the Phase 5–6 services; the admin adds authorisation, confirmation, evidence and an audit trail around them. Out of scope: coupons, reviews moderation, returns, custom-artwork requests (Phase 8); content pages (Phase 9); CSP and monitoring (Phase 10).

Related: [checkout.md](checkout.md) (orders, payments, jobs), [cart.md](cart.md), [auth.md](auth.md), [data-model.md](data-model.md), [architecture.md](architecture.md) §7.

---

## 0. What exists today versus what this phase adds

| Area                | Existing (Phases 1–6)                                                                                                                                                                                                                                                         | Proposed in Phase 7                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles               | `User.role` (`CUSTOMER` / `STAFF` / `ADMIN`), server-owned, never from input; `requireRole(minimum)` with rank CUSTOMER < STAFF < ADMIN; `proxy.ts` redirects `/account/*` optimistically; Better Auth sessions, revocation, password policy, rate limits                     | `/admin/*` area; a permission matrix on top of the two staff roles; role changes with session revocation; TOTP two-factor for staff (Better Auth `twoFactor` plugin); a script to promote the first admin |
| Catalogue           | Read-only storefront services (`features/catalog`), parameterised SQL listing, seed-only writes; `Product.status` DRAFT/ACTIVE/ARCHIVED; `techniques[]`, `constructionMethods[]`, options/values/variants, images with required `alt`, Cloudinary delivery loader (URLs only) | Write services with Zod schemas; archive instead of delete; image upload through Cloudinary signed uploads; slug and SKU rules                                                                            |
| Inventory           | `Inventory` (`stockOnHand`, `reserved`, `lowStockThreshold`) with CHECKs; `features/inventory/service.ts` conditional updates (reserve, commit, consume, release, lock-then-check commit); holds tied to orders                                                               | Adjustments (receive, correct, write-off) that respect `reserved`, recorded in `inventory_adjustments`; low-stock view; restock on admin cancellation                                                     |
| Orders              | `OrderStatus` PENDING_PAYMENT / CONFIRMED / CANCELLED / NEEDS_REVIEW; transitions table with `admin_confirmed` and `admin_cancelled` edges; `order_events` timeline; customer views; `cancelPendingOrder`                                                                     | Fulfilment states PROCESSING → SHIPPED → DELIVERED; `shipments` (carrier, tracking); admin cancellation with restock and refund intent; COD "cash collected"; staff notes as events                       |
| Payments            | Attempts with provider ids; `applyCapture` (idempotent, mismatch → NEEDS_REVIEW, late/duplicate → refund intent), `applyFailure`, `confirmFromCallback`, `reconcileAttempt`, `ensureProviderOrder`; refund queue (`refunds`) executed by `refund-payments`; webhook ledger    | Investigation views; resolution actions that only ever call those functions with provider evidence; staff-initiated refunds through the same queue                                                        |
| Jobs                | `server/jobs/*` with claim/lease/backoff; cron routes; `vercel.json`; `npm run job`; FAILED rows raise `ops.alert` emails                                                                                                                                                     | Monitoring pages for the outbox, webhook ledger and refunds; retry by resetting rows for the workers; "run now" for ADMIN                                                                                 |
| Notifications       | Outbox kinds for confirmation, cancellation, refund, owner notices, ops alerts                                                                                                                                                                                                | New kinds: shipped, delivered, cancelled by the shop, refund processed                                                                                                                                    |
| Audit               | `order_events` (append-only, actor enum includes ADMIN)                                                                                                                                                                                                                       | `admin_audit_log` (append-only) written in the same transaction as every admin mutation                                                                                                                   |
| UI                  | Storefront shell, design tokens, forms (`Field`, `FormStatus`, `SubmitButton`), `AccountShell` pattern, `EmptyState`, axe + keyboard e2e                                                                                                                                      | Admin shell (sidebar, no storefront header), data tables, confirmation pages, status badges; same tokens, CSS Modules, no Tailwind                                                                        |
| Policy and settings | `src/config/checkout-policy.ts` (code constants, accessor)                                                                                                                                                                                                                    | Unchanged this phase (decision A6)                                                                                                                                                                        |

---

## 1. Gaps and risks found during inspection

1. **No staff user exists.** Nothing creates an ADMIN; registration always yields CUSTOMER. A promotion script and a dev-seed admin are needed before any admin page is reachable.
2. **No fulfilment states.** `OrderStatus` stops at `CONFIRMED`; orders cannot be marked processing, shipped or delivered, and COD attempts cannot be marked collected. The enum must grow (an online `ALTER TYPE … ADD VALUE`).
3. **Admin cancellation of a confirmed order has no path.** Stock was consumed at confirmation; cancelling must put it back and, for online orders, queue a refund. `releaseOrderHolds` does not cover this; a `restockForOrder` is needed.
4. **NEEDS_REVIEW orders have no exit** other than the transition table's `admin_confirmed`/`admin_cancelled` edges, which nothing calls. Resolution must be built so that confirmation is impossible without a captured attempt (provider evidence).
5. **No write path for the catalogue** and no Cloudinary credentials (`image-loader.ts` only rewrites delivery URLs). Uploads need `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` and signed upload parameters generated server-side.
6. **Queue rows marked FAILED stay failed forever**; the only recovery today is SQL. Retrying must reset the row for the worker rather than re-implementing the worker.
7. **Webhook payloads contain PII** (email, phone, UPI id). The ledger viewer must mask them for STAFF.
8. **Inventory CHECK `reserved <= stock_on_hand`**: an adjustment that lowers stock below current holds must be refused with a clear message, not a constraint error.
9. **Role changes must revoke sessions** (auth.md P4 promised rotation on privilege change); Better Auth has no hook for our role column, so the admin service deletes the user's sessions itself.
10. **Better Auth's `admin` plugin** (ban, impersonate, set role) is deliberately **not** used: it would move role authority out of our data layer and add impersonation, which the brief does not want.
11. **Two-factor sign-in**: Better Auth ships a `twoFactor` plugin (TOTP + backup codes) needing its own table; enforcing it for staff means a short enrolment flow and a check at the admin gate.
12. **Reports must never claim what cannot be computed**: revenue counts only `CONFIRMED`-and-beyond orders with captured or COD payments; "best-selling" stays internal until Phase 9 decides to show it.
13. **Vercel Hobby crons are daily** (checkout.md): the monitoring pages make slow sweeps visible, but production needs a scheduler (§13).

---

## 2. Decisions needed before implementation

| #      | Question                                        | Recommendation                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | What may STAFF do versus ADMIN?                 | STAFF: run the shop (catalogue edits, stock adjustments, fulfilment, COD collection, customer lookup, retry emails). ADMIN additionally: publish/archive products, refunds and NEEDS_REVIEW resolution, cancellations after confirmation, job "run now", role changes, settings, exports. Matrix in §9. |
| **A2** | Two-factor sign-in for staff                    | **Yes, in this phase**: TOTP via Better Auth's `twoFactor` plugin, enrolment forced on first admin visit, backup codes shown once. The admin area handles money and personal data.                                                                                                                      |
| **A3** | Product deletion                                | Archive by default. Hard delete only for `DRAFT` products with no order items, ADMIN only, typed-confirmation. Categories: delete only when empty.                                                                                                                                                      |
| **A4** | Image uploads                                   | Cloudinary signed uploads from the browser (server issues the signature; nothing is proxied), stored by `publicId`; `alt` text required on save. Needs the three Cloudinary variables.                                                                                                                  |
| **A5** | Fulfilment data                                 | A `shipments` table now (carrier name, tracking number, optional URL, shipped at, delivered at) — one shipment per order in Phase 7; partial shipments are Phase 8.                                                                                                                                     |
| **A6** | Editable store settings (shipping, COD, policy) | **Defer.** Keep `checkout-policy.ts` as the single source this phase; a settings table means changing every caller to an async, cached read and a migration. Revisit after the first weeks of real orders.                                                                                              |
| **A7** | Cancelling a shipped order                      | Not in Phase 7 (needs returns, Phase 8). Cancellation is possible up to `PROCESSING`; `SHIPPED` and `DELIVERED` are final here.                                                                                                                                                                         |
| **A8** | Customer data in the admin                      | STAFF see name, email, phone, orders and addresses (needed for support); exports and deletion are Phase 8/10 (DPDP). No impersonation.                                                                                                                                                                  |
| **A9** | First admin                                     | `npm run admin:promote -- <email>` (server-side, DB access) promotes an existing account; the dev seed creates `admin@example.com` only when `SEED_ADMIN_PASSWORD` is set (CI sets a throwaway value for e2e).                                                                                          |

---

## 3. Database changes (migration 7, `admin_operations`)

Only what the features above need; everything else reuses Phase 6 tables.

```prisma
// Fulfilment states appended to the existing enum (online ALTER TYPE … ADD VALUE).
enum OrderStatus { PENDING_PAYMENT  CONFIRMED  PROCESSING  SHIPPED  DELIVERED  CANCELLED  NEEDS_REVIEW }

enum AuditOutcome { SUCCESS  REFUSED }

/// Append-only. Every admin mutation writes one row in its own transaction.
model AdminAuditLog {
  id         String       @id @default(uuid(7)) @db.Uuid
  actorId    String       @map("actor_id") @db.Uuid          // staff user; kept even if the account goes (SetNull → NOT NULL avoided by never deleting staff)
  actorRole  UserRole     @map("actor_role")
  action     String                                            // e.g. order.cancel, product.publish, refund.create, job.retry, user.role.set
  targetType String       @map("target_type")                  // order, product, variant, inventory, user, refund, outbox, webhook_event, job
  targetId   String?      @map("target_id")
  outcome    AuditOutcome
  reason     String?                                           // operator-supplied reason where required
  before     Json?
  after      Json?
  requestIp  String?      @map("request_ip")                   // hashed, as rate limits do
  createdAt  DateTime     @default(now()) @map("created_at")
  actor User @relation(fields: [actorId], references: [id], onDelete: Restrict)
  @@index([targetType, targetId, createdAt])
  @@index([actorId, createdAt])
  @@index([createdAt])
  @@map("admin_audit_log")
}

enum InventoryAdjustmentKind { RECEIVED  CORRECTION  WRITE_OFF  RESTOCK_ON_CANCEL }

/// Admin-originated stock changes (sales are derivable from order_items).
model InventoryAdjustment {
  id        String                  @id @default(uuid(7)) @db.Uuid
  variantId String                  @map("variant_id") @db.Uuid
  kind      InventoryAdjustmentKind
  delta     Int                                                  // signed; CHECK delta <> 0
  stockAfter Int                    @map("stock_after")          // CHECK >= 0
  reason    String
  actorId   String?                 @map("actor_id") @db.Uuid    // null for system restocks
  orderId   String?                 @map("order_id") @db.Uuid    // set for RESTOCK_ON_CANCEL
  createdAt DateTime                @default(now()) @map("created_at")
  variant   ProductVariant @relation(fields: [variantId], references: [id], onDelete: Restrict)
  @@index([variantId, createdAt])
  @@map("inventory_adjustments")
}

model Shipment {
  id             String    @id @default(uuid(7)) @db.Uuid
  orderId        String    @unique @map("order_id") @db.Uuid      // one per order in Phase 7
  carrier        String
  trackingNumber String?   @map("tracking_number")
  trackingUrl    String?   @map("tracking_url")
  shippedAt      DateTime  @map("shipped_at")
  deliveredAt    DateTime? @map("delivered_at")
  createdById    String    @map("created_by_id") @db.Uuid
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")
  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@map("shipments")
}

// Better Auth twoFactor plugin (A2): generated by the plugin's schema.
model TwoFactor {
  id          String @id @default(uuid(7)) @db.Uuid
  userId      String @unique @map("user_id") @db.Uuid
  secret      String                                   // encrypted by the plugin
  backupCodes String @map("backup_codes")              // hashed by the plugin
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("two_factors")
}
// User gains `twoFactorEnabled Boolean @default(false)` (plugin field, `input: false`).
// Order gains `staffNoteCount`? No: notes are order_events with actor STAFF/ADMIN (no schema change).
```

**Constraints in SQL:** `inventory_adjustments_delta_nonzero`, `inventory_adjustments_stock_after_non_negative`, `shipments_delivered_after_shipped` (`delivered_at IS NULL OR delivered_at >= shipped_at`), `orders_shipped_has_shipment` is enforced in the service (an FK the other way would need deferred constraints). `order_events.actor` already has `ADMIN`; `STAFF` is added to `OrderActor` (`ALTER TYPE … ADD VALUE`). `rollback.sql`: drop the new tables, remove `two_factor_enabled`, and note that enum values cannot be dropped in PostgreSQL without recreating the type — the rollback leaves `PROCESSING/SHIPPED/DELIVERED` and `STAFF` in place (harmless) and documents it.

---

## 4. Admin area structure

```
src/app/admin/
  layout.tsx                       # requireRole("STAFF") + 2FA check; AdminShell (sidebar, header, skip link)
  page.tsx                         # 1. Overview
  catalogue/products/              # 2. list, [id]/edit, new, [id]/variants, [id]/images
  catalogue/categories/            # 2. tree editor
  inventory/                       # 3. levels, low stock, [variantId]/adjust
  orders/                          # 4. list with filters, [id] detail, [id]/cancel (confirm page), [id]/ship
  payments/review/                 # 5. NEEDS_REVIEW queue, [orderId] investigation
  payments/refunds/                # 5. refund queue and history
  operations/                      # 6. jobs, outbox, webhooks, alerts
  customers/                       # 7. list, [id]
  reports/                         # 8. sales, products, inventory, exports
  audit/                           # 9. audit log browser (ADMIN)
  security/two-factor/             # 2FA enrolment (own page, reachable before the gate)
src/features/admin/
  authz.ts                         # permission matrix (pure, unit-tested) + requirePermission()
  audit.ts                         # writeAudit(tx, …)
  catalogue/{schemas,data,service,actions}.ts
  inventory/{schemas,service,actions}.ts
  orders/{schemas,service,actions}.ts        # fulfilment, cancellation, notes
  payments/{schemas,service,actions}.ts      # review resolution, refunds, COD
  operations/{service,actions}.ts            # retries, run-now
  customers/{data,service,actions}.ts
  reports/{data,service}.ts                  # parameterised SQL aggregates
src/components/admin/                        # AdminShell, DataTable, StatusBadge, ConfirmForm, StatCard, Filters …
src/server/uploads/cloudinary.ts             # signature generation
scripts/promote-admin.ts
```

`proxy.ts` gains `/admin/:path*` to its matcher (optimistic redirect to `/login?next=`); authority stays in `requireRole` inside the layout **and** inside every Server Action and data function (the layout check alone is not enough because actions are routable).

---

## 5. Feature design

### 5.1 Overview (business dashboard)

Server-rendered stat cards and lists, all from existing tables: orders and revenue today / 7 days / 30 days (confirmed-and-beyond, captured or COD), orders awaiting payment, awaiting fulfilment (`CONFIRMED` + `PROCESSING`), `NEEDS_REVIEW` count, FAILED queue rows (outbox, webhooks, refunds), low-stock variants, last job runs (derived from queue rows' `claimed_at` — no new table). Links go to the filtered lists. Nothing is estimated; empty states say "no orders yet".

### 5.2 Catalogue

- **Products:** list (status, category, variants, stock, updated); create/edit form (title, slug — generated from the title, editable, uniqueness checked server-side; subtitle; description; techniques ≥ 1; construction methods; material; care; category; one-of-a-kind; featured; SEO fields; HSN/tax rate kept nullable per D7c). **Publish** (`DRAFT → ACTIVE`, ADMIN; requires ≥ 1 active variant with price and ≥ 1 image with alt) and **archive** (`ACTIVE → ARCHIVED`; carts flag the lines, Phase 5). Hard delete per A3.
- **Options and variants:** define option axes and values; create variants per combination; SKU (unique, immutable once an order item references it), price in rupees converted to paise on the server, compare-at, weight, active flag. A variant with order items or cart lines cannot be deleted (Restrict already) — deactivate instead.
- **Images:** signed Cloudinary upload (`src/server/uploads/cloudinary.ts` signs `{timestamp, folder, public_id prefix}` with the API secret; the browser uploads directly; the server stores `url`, `publicId`, `width`, `height` from the upload response and the typed `alt`), ordering, assignment to a variant, removal (deletes at Cloudinary via the Admin API, best-effort, audited).
- **Categories:** tree with position, activate/deactivate, move under another parent (cycle check), delete only when no products and no children (Restrict already).

### 5.3 Inventory

- Levels table (variant, product, SKU, on hand, reserved, available, threshold) with low-stock filter.
- **Adjust** (STAFF): kind RECEIVED / CORRECTION / WRITE_OFF, signed delta, reason required. Transaction: lock the inventory row (`lockInventoryRows`), check `stock_on_hand + delta >= reserved` and `>= 0`, update, insert `inventory_adjustments`, write audit. Refusals say how many units are held by pending orders.
- Threshold edit per variant.
- No direct edit of `reserved`: it only moves through the Phase 6 service.

### 5.4 Orders and fulfilment

State additions and edges (pure `transitions.ts`, extended):

```
CONFIRMED ──start_processing──► PROCESSING ──ship──► SHIPPED ──deliver──► DELIVERED
CONFIRMED / PROCESSING ──admin_cancelled──► CANCELLED      (restock + refund intent if paid online)
NEEDS_REVIEW ──admin_confirmed (captured attempt required)──► CONFIRMED
NEEDS_REVIEW ──admin_cancelled──► CANCELLED               (refund intent if captured)
```

- **List:** filters by status, payment method, date range, search by order number / email / name; sorted newest first; paginated by URL params (server-rendered, like the catalogue listing).
- **Detail:** everything the customer sees (full exposure) plus attempts with provider ids, refunds, reservations, the full event timeline, audit entries for this order, and actions allowed in the current state.
- **Start processing** (STAFF): `CONFIRMED → PROCESSING`, event.
- **Ship** (STAFF): form with carrier, tracking number, URL; transaction: lock order, transition, insert shipment, event, outbox `order.shipped`.
- **Deliver** (STAFF): sets `deliveredAt`, transition, event, outbox `order.delivered`; for COD also offers **Cash collected** (see 5.5).
- **Cancel** (ADMIN; STAFF may cancel `PENDING_PAYMENT` only): confirmation page requiring a reason and the typed order number. Transaction: lock order; if `PENDING_PAYMENT` → `releaseOrderHolds`; if `CONFIRMED/PROCESSING` → `restockForOrder` (new inventory function: conditional `stock_on_hand += q` per item, `inventory_adjustments` RESTOCK_ON_CANCEL); if a captured online attempt exists → refund intent row (reason `cancelled_by_shop`) through the Phase 6 queue; status `CANCELLED` with `cancellationReason = ADMIN`; event; outbox `order.cancelled` (reason "shop"); audit. Cart stays as it is.
- **Staff note** (STAFF): an `order_events` row with `type = "note"`, actor STAFF/ADMIN; shown only in the admin.

### 5.5 Payments, refunds and NEEDS_REVIEW

Principle: **the admin never asserts a payment; it asks the provider.** Every resolution path ends in an existing Phase 6 function with provider facts as parameters, and is audited with the evidence.

| Action                    | Who   | What happens                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-check with provider    | STAFF | `reconcileAttempt(attemptId)` for each open or failed attempt; outcome shown and audited. The usual fix for "paid but stuck".                                                                                                                                                                                                                           |
| Attach a provider payment | ADMIN | Operator pastes a Razorpay payment id (from the Dashboard). Server: `gateway.fetchPayment(id)`; it must belong to one of this order's provider orders, be `captured`, and the amount/currency are passed to `applyCapture` (which itself decides confirm vs. mismatch). The fetched payment is stored in the audit `after`.                             |
| Accept a mismatch         | ADMIN | Only when a `CAPTURED` attempt exists on the order (the evidence is already in `payments`). Reason required; typed order number. Calls the `admin_confirmed` transition: consume holds, `CONFIRMED`, cart `CONVERTED`, confirmation email. Underpayments are refused by default unless the policy flag `review.allowUnderpaymentAccept` is set (false). |
| Cancel and refund         | ADMIN | `admin_cancelled`: release/restock as in 5.4, refund intent for every captured attempt (reason `review_cancelled`), outbox refund email, audit.                                                                                                                                                                                                         |
| Refund (full or partial)  | ADMIN | For `CONFIRMED+` orders with a captured attempt: amount ≤ captured − already refunded; creates a `refunds` row (`INITIATED`, reference `${orderNumber}-R${n}`) and lets `refund-payments` execute it. Partial refunds leave the order status unchanged; a full refund of an unshipped order is the cancel path.                                         |
| Mark COD cash collected   | STAFF | On `DELIVERED` COD orders: `markAttemptCaptured` on the COD attempt (no provider id; CHECK already allows COD), event `payment.cod_collected`, audit. Revenue reports count COD only once collected.                                                                                                                                                    |
| Retry a failed refund     | ADMIN | Resets the `refunds` row to `INITIATED` with `attempts = 0`, `nextAttemptAt = now`, `lastError` kept in audit; the worker does the rest. If the money was refunded by hand in the Dashboard, **Mark refunded externally** records the provider refund id the operator pastes after the server fetches and verifies it via `listRefunds`.                |

Nothing here writes `status = CAPTURED` from a form field; nothing marks an order `CONFIRMED` without a `CAPTURED` attempt (online) or the COD method.

### 5.6 Operations: jobs, webhooks, notifications

- **Jobs page:** per job: last claim time and counts from the queue tables; "Run now" (ADMIN) calls `runJob(name)` in the request (same lease rules as the cron, so overlapping runs are safe) and shows the summary; audited.
- **Outbox:** list by status with filters; FAILED rows show `lastError`; **Retry** (STAFF) resets `status = PENDING, attempts = 0, nextAttemptAt = now, claimedAt = null` (dedupe key unchanged, so a duplicate send is still impossible by key); **Discard** (ADMIN, reason) sets `FAILED` with a note. Payloads shown; recipients masked for STAFF.
- **Webhook ledger:** list, filter by type/status, payload viewer with PII masked for STAFF (email, contact, vpa, card fields); **Re-apply** (ADMIN) resets to `RECEIVED` for `process-webhooks` (the handler is idempotent).
- **Refund queue:** INITIATED / REQUESTED / FAILED with provider ids; retry per 5.5.
- **Alerts:** the `ops.alert` outbox rows as an inbox with "acknowledge" (audit only).

### 5.7 Customers

List (search by email/name/phone, filter by role and verification), detail (profile, verification, addresses read-only, orders, sessions count), actions: **Set role** (ADMIN; cannot change own role; demotion of the last ADMIN refused; all sessions of the user deleted in the same transaction; audit with before/after), **Resend verification email** (STAFF; reuses the Phase 4 action's rate-limited path). No deletion, export or impersonation (A8).

### 5.8 Reports

Parameterised SQL in `features/admin/reports/data.ts`, each with a unit-tested shape and an integration test against fixtures:

- **Sales:** orders, units, gross revenue (paise) per day/week/month; by payment method; cancelled and refunded amounts; average order value. Definition: revenue = `total_in_paise` of orders in `CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELIVERED` whose payment is `CAPTURED` (online) or collected (COD), minus processed refunds.
- **Products:** units and revenue per product/variant for a period (from `order_items`), with no claim of "best-selling" on the storefront until Phase 9.
- **Inventory:** on hand, reserved, available, value at current price, low stock, adjustments in period.
- **Operations:** payment success rate by attempt, time from placement to capture, late captures, refund totals, failed-job counts.
- **CSV export** (ADMIN): route handler `GET /admin/reports/export?report=…&from=…&to=…` streaming text; audited.

---

## 6. Transaction boundaries and lock order

Same global order as checkout.md §5.5 (`carts → orders → payments/refunds → inventory (asc) → reservations`), plus **`users`** before `sessions` for role changes and **`products → product_variants → inventory`** for catalogue writes. Audit rows are inserts at the end of each transaction. No transaction calls the provider or Cloudinary; those calls happen before (fetch evidence) or after (best-effort image delete).

| ID  | Transaction                       | Locks                                            | Writes                                                          | Outside                                       |
| --- | --------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------- |
| A1  | Product/variant/category save     | product (and variants)                           | row updates, slug/SKU uniqueness by index, audit                | —                                             |
| A2  | Image attach / remove             | product                                          | `product_images` row, positions, audit                          | Cloudinary signature (before), delete (after) |
| A3  | Inventory adjustment              | inventory row (`FOR UPDATE`)                     | conditional update, `inventory_adjustments`, audit              | —                                             |
| A4  | Start processing / ship / deliver | order                                            | status, `shipments`, event, outbox, audit                       | —                                             |
| A5  | Admin cancel                      | order → refunds → inventory (asc) → reservations | release or restock, refund intent, status, event, outbox, audit | —                                             |
| A6  | Review: attach payment            | (none during fetch) then as T5                   | `applyCapture` (T5) + audit                                     | `gateway.fetchPayment`                        |
| A7  | Review: accept mismatch           | order → payments → inventory → reservations      | consume holds, `CONFIRMED`, cart, outbox, event, audit          | —                                             |
| A8  | Refund create / retry / external  | order → refund                                   | `refunds` row insert or reset, audit                            | `listRefunds` verification for "external"     |
| A9  | COD collected                     | order → payment                                  | `markAttemptCaptured`, event, audit                             | —                                             |
| A10 | Queue retry / discard             | the queue row                                    | status/attempt reset, audit                                     | —                                             |
| A11 | Role change                       | user → sessions                                  | `role`, delete sessions, audit                                  | —                                             |
| A12 | Run job now                       | —                                                | audit before and after                                          | `runJob(name)`                                |

Every transaction re-reads status under the lock and applies a transition from the pure table; refusals are recorded in the audit log with `outcome = REFUSED` so attempts at forbidden actions are visible.

---

## 7. Security risks and controls

| Risk                                              | Control                                                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Privilege escalation                              | `role` never from input; `setRole` is ADMIN-only, cannot target self, cannot remove the last ADMIN; sessions revoked; audited. `proxy.ts` is optimistic only.                              |
| Routable Server Actions bypassing the layout gate | Every action begins with `requirePermission(user, action)`; data functions take the verified user; integration tests call actions without a session and with a CUSTOMER session.           |
| Manual "mark paid"                                | Does not exist. Confirmation needs a `CAPTURED` attempt (fetched from the provider or already recorded) or the COD method; the review page explains this.                                  |
| Refund abuse                                      | ADMIN only; amount bounded by captured − refunded; through the queue with provider references; audited with reason; alert email to the owner inbox for every refund created.               |
| Destructive actions by mistake                    | Confirmation pages (not JS dialogs) with a reason and the typed order number / product slug; archive instead of delete; deletes only when nothing references the row.                      |
| Stock corruption                                  | Adjustments go through row locks and the same conditional updates; `reserved` is never edited; CHECKs remain the last line.                                                                |
| PII exposure                                      | Webhook payloads and outbox recipients masked for STAFF; audit log stores hashed request IPs; exports are ADMIN only and audited.                                                          |
| Session hijack of a staff account                 | 2FA (A2); staff sessions listed on the security page; password change revokes others (Phase 4). Admin paths send `Cache-Control: private, no-store`.                                       |
| CSRF                                              | Server Actions (origin-checked); the CSV export route is GET with no side effects.                                                                                                         |
| Rate limiting                                     | Role changes and refunds limited per actor (policy); sign-in limits already apply.                                                                                                         |
| Upload abuse                                      | Signatures expire in minutes, restrict the folder and resource type, and are issued only to staff; the server validates the upload response fields before storing.                         |
| Enum migration                                    | `ALTER TYPE … ADD VALUE` cannot run inside a transaction with other statements that use the value; the migration adds values in their own statements first (Prisma emits them separately). |

---

## 8. Admin UI

- **Shell:** sidebar navigation (Overview, Orders, Catalogue, Inventory, Payments, Operations, Customers, Reports, Audit), header with the staff member's name and role, skip link, `noindex`; collapses to a drawer below 64em (reusing the `MobileNav` dialog pattern). Visual language: the same tokens (ivory, cream, sindoor, leaf), Cormorant headings, Mukta body; denser spacing than the storefront; no motifs in data views.
- **Patterns:** `DataTable` (semantic `<table>`, sortable headers as links, pagination links, row actions as forms), `StatusBadge`, `StatCard`, `Filters` (GET form), `ConfirmForm` (reason + typed confirmation), `Notice`. Forms reuse `Field`, `FormStatus`, `SubmitButton`; money input in rupees with two decimals, converted on the server.
- **Accessibility:** every page under axe in e2e; keyboard paths for table actions and confirmation; live regions for action results; no colour-only status (badges carry text).
- **Without JavaScript:** every action is a form post; the image uploader degrades to "paste an existing Cloudinary URL" with alt text.

---

## 9. RBAC matrix (A1)

| Capability                                         | STAFF | ADMIN |
| -------------------------------------------------- | :---: | :---: |
| View everything in the admin                       |   ✓   |   ✓   |
| Edit products, variants, images, categories        |   ✓   |   ✓   |
| Publish / archive / delete products                |       |   ✓   |
| Adjust stock, set thresholds                       |   ✓   |   ✓   |
| Process, ship, deliver orders; staff notes         |   ✓   |   ✓   |
| Cancel pending (unpaid) orders                     |   ✓   |   ✓   |
| Cancel confirmed/processing orders                 |       |   ✓   |
| Re-check with provider                             |   ✓   |   ✓   |
| Attach payment, accept mismatch, refunds           |       |   ✓   |
| Mark COD collected                                 |   ✓   |   ✓   |
| Retry outbox rows                                  |   ✓   |   ✓   |
| Re-apply webhooks, retry refunds, discard, run now |       |   ✓   |
| View customers, resend verification                |   ✓   |   ✓   |
| Set roles                                          |       |   ✓   |
| Reports                                            |   ✓   |   ✓   |
| CSV export, audit log browser                      |       |   ✓   |

Encoded once in `features/admin/authz.ts` as a pure map and unit-tested; `requirePermission` throws `ForbiddenError` and writes a REFUSED audit row.

---

## 10. Emails

New outbox kinds rendered by the existing templates module: `order.processing` (optional, off by default), `order.shipped` (carrier, tracking link), `order.delivered`, `order.cancelled` (reason "shop", refund note when applicable), `refund.processed` (amount, reference). Owner notices: `ops.refund_created`, `ops.role_changed`.

---

## 11. Tests

| Level                       | What is proven                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**                    | permission matrix (every capability × role); fulfilment transitions (allowed and forbidden edges); slug generation and uniqueness normalisation; rupee→paise parsing; adjustment arithmetic against reserved; report SQL builders (parameters, no string interpolation); Cloudinary signature construction with a known vector; masking helpers                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Integration**             | every admin service refuses CUSTOMER and anonymous callers and STAFF for ADMIN-only actions, and writes REFUSED audits; product publish rules; variant delete refused with order items; adjustment refused below holds; cancel of CONFIRMED restocks and queues a refund that `refund-payments` executes; cancel of PENDING releases; review: attach payment via fake gateway (captured / not captured / wrong order / mismatch), accept mismatch requires a captured attempt, cancel-and-refund; partial refund bounds; COD collected only on DELIVERED; outbox retry resets and the worker sends; webhook re-apply idempotent; role change revokes sessions and refuses self/last-admin; reports match hand-computed fixtures; CSV export shape; audit rows for every mutation; migration 7 CHECKs and `rollback.sql` |
| **E2E** (admin user seeded) | CUSTOMER is refused at `/admin` and by a direct action; STAFF enrols 2FA and signs in with a TOTP code (generated in the test from the secret); overview renders real counts; create product → variant → image by URL → publish → visible in the storefront; adjust stock → storefront availability changes; order placed by a customer → start processing → ship (email via outbox job) → deliver → COD collected; NEEDS_REVIEW order (fake mismatch) → re-check → attach payment → confirmed; failed outbox row → retry → sent; role change by ADMIN; axe and keyboard on every admin page; mobile drawer                                                                                                                                                                                                             |
| **CI**                      | `SEED_ADMIN_PASSWORD` throwaway value so the seed creates the dev admin; fake Cloudinary signature path (no network: uploads by URL in e2e); `npm audit` unchanged (no new runtime dependency: `better-auth` already includes `twoFactor`; TOTP generation in tests uses `node:crypto`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## 12. Implementation sequence

1. **Foundation:** migration 7 + rollback; `authz.ts` + `writeAudit`; admin shell, layout gate, proxy matcher; promote script and dev-seed admin; transitions extended. Tests.
2. **Orders and fulfilment:** list/detail, processing/ship/deliver, notes, admin cancel with restock/refund intent, COD collected, emails. Tests.
3. **Payments and refunds:** review queue and investigation, attach/accept/cancel-and-refund, refunds (create, retry, external), operations pages for refunds. Tests.
4. **Operations monitoring:** jobs, outbox, webhooks, alerts; retries and run-now. Tests.
5. **Catalogue and inventory:** products, options/variants, images (signed uploads), categories; inventory levels and adjustments. Tests.
6. **Customers and reports:** lists, detail, role change; report queries and CSV export. Tests.
7. **Two-factor sign-in (A2):** plugin, enrolment page, gate. Tests.
8. **E2E, docs (admin.md §16, roadmap, data-model, architecture, CLAUDE.md), gates, commit.**

Each step ends with green gates and a commit; steps 2–3 are front-loaded because they touch money.

---

## 13. Operational requirements before production

These are needed regardless of Phase 7 and are documented here because the admin pages are where their effects become visible.

| Requirement                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Cron frequency**            | `vercel.json` schedules `expire-reservations`, `recover-payments`, `process-webhooks`, `send-notifications` every 5 minutes, `reconcile-payments` and `refund-payments` every 15 minutes, `cleanup` daily. Vercel Hobby runs crons **once a day**, which would delay reservation release, emails and refunds by up to a day. Production needs **Vercel Pro** or an external scheduler (e.g. a monitored HTTP pinger) calling `/api/cron/<job>` with `Authorization: Bearer $CRON_SECRET` on those intervals. Decide in Phase 11 (D4/D11); the Operations page shows the last claim time per queue so a stalled scheduler is obvious. |
| **Payment reconciliation**    | `reconcile-payments` must run at least every 15 minutes: it confirms captures whose webhook and callback were both missed. Alert when any `PENDING_PAYMENT` order with a `CREATED`/`AUTHORIZED` attempt is older than 30 minutes (Operations page + `ops.alert` in Phase 7).                                                                                                                                                                                                                                                                                                                                                         |
| **Refund recovery**           | `refund-payments` must run at least every 15 minutes; a refund `FAILED` after the policy's attempts sends an `ops.alert` and stays listed until an ADMIN retries it or records an external refund. Razorpay refunds take 5–7 working days; "REQUESTED" rows are polled until `processed`.                                                                                                                                                                                                                                                                                                                                            |
| **Webhook secret and events** | Dashboard: webhook URL `https://<domain>/api/webhooks/razorpay`, secret in `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured`, `payment.failed`, `payment.authorized`, `order.paid`, `refund.processed`; rotate with `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` for an overlap window. Auto-capture enabled.                                                                                                                                                                                                                                                                                                                               |
| **Alert inbox**               | `ORDER_NOTIFY_EMAIL` set to a monitored mailbox; `ops.alert` emails are the only signal for FAILED rows until Phase 10 monitoring.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Razorpay test-mode smoke**  | Still outstanding from Phase 6: run checkout.md §15 on a preview deployment with test keys before going live.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **First admin and 2FA**       | `npm run admin:promote -- <email>` on the production database, then enrol 2FA at first visit; keep backup codes offline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Backups**                   | Orders, payments and the audit log are the records of money; point-in-time recovery on the hosted database (Phase 11, D4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## 14. Acceptance criteria

1. Every gate passes with real output; CI green; migration 7 applied and rolled back on the test database with zero drift (enum values documented as non-reversible).
2. No admin action changes money or stock without an audit row in the same transaction; a test proves it for each action.
3. An order cannot be confirmed by the admin without a captured attempt or the COD method, proven by tests that try.
4. STAFF cannot perform any ADMIN-only capability through the UI or a direct action call; CUSTOMER cannot reach any admin page or action; proven by tests.
5. Admin cancellation restores stock exactly and queues a refund for captured payments; the refund worker completes it with the fake gateway.
6. Retries never bypass the workers: a retried row is processed by the same job code.
7. Reports agree with hand-computed figures on fixtures; the storefront still shows no "best-selling" claim.
8. axe reports zero violations on every admin page; every action is keyboard-operable and works without JavaScript except the direct-to-Cloudinary uploader, which degrades to URL entry.
9. Phases 1–6 behaviour unchanged: existing tests pass unmodified (additions only).
