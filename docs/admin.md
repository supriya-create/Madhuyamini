# Madhuyamini — Admin Dashboard and Store Operations (Phase 7)

Status: **Proposed, awaiting approval** · 1 Nov 2026, revised the same day · Nothing in this document has been implemented or tested.

Revision 2 incorporates the owner's eight refinements: a second factor required of every staff session with enrolment verification, one-time recovery codes, replay protection, rate limits and re-authentication (§5.9); payment and fulfilment states kept independent with explicit, audited cash-on-delivery transitions (§5.10); masked, permission-controlled customer data (§5.7); audit rows that survive rolled-back mutations without secrets or needless PII (§6); hardened Cloudinary uploads (§5.2); concurrency-safe last-admin protection and session revocation (§6, §7.1); production safeguards for the promote script (§13); inventory adjustments that record reason, actor and before/after quantities (§3, §5.3).

Scope: a role-gated admin area for running the shop day to day — overview, catalogue (products, categories, variants, images), inventory, orders and fulfilment, payment and refund investigation, background-job and webhook monitoring with safe retries, customers, reports, audit logging and admin two-factor sign-in. Everything money- or stock-related calls the Phase 5–6 services; the admin adds authorisation, confirmation, evidence and an audit trail around them. Out of scope: coupons, reviews moderation, returns, custom-artwork requests (Phase 8); content pages (Phase 9); CSP and monitoring (Phase 10).

Related: [checkout.md](checkout.md) (orders, payments, jobs), [cart.md](cart.md), [auth.md](auth.md), [data-model.md](data-model.md), [architecture.md](architecture.md) §7.

---

## 0. What exists today versus what this phase adds

| Area                | Existing (Phases 1–6)                                                                                                                                                                                                                                                         | Proposed in Phase 7                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles               | `User.role` (`CUSTOMER` / `STAFF` / `ADMIN`), server-owned, never from input; `requireRole(minimum)` with rank CUSTOMER < STAFF < ADMIN; `proxy.ts` redirects `/account/*` optimistically; Better Auth sessions, revocation, password policy, rate limits                     | `/admin/*` area; a permission matrix on top of the two staff roles; a second factor proven per session (own RFC 6238 module, §5.9) with recovery codes and re-authentication; role changes with session revocation; a safeguarded script to promote the first admin |
| Catalogue           | Read-only storefront services (`features/catalog`), parameterised SQL listing, seed-only writes; `Product.status` DRAFT/ACTIVE/ARCHIVED; `techniques[]`, `constructionMethods[]`, options/values/variants, images with required `alt`, Cloudinary delivery loader (URLs only) | Write services with Zod schemas; archive instead of delete; image upload through Cloudinary signed uploads; slug and SKU rules                                                                                                                                      |
| Inventory           | `Inventory` (`stockOnHand`, `reserved`, `lowStockThreshold`) with CHECKs; `features/inventory/service.ts` conditional updates (reserve, commit, consume, release, lock-then-check commit); holds tied to orders                                                               | Adjustments (receive, correct, write-off) that respect `reserved`, recorded in `inventory_adjustments`; low-stock view; restock on admin cancellation                                                                                                               |
| Orders              | `OrderStatus` PENDING_PAYMENT / CONFIRMED / CANCELLED / NEEDS_REVIEW; transitions table with `admin_confirmed` and `admin_cancelled` edges; `order_events` timeline; customer views; `cancelPendingOrder`                                                                     | Fulfilment states PROCESSING → SHIPPED → DELIVERED; `shipments` (carrier, tracking); admin cancellation with restock and refund intent; COD "cash collected"; staff notes as events                                                                                 |
| Payments            | Attempts with provider ids; `applyCapture` (idempotent, mismatch → NEEDS_REVIEW, late/duplicate → refund intent), `applyFailure`, `confirmFromCallback`, `reconcileAttempt`, `ensureProviderOrder`; refund queue (`refunds`) executed by `refund-payments`; webhook ledger    | Investigation views; resolution actions that only ever call those functions with provider evidence; staff-initiated refunds through the same queue                                                                                                                  |
| Jobs                | `server/jobs/*` with claim/lease/backoff; cron routes; `vercel.json`; `npm run job`; FAILED rows raise `ops.alert` emails                                                                                                                                                     | Monitoring pages for the outbox, webhook ledger and refunds; retry by resetting rows for the workers; "run now" for ADMIN                                                                                                                                           |
| Notifications       | Outbox kinds for confirmation, cancellation, refund, owner notices, ops alerts                                                                                                                                                                                                | New kinds: shipped, delivered, cancelled by the shop, refund processed                                                                                                                                                                                              |
| Audit               | `order_events` (append-only, actor enum includes ADMIN)                                                                                                                                                                                                                       | `admin_audit_log` (append-only) written in the same transaction as every admin mutation                                                                                                                                                                             |
| UI                  | Storefront shell, design tokens, forms (`Field`, `FormStatus`, `SubmitButton`), `AccountShell` pattern, `EmptyState`, axe + keyboard e2e                                                                                                                                      | Admin shell (sidebar, no storefront header), data tables, confirmation pages, status badges; same tokens, CSS Modules, no Tailwind                                                                                                                                  |
| Policy and settings | `src/config/checkout-policy.ts` (code constants, accessor)                                                                                                                                                                                                                    | Unchanged this phase (decision A6)                                                                                                                                                                                                                                  |

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
11. **Two-factor sign-in**: Better Auth ships a `twoFactor` plugin, but it ties enforcement to a user flag and keeps no per-session proof, accepted-step record or re-authentication window. The gate needs all three, so Phase 7 implements RFC 6238 itself over `node:crypto` (§5.9), leaving password sign-in and sessions to Better Auth.
12. **Reports must never claim what cannot be computed**: revenue counts only `CONFIRMED`-and-beyond orders with captured or COD payments; "best-selling" stays internal until Phase 9 decides to show it.
13. **Vercel Hobby crons are daily** (checkout.md): the monitoring pages make slow sweeps visible, but production needs a scheduler (§13).

---

## 2. Decisions needed before implementation

| #       | Question                                           | Recommendation                                                                                                                                                                                                                                                                                                   |
| ------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1**  | What may STAFF do versus ADMIN?                    | STAFF: run the shop (catalogue edits, stock adjustments, fulfilment, COD collection, customer lookup, retry emails). ADMIN additionally: publish/archive products, refunds and NEEDS_REVIEW resolution, cancellations after confirmation, job "run now", role changes, settings, exports. Matrix in §9.          |
| **A2**  | Two-factor sign-in for staff                       | **Yes, in this phase, as part of the gate**: own RFC 6238 TOTP module (no plugin, no new dependency), enrolment verified by a first code, ten one-time recovery codes, replay protection, rate limits, and re-authentication within 10 minutes for sensitive operations; required of every staff session (§5.9). |
| **A3**  | Product deletion                                   | Archive by default. Hard delete only for `DRAFT` products with no order items, ADMIN only, typed-confirmation. Categories: delete only when empty.                                                                                                                                                               |
| **A4**  | Image uploads                                      | Cloudinary signed uploads from the browser (server issues the signature; nothing is proxied), stored by `publicId`; `alt` text required on save. Needs the three Cloudinary variables.                                                                                                                           |
| **A5**  | Fulfilment data                                    | A `shipments` table now (carrier name, tracking number, optional URL, shipped at, delivered at) — one shipment per order in Phase 7; partial shipments are Phase 8.                                                                                                                                              |
| **A6**  | Editable store settings (shipping, COD, policy)    | **Defer.** Keep `checkout-policy.ts` as the single source this phase; a settings table means changing every caller to an async, cached read and a migration. Revisit after the first weeks of real orders.                                                                                                       |
| **A7**  | Cancelling a shipped order                         | Not in Phase 7 (needs returns, Phase 8). Cancellation is possible up to `PROCESSING`; `SHIPPED` and `DELIVERED` are final here.                                                                                                                                                                                  |
| **A8**  | Customer data in the admin                         | STAFF see masked contact details and no address lines; revealing them is a reasoned, time-boxed, audited action held by ADMIN and grantable per staff member; order addresses are visible to STAFF only while the order is being fulfilled (§5.7). No exports, deletion or impersonation this phase.             |
| **A10** | Cash on delivery refused at the door               | Record it as an explicit payment transition (`cod_refused`) and cancel the order with a `COD_REFUSED` reason once the parcel is back, restocking through audited adjustments (§5.10). Return handling proper is Phase 8.                                                                                         |
| **A11** | Granting STAFF the right to reveal contact details | Per-user grants (`grants` list on the user, ADMIN-set, audited) rather than a third role; default none.                                                                                                                                                                                                          |
| **A9**  | First admin                                        | `npm run admin:promote -- <email>` with the safeguards in §13 (verified account, typed confirmation, production confirmation variable, audit row, sessions revoked, never over HTTP); the dev seed creates `admin@example.com` only when `SEED_ADMIN_PASSWORD` is set (CI sets a throwaway value).               |

---

## 3. Database changes (migration 7, `admin_operations`)

Only what the features above need; everything else reuses Phase 5–6 tables.

```prisma
// Fulfilment states appended to the existing enum (online ALTER TYPE … ADD VALUE).
enum OrderStatus { PENDING_PAYMENT  CONFIRMED  PROCESSING  SHIPPED  DELIVERED  CANCELLED  NEEDS_REVIEW }
// `COD_REFUSED` appended (A10); `STAFF` appended to OrderActor.
enum CancellationReason { PAYMENT_FAILED  PAYMENT_TIMEOUT  CUSTOMER  STOCK_UNAVAILABLE  ADMIN  COD_REFUSED }

enum AuditOutcome { SUCCESS  REFUSED  FAILED }

/// Append-only (refinement 4). SUCCESS rows share the mutation's transaction;
/// REFUSED and FAILED rows are written in their own transaction after the
/// business transaction has rolled back, so nothing a reviewer needs is lost.
model AdminAuditLog {
  id         String       @id @default(uuid(7)) @db.Uuid
  actorId    String?      @map("actor_id") @db.Uuid     // null only for the promote script (actor recorded in `actorLabel`)
  actorLabel String       @map("actor_label")           // "user:<id>" or "script:promote-admin@<host>"
  actorRole  UserRole?    @map("actor_role")
  sessionId  String?      @map("session_id") @db.Uuid   // which staff session acted (revocations are traceable)
  action     String                                     // order.cancel, product.publish, refund.create, job.retry, user.role.set, customer.pii.reveal, …
  targetType String       @map("target_type")
  targetId   String?      @map("target_id")
  outcome    AuditOutcome
  reason     String?                                    // operator-supplied reason where required
  errorCode  String?      @map("error_code")            // FAILED: the AppError code, never a message or stack
  before     Json?                                      // redacted snapshot (allow-list per target type)
  after      Json?
  requestIp  String?      @map("request_ip")            // SHA-256 of the address, as the rate limiter stores
  createdAt  DateTime     @default(now()) @map("created_at")
  actor User? @relation(fields: [actorId], references: [id], onDelete: SetNull)
  @@index([targetType, targetId, createdAt])
  @@index([actorId, createdAt])
  @@index([action, createdAt])
  @@index([createdAt])
  @@map("admin_audit_log")
}

enum InventoryAdjustmentKind { RECEIVED  CORRECTION  WRITE_OFF  RESTOCK_ON_CANCEL  RESTOCK_ON_COD_REFUSED }

/// Every admin-originated stock change with who, why, and the quantities
/// before and after (refinement 8). Sales remain derivable from order_items.
model InventoryAdjustment {
  id             String                  @id @default(uuid(7)) @db.Uuid
  variantId      String                  @map("variant_id") @db.Uuid
  kind           InventoryAdjustmentKind
  delta          Int                                           // signed; CHECK <> 0
  stockBefore    Int                     @map("stock_before")  // CHECK >= 0
  stockAfter     Int                     @map("stock_after")   // CHECK = stock_before + delta AND >= reserved_at_time
  reservedAtTime Int                     @map("reserved_at_time")
  reason         String                                        // CHECK length(btrim(reason)) >= 3
  actorId        String?                 @map("actor_id") @db.Uuid   // required unless kind is a system restock (CHECK)
  orderId        String?                 @map("order_id") @db.Uuid   // required for system restocks (CHECK)
  auditId        String?                 @map("audit_id") @db.Uuid   // the admin_audit_log row for the same operation
  createdAt      DateTime                @default(now()) @map("created_at")
  variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Restrict)
  @@index([variantId, createdAt])
  @@index([orderId])
  @@map("inventory_adjustments")
}

model Shipment {
  id             String    @id @default(uuid(7)) @db.Uuid
  orderId        String    @unique @map("order_id") @db.Uuid      // one per order in Phase 7
  carrier        String
  trackingNumber String?   @map("tracking_number")
  trackingUrl    String?   @map("tracking_url")                   // CHECK: https:// only
  shippedAt      DateTime  @map("shipped_at")
  deliveredAt    DateTime? @map("delivered_at")                   // CHECK >= shipped_at
  createdById    String    @map("created_by_id") @db.Uuid
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")
  order Order @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@map("shipments")
}

// --- Staff two-factor sign-in (refinement 1). Own RFC 6238 implementation; see §5.9. ---

model StaffTwoFactor {
  userId          String    @id @map("user_id") @db.Uuid
  /// AES-256-GCM ciphertext of the TOTP secret under ADMIN_TOTP_KEY; never the secret itself.
  secretCiphertext String   @map("secret_ciphertext")
  keyVersion      Int       @map("key_version")               // for key rotation
  /// Null until the first code verifies: an unverified enrolment never counts.
  enabledAt       DateTime? @map("enabled_at")
  /// Replay protection: the last time step (floor(unix / 30)) whose code was accepted.
  lastAcceptedStep BigInt?  @map("last_accepted_step")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("staff_two_factor")
}

/// One-time recovery codes, stored hashed (scrypt), consumed on use.
model StaffRecoveryCode {
  id        String    @id @default(uuid(7)) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  codeHash  String    @unique @map("code_hash")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("staff_recovery_codes")
}

/// Proof that THIS session passed the second factor (refinement 1). No row,
/// no admin access, whatever the user's role. Sessions table is Better Auth's.
model StaffSessionVerification {
  sessionId  String   @id @map("session_id") @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  method     String                                   // TOTP | RECOVERY
  verifiedAt DateTime @map("verified_at")             // refreshed by re-authentication
  createdAt  DateTime @default(now()) @map("created_at")
  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("staff_session_verifications")
}
```

**Constraints and guards in SQL (tested in `tests/integration/`):**

| Constraint / guard                                                   | Rule                                                                                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory_adjustments_delta_nonzero`                                | `delta <> 0`                                                                                                                                                                     |
| `inventory_adjustments_quantities_consistent`                        | `stock_after = stock_before + delta AND stock_before >= 0 AND stock_after >= reserved_at_time`                                                                                   |
| `inventory_adjustments_reason_present`                               | `length(btrim(reason)) >= 3`                                                                                                                                                     |
| `inventory_adjustments_actor_or_order`                               | `(kind IN ('RESTOCK_ON_CANCEL','RESTOCK_ON_COD_REFUSED') AND order_id IS NOT NULL) OR actor_id IS NOT NULL`                                                                      |
| `shipments_delivered_after_shipped`                                  | `delivered_at IS NULL OR delivered_at >= shipped_at`                                                                                                                             |
| `shipments_tracking_url_https`                                       | `tracking_url IS NULL OR tracking_url LIKE 'https://%'`                                                                                                                          |
| `admin_audit_log_actor_present`                                      | `actor_id IS NOT NULL OR actor_label LIKE 'script:%'`                                                                                                                            |
| `staff_two_factor_key_version_positive`                              | `key_version >= 1`                                                                                                                                                               |
| `users_keep_one_admin` (trigger, `BEFORE UPDATE OR DELETE ON users`) | refuses a change that would leave zero `ADMIN` rows; the service also serialises role changes with an advisory lock (§6), so the trigger is the last line, not the first         |
| Audit log immutability                                               | A `BEFORE UPDATE OR DELETE` trigger raising an exception on `admin_audit_log` (the application role has no need to change rows; this guards against mistakes, not a hostile DBA) |

`rollback.sql` drops the new tables, triggers and columns, and documents that PostgreSQL cannot remove enum values (`PROCESSING`, `SHIPPED`, `DELIVERED`, `COD_REFUSED`, `STAFF`) without recreating the types; they stay, unused and harmless.

**Env additions:** `ADMIN_TOTP_KEY` (32 random bytes, base64url; required at use time for any staff sign-in; rotation via `ADMIN_TOTP_KEY_PREVIOUS` + `keyVersion`), `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (uploads unavailable until set; nothing fails at build), `ADMIN_PROMOTE_CONFIRM` (§13, only for the promote script, never set permanently).

---

## 4. Admin area structure

```
src/app/admin/
  layout.tsx                       # requireStaffSession(): role ≥ STAFF AND a verified second factor for THIS session; AdminShell
  page.tsx                         # 1. Overview
  catalogue/products/              # 2. list, [id]/edit, new, [id]/variants, [id]/images
  catalogue/categories/            # 2. tree editor
  inventory/                       # 3. levels, low stock, [variantId]/adjust
  orders/                          # 4. list with filters, [id] detail, [id]/cancel (confirm page), [id]/ship
  payments/review/                 # 5. NEEDS_REVIEW queue, [orderId] investigation
  payments/refunds/                # 5. refund queue and history
  operations/                      # 6. jobs, outbox, webhooks, alerts
  customers/                       # 7. list (masked), [id] (masked; reveal is an audited action)
  reports/                         # 8. sales, products, inventory, exports
  audit/                           # 9. audit log browser (ADMIN)
src/app/(storefront)/account/security/two-factor/   # enrolment and recovery codes (reachable before the admin gate)
src/app/(storefront)/login/verify/                   # second-factor step after password sign-in (staff only)
src/app/admin/reauth/                                # fresh code for sensitive operations, returns to `next`
src/features/admin/
  authz.ts                         # permission matrix (pure) + requirePermission(); sensitive permissions carry `reauth: true`
  audit.ts                         # runAudited(): SUCCESS inside the transaction, REFUSED/FAILED after rollback; redactors per target type
  security/{totp,schemas,service,actions}.ts   # enrolment, verification, recovery codes, re-auth, reset by ADMIN
  catalogue/{schemas,data,service,actions}.ts
  inventory/{schemas,service,actions}.ts
  orders/{schemas,service,actions}.ts        # fulfilment, cancellation, notes
  payments/{schemas,service,actions}.ts      # review resolution, refunds, COD collected / refused
  operations/{service,actions}.ts            # retries, run-now
  customers/{data,service,actions}.ts        # masked reads; reveal; role change
  reports/{data,service}.ts                  # parameterised SQL aggregates
src/config/admin-policy.ts                   # TOTP (step 30 s, 6 digits, ±1 step), attempt limits, re-auth window, upload limits, masking rules, reveal TTL
src/server/security/totp.ts                  # RFC 6238 over node:crypto (HMAC-SHA1), secret encryption (AES-256-GCM), recovery-code hashing
src/server/uploads/cloudinary.ts             # signature issue + response verification (§5.2)
src/components/admin/                        # AdminShell, DataTable, StatusBadge, ConfirmForm, StatCard, Filters, Masked …
scripts/promote-admin.ts                     # §13 safeguards
```

`proxy.ts` gains `/admin/:path*` to its matcher (optimistic redirect to `/login?next=`); authority stays in `requireStaffSession` inside the layout **and** inside every Server Action and data function (the layout check alone is not enough because actions are routable). `requireStaffSession` = `requireRole("STAFF")` + a `staff_session_verifications` row for the current session id; `requireReauth(permission)` additionally requires `verifiedAt` within `adminPolicy.reauthWindowMinutes`.

---

## 5. Feature design

### 5.1 Overview (business dashboard)

Server-rendered stat cards and lists, all from existing tables: orders and revenue today / 7 days / 30 days (confirmed-and-beyond, captured or COD), orders awaiting payment, awaiting fulfilment (`CONFIRMED` + `PROCESSING`), `NEEDS_REVIEW` count, FAILED queue rows (outbox, webhooks, refunds), low-stock variants, last job runs (derived from queue rows' `claimed_at` — no new table). Links go to the filtered lists. Nothing is estimated; empty states say "no orders yet".

### 5.2 Catalogue

- **Products:** list (status, category, variants, stock, updated); create/edit form (title, slug — generated from the title, editable, uniqueness checked server-side; subtitle; description; techniques ≥ 1; construction methods; material; care; category; one-of-a-kind; featured; SEO fields; HSN/tax rate kept nullable per D7c). **Publish** (`DRAFT → ACTIVE`, ADMIN; requires ≥ 1 active variant with price and ≥ 1 image with alt) and **archive** (`ACTIVE → ARCHIVED`; carts flag the lines, Phase 5). Hard delete per A3.
- **Options and variants:** define option axes and values; create variants per combination; SKU (unique, immutable once an order item references it), price in rupees converted to paise on the server, compare-at, weight, active flag. A variant with order items or cart lines cannot be deleted (Restrict already) — deactivate instead.
- **Images (hardened signed uploads, refinement 5):** the server issues a short-lived signature only to staff holding `catalogue.images`, binding `timestamp`, a fixed `folder` (`madhuyamini/products/<productId>`), a server-generated `public_id`, `resource_type=image`, `allowed_formats=jpg,png,webp,avif`, an incoming transformation `c_limit,w_4000,h_4000`, and a **signed upload preset** that enforces the byte ceiling and minimum/maximum dimensions at Cloudinary. The browser uploads directly (nothing is proxied) with `accept` and a client-side size check as a courtesy only. On completion the server **verifies Cloudinary's response signature** (`public_id` + `version` under the API secret) and checks `resource_type`, `format`, `bytes`, `width`, `height` and `folder` against `adminPolicy.uploads` (min 800×800, max 6000×6000, ≤ 8 MB, formats above) before storing `url`, `publicId`, `width`, `height` and the required `alt`. Anything else is refused and nothing is stored. Ordering and variant assignment are plain updates; removal deletes at Cloudinary through the Admin API after the row is gone (best effort, audited); orphans are swept daily (§7.1). Signatures are valid for Cloudinary's one hour; our issue log keeps them attributable.
- **Categories:** tree with position, activate/deactivate, move under another parent (cycle check), delete only when no products and no children (Restrict already).

### 5.3 Inventory

- Levels table (variant, product, SKU, on hand, reserved, available, threshold) with low-stock filter.
- **Adjust** (STAFF): kind RECEIVED / CORRECTION / WRITE_OFF, signed delta, reason required (≥ 3 characters). Transaction (A3): lock the inventory row (`lockInventoryRows`), read `stock_on_hand` and `reserved`, refuse unless `stock_on_hand + delta >= reserved` and `>= 0`, update, insert `inventory_adjustments` with `stockBefore`, `stockAfter`, `reservedAtTime`, `reason`, `actorId` and the audit row id, then the SUCCESS audit row. Refusals say how many units are held by pending orders and are audited `REFUSED`. The adjustment history is shown per variant with who, when, why and the quantities before and after.
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

| Action                    | Who   | What happens                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Re-check with provider    | STAFF | `reconcileAttempt(attemptId)` for each open or failed attempt; outcome shown and audited. The usual fix for "paid but stuck".                                                                                                                                                                                                                                     |
| Attach a provider payment | ADMIN | Operator pastes a Razorpay payment id (from the Dashboard). Server: `gateway.fetchPayment(id)`; it must belong to one of this order's provider orders, be `captured`, and the amount/currency are passed to `applyCapture` (which itself decides confirm vs. mismatch). The fetched payment is stored in the audit `after`.                                       |
| Accept a mismatch         | ADMIN | Only when a `CAPTURED` attempt exists on the order (the evidence is already in `payments`). Reason required; typed order number. Calls the `admin_confirmed` transition: consume holds, `CONFIRMED`, cart `CONVERTED`, confirmation email. Underpayments are refused by default unless the policy flag `review.allowUnderpaymentAccept` is set (false).           |
| Cancel and refund         | ADMIN | `admin_cancelled`: release/restock as in 5.4, refund intent for every captured attempt (reason `review_cancelled`), outbox refund email, audit.                                                                                                                                                                                                                   |
| Refund (full or partial)  | ADMIN | For `CONFIRMED+` orders with a captured attempt: amount ≤ captured − already refunded; creates a `refunds` row (`INITIATED`, reference `${orderNumber}-R${n}`) and lets `refund-payments` execute it. Partial refunds leave the order status unchanged; a full refund of an unshipped order is the cancel path.                                                   |
| Mark COD cash collected   | STAFF | An explicit payment transition on the COD attempt (`cod_collected`, §5.10): allowed on `DELIVERED` (or `SHIPPED` with a reason), the amount entered must equal the attempt amount, recorded with `capturedAt` and `collectedById`, order event `payment.cod_collected`, audited. Fulfilment status is not touched. Revenue reports count COD only once collected. |
| Retry a failed refund     | ADMIN | Resets the `refunds` row to `INITIATED` with `attempts = 0`, `nextAttemptAt = now`, `lastError` kept in audit; the worker does the rest. If the money was refunded by hand in the Dashboard, **Mark refunded externally** records the provider refund id the operator pastes after the server fetches and verifies it via `listRefunds`.                          |

Nothing here writes `status = CAPTURED` from a form field; nothing marks an order `CONFIRMED` without a `CAPTURED` attempt (online) or the COD method.

### 5.6 Operations: jobs, webhooks, notifications

- **Jobs page:** per job: last claim time and counts from the queue tables; "Run now" (ADMIN) calls `runJob(name)` in the request (same lease rules as the cron, so overlapping runs are safe) and shows the summary; audited.
- **Outbox:** list by status with filters; FAILED rows show `lastError`; **Retry** (STAFF) resets `status = PENDING, attempts = 0, nextAttemptAt = now, claimedAt = null` (dedupe key unchanged, so a duplicate send is still impossible by key); **Discard** (ADMIN, reason) sets `FAILED` with a note. Payloads shown; recipients masked for STAFF.
- **Webhook ledger:** list, filter by type/status, payload viewer with PII masked for STAFF (email, contact, vpa, card fields); **Re-apply** (ADMIN) resets to `RECEIVED` for `process-webhooks` (the handler is idempotent).
- **Refund queue:** INITIATED / REQUESTED / FAILED with provider ids; retry per 5.5.
- **Alerts:** the `ops.alert` outbox rows as an inbox with "acknowledge" (audit only).

### 5.7 Customers (masked by default, refinement 3)

- **List and search** (STAFF): search by order number, or by exact email or phone (the input is normalised and hashed for the lookup; the list never shows what was typed back). Rows show name, masked email (`a***@example.com`), masked phone (last four digits), role, verification state, order count, city of the default address. No address lines, no full contact details.
- **Detail** (STAFF): the same masked identity, orders (number, status, total, date), verification state, session count. Addresses show recipient name, city, state and PIN only.
- **Reveal contact details** (permission `customer.pii.reveal`, ADMIN by default; grantable to STAFF per user through the permission matrix's `grants` list, decision A1): an explicit action with a reason that re-renders the page with the full email, phone and address lines for `adminPolicy.pii.revealMinutes` (10), recorded as `customer.pii.reveal` with the fields revealed. Reveals are listed in the audit browser and counted on the overview ("reveals this week").
- **Order fulfilment needs the address:** on an order detail in `CONFIRMED`, `PROCESSING` or `SHIPPED`, STAFF see the delivery address and phone of that order (operational necessity, logged once per order as `order.address.view` the first time a given staff member opens it); on `DELIVERED` or `CANCELLED` orders they are masked again.
- **Set role** (ADMIN; sensitive → re-auth): cannot target self; cannot demote the last ADMIN (serialised, §6); revokes every session and staff verification of the target in the same transaction; audited with before/after roles; an `ops.role_changed` email goes to the owner inbox.
- **Reset a staff member's two-factor** (ADMIN; sensitive): deletes their `staff_two_factor`, recovery codes and session verifications so they enrol again at next sign-in; audited; owner notified.
- **Resend verification email** (STAFF): reuses the Phase 4 rate-limited action.
- No deletion, export or impersonation (A8); DPDP export and erasure are Phase 8/10.

### 5.8 Reports

Parameterised SQL in `features/admin/reports/data.ts`, each with a unit-tested shape and an integration test against fixtures:

- **Sales:** orders, units, gross revenue (paise) per day/week/month; by payment method; cancelled and refunded amounts; average order value. Definition: revenue = `total_in_paise` of orders in `CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELIVERED` whose payment is `CAPTURED` (online) or collected (COD), minus processed refunds.
- **Products:** units and revenue per product/variant for a period (from `order_items`), with no claim of "best-selling" on the storefront until Phase 9.
- **Inventory:** on hand, reserved, available, value at current price, low stock, adjustments in period.
- **Operations:** payment success rate by attempt, time from placement to capture, late captures, refund totals, failed-job counts.
- **CSV export** (ADMIN): route handler `GET /admin/reports/export?report=…&from=…&to=…` streaming text; audited.

### 5.9 Staff sign-in, two-factor and re-authentication (refinement 1)

**Why an own implementation rather than Better Auth's `twoFactor` plugin:** the plugin ties enforcement to the user's `twoFactorEnabled` flag and finishes the sign-in once a code is accepted; it keeps no per-session proof, no accepted-step record for replay protection, and no notion of a re-authentication window. The admin gate needs all three. RFC 6238 is thirty lines over `node:crypto` (HMAC-SHA1, 30-second steps, six digits, ±1 step tolerance), tested against the RFC's published vectors; secrets are encrypted at rest; Better Auth continues to own password sign-in and sessions.

**Enrolment** (`/account/security/two-factor`, any STAFF/ADMIN account; CUSTOMER accounts have no second factor):

1. Password re-entry (Better Auth sign-in check without creating a session) → a new secret is generated, encrypted with `ADMIN_TOTP_KEY` (AES-256-GCM, `keyVersion`), stored with `enabledAt = null`, and shown once as a QR code and text (`otpauth://totp/Madhuyamini:<email>?secret=…&issuer=Madhuyamini&digits=6&period=30`).
2. **Enrolment verification:** the user must enter a current code; only then is `enabledAt` set and `lastAcceptedStep` recorded. An unverified enrolment is discarded after `adminPolicy.enrolmentMinutes` (15) and never satisfies the gate.
3. **Recovery codes:** ten codes of ten characters from the unambiguous alphabet, generated once, shown once, stored as scrypt hashes; each is single-use (`usedAt`). Regeneration requires a fresh TOTP code and invalidates the old set; using a recovery code emails the user and the owner inbox.

**Every staff session must verify** (not merely users with the flag): after password sign-in, `/login/verify` asks for a code; success writes `staff_session_verifications` for the current session id. `requireStaffSession()` refuses `/admin/*` and every admin action when the row is missing — a STAFF/ADMIN account that has not enrolled is sent to enrolment first, and an account whose enrolment was reset by an ADMIN is sent there again. Sessions created before enrolment, or on another device, each need their own verification. The storefront account area keeps working without it (staff are also customers).

**Replay protection:** a submitted TOTP code is accepted only if its time step is greater than `lastAcceptedStep`; the step is recorded in the same transaction as the verification row. The same code, or any code from an earlier step, is refused even if mathematically valid. Recovery codes are consumed atomically (`UPDATE … WHERE used_at IS NULL RETURNING`).

**Rate limiting** (through the Phase 4 limiter; keys hashed): TOTP attempts 5 per 15 minutes per user and 20 per 15 minutes per IP; recovery-code attempts 3 per hour per user; enrolment restarts 3 per hour per user; re-authentication prompts share the TOTP limits. Limits lapse with the window; there are no permanent lockouts, but five failed recovery attempts email the owner inbox.

**Re-authentication for sensitive operations:** permissions marked `reauth` in the matrix (refunds, attach payment, accept mismatch, cancel confirmed orders, role changes, 2FA resets, run-now, discard, hard delete, CSV export, PII reveal grants) require the session's `verifiedAt` to be within `adminPolicy.reauthWindowMinutes` (10). Otherwise the action redirects to `/admin/reauth?next=…`, which asks for a fresh code and refreshes `verifiedAt`; the pending form is then resubmitted by the user (no replay of the original request).

**Key handling:** `ADMIN_TOTP_KEY` is required for any staff sign-in; rotation decrypts with `ADMIN_TOTP_KEY_PREVIOUS` by `keyVersion` and re-encrypts on next verification. The key never leaves the server; secrets are never logged or included in audit snapshots (the redactor drops them).

### 5.10 Payment status and fulfilment status are independent (refinement 2)

Two machines, two tables, no shared columns: `Order.status` is the **fulfilment lifecycle** (`PENDING_PAYMENT → CONFIRMED → PROCESSING → SHIPPED → DELIVERED`, with `CANCELLED` and `NEEDS_REVIEW`); `Payment.status` is the **money lifecycle** of each attempt (`INITIATED → CREATED → AUTHORIZED → CAPTURED → REFUNDED`, `FAILED`). The only coupling is the Phase 6 rule that an online order becomes `CONFIRMED` when a capture is applied, and the Phase 7 rule that a cancellation of a captured order queues a refund. Fulfilment actions never write `payments`; payment actions never advance fulfilment beyond `CONFIRMED`.

**Cash on delivery** has its own explicit payment transitions, applied by `applyCodEvent(attemptId, event, facts)` in `features/payments` (reused by the admin, never reimplemented):

| Event           | From → To            | Who   | Preconditions                                                                                                       | Effects                                                                                                                                                                            |
| --------------- | -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cod_collected` | `CREATED → CAPTURED` | STAFF | order `DELIVERED` (or `SHIPPED` with reason "collected at handover"); amount entered equals `amountInPaise` exactly | `capturedAt`, `collectedById` recorded on the attempt; order event `payment.cod_collected`; audit; revenue reports count the order from this moment                                |
| `cod_refused`   | `CREATED → FAILED`   | STAFF | order `SHIPPED`; reason required                                                                                    | attempt `FAILED` with `failureCode = COD_REFUSED`; order `CANCELLED (COD_REFUSED)` once the parcel is back, with `RESTOCK_ON_COD_REFUSED` adjustments; audit; owner notified (A10) |

Partial collection is refused (the amount must match); correcting a mistaken collection is an ADMIN re-auth action `cod_collection_reversed` (`CAPTURED → CREATED` for COD attempts only, reason required, audited) so that the money ledger is never edited by hand.

---

## 6. Transaction boundaries, audit atomicity and lock order

**Audit atomicity (refinement 4).** `runAudited({ actor, action, target, permission, reauth }, work)` is the one entry point for admin mutations:

1. Authorisation and re-authentication are checked first. A refusal writes a `REFUSED` audit row in its **own** transaction and throws `ForbiddenError`; nothing else runs.
2. `work(tx)` runs inside one database transaction that ends with the `SUCCESS` audit row — the change and its record commit together or not at all.
3. If `work` throws, the transaction has rolled back; `runAudited` then writes a `FAILED` row in a **separate** transaction (action, target, `errorCode`, hashed IP — never the message, stack, or input) and rethrows. A reviewer therefore sees refused and failed attempts as well as successes.
4. Snapshots (`before`/`after`) go through a redactor with an allow-list per target type: amounts, statuses, ids, slugs, quantities, carrier and tracking; never tokens, hashes, secrets, raw webhook payloads, card or bank fields, or full contact details (emails and phones are stored masked). The audit insert failing is a failure of the whole operation by design.

**Global lock order** extends checkout.md §5.5: `carts → orders → payments/refunds → inventory (ascending variant id) → reservations`; catalogue writes lock `products → product_variants → inventory`; role changes take an **advisory transaction lock** (`pg_advisory_xact_lock(hashtext('user-roles'))`) before locking the target `users` row, so concurrent promotions and demotions serialise and the last-admin check is exact; two-factor changes lock the `staff_two_factor` row. No transaction calls the provider, Cloudinary or email; those calls happen before (evidence, signatures) or after (best-effort deletes).

| ID  | Transaction                            | Locks (in order)                                        | Writes                                                                                                                                                       | Outside                                                                                          |
| --- | -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| A1  | Product / variant / category save      | product (and variants)                                  | row updates, slug/SKU uniqueness by index, SUCCESS audit                                                                                                     | —                                                                                                |
| A2  | Image attach / remove                  | product                                                 | `product_images` row, positions, SUCCESS audit                                                                                                               | signature issue (before), response verification (before), Cloudinary delete (after, best effort) |
| A3  | Inventory adjustment                   | inventory row (`FOR UPDATE`)                            | conditional update, `inventory_adjustments` (before/after/reserved/reason/actor), SUCCESS audit                                                              | —                                                                                                |
| A4  | Start processing / ship / deliver      | order                                                   | status, `shipments`, event, outbox, SUCCESS audit                                                                                                            | —                                                                                                |
| A5  | Admin cancel                           | order → refunds → inventory (asc) → reservations        | release or restock (+ adjustments), refund intent, status, event, outbox, SUCCESS audit                                                                      | —                                                                                                |
| A6  | Review: attach payment                 | (none during fetch) then as checkout T5                 | `applyCapture` + SUCCESS audit with the fetched payment (redacted) as evidence                                                                               | `gateway.fetchPayment`                                                                           |
| A7  | Review: accept mismatch                | order → payments → inventory → reservations             | consume holds, `CONFIRMED`, cart, outbox, event, SUCCESS audit                                                                                               | —                                                                                                |
| A8  | Refund create / retry / external       | order → refund                                          | `refunds` row insert or reset, SUCCESS audit                                                                                                                 | `listRefunds` verification for "external"                                                        |
| A9  | COD collected / refused / reversed     | order → payment (→ inventory, reservations for refused) | `applyCodEvent`, event, adjustments when refused, SUCCESS audit                                                                                              | —                                                                                                |
| A10 | Queue retry / discard                  | the queue row                                           | status/attempt reset, SUCCESS audit                                                                                                                          | —                                                                                                |
| A11 | Role change                            | advisory `user-roles` → user → sessions                 | `role`; delete sessions and staff verifications; SUCCESS audit; owner notice outbox                                                                          | —                                                                                                |
| A12 | Run job now                            | —                                                       | SUCCESS audit before and after (two rows)                                                                                                                    | `runJob(name)`                                                                                   |
| A13 | Second-factor enrol / verify / re-auth | `staff_two_factor` row (`FOR UPDATE`)                   | secret ciphertext, `enabledAt`, `lastAcceptedStep`, recovery code `usedAt`, `staff_session_verifications`; audit rows for enrol, verify, recovery use, reset | —                                                                                                |
| A14 | PII reveal                             | —                                                       | SUCCESS audit only (the reveal is a read)                                                                                                                    | —                                                                                                |
| A15 | Promote script                         | advisory `user-roles` → user → sessions                 | `role = ADMIN`, sessions deleted, audit with `actorLabel = script:promote-admin@<host>`                                                                      | —                                                                                                |

Every transaction re-reads status under its lock and applies a transition from the pure tables; refusals are audited `REFUSED`, exceptions `FAILED`.

---

## 7. Security risks and controls

| Risk                                              | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff session without a second factor             | `requireStaffSession` demands a verification row for the current session; no flag on the user can substitute. Enrolment counts only after a code verifies. Covered by tests that use a valid STAFF session with no verification.                                                                                                                                                                                                                                            |
| TOTP replay or brute force                        | Accepted step recorded per user; codes from the same or an earlier step refused; 5 attempts per 15 minutes per user, 20 per IP; recovery codes single-use, hashed, 3 attempts per hour; alerts on recovery use and repeated failures.                                                                                                                                                                                                                                       |
| TOTP secret exposure                              | AES-256-GCM under `ADMIN_TOTP_KEY` with key versioning; redactors drop ciphertext and codes from audits; the key is never in logs or snapshots; QR shown once at enrolment.                                                                                                                                                                                                                                                                                                 |
| Stolen staff session                              | Sensitive operations need a fresh code within the re-auth window; the security page lists sessions; password change revokes the others (Phase 4); role change and 2FA reset revoke everything; `Cache-Control: private, no-store` on admin responses.                                                                                                                                                                                                                       |
| Privilege escalation                              | `role` never from input; `setRole` ADMIN-only, re-auth, cannot target self, cannot remove the last ADMIN (advisory lock + trigger); sessions revoked in the same transaction; audited; `proxy.ts` optimistic only; Better Auth's `admin` plugin not used (no impersonation, role authority stays in our data layer).                                                                                                                                                        |
| Routable Server Actions bypassing the layout gate | Every action begins with `runAudited` → `requirePermission`; data functions take the verified staff user; tests call actions with no session, a CUSTOMER session, a STAFF session without verification, and a STAFF session for ADMIN-only actions.                                                                                                                                                                                                                         |
| Manual "mark paid"                                | Does not exist. Online confirmation needs a `CAPTURED` attempt fetched from the provider or already recorded; COD collection is an explicit, amount-checked, audited payment transition (§5.10). Payment and fulfilment states are separate machines.                                                                                                                                                                                                                       |
| Refund abuse                                      | ADMIN with re-auth; amount bounded by captured − refunded; executed by the Phase 6 queue with provider references; reason required; owner emailed; rate-limited per actor.                                                                                                                                                                                                                                                                                                  |
| Destructive actions by mistake                    | Confirmation pages with reason and typed order number / product slug; archive instead of delete; deletes only when nothing references the row; re-auth for the irreversible ones.                                                                                                                                                                                                                                                                                           |
| Stock corruption                                  | Adjustments lock the row and are refused below `reserved`; every adjustment records before/after/reserved/reason/actor (CHECK-enforced); `reserved` is never edited; sales stay in the Phase 6 service.                                                                                                                                                                                                                                                                     |
| PII exposure to staff                             | Customer lists and details masked for STAFF; reveal is a permission-controlled, reasoned, time-boxed, audited action; order addresses visible to STAFF only while an order is being fulfilled; webhook payloads and outbox recipients masked; audit snapshots redacted; request IPs hashed; exports ADMIN with re-auth and audited.                                                                                                                                         |
| Audit tampering or loss                           | Append-only table with an immutability trigger; SUCCESS rows commit with the change; REFUSED/FAILED rows written after rollback in their own transaction; no secrets or free-text error messages stored; retention indefinite (money records).                                                                                                                                                                                                                              |
| Upload abuse                                      | Signatures only for staff with `catalogue.images`, bound to a fixed folder, server-generated `public_id`, `resource_type=image`, `allowed_formats`, an incoming `c_limit` transformation and a signed upload preset enforcing size and dimension caps at Cloudinary; the upload response's own signature is verified and its `format`, `bytes`, `width`, `height`, `folder` and `resource_type` are checked against `adminPolicy.uploads` before anything is stored (§5.2). |
| CSRF                                              | Server Actions (origin-checked); the CSV export route is GET with no side effects.                                                                                                                                                                                                                                                                                                                                                                                          |
| Promote script misuse                             | Local DB or explicit production confirmation, verified email required, typed confirmation, audit row, sessions revoked, no HTTP exposure (§13).                                                                                                                                                                                                                                                                                                                             |
| Enum migration                                    | `ALTER TYPE … ADD VALUE` cannot run inside a transaction with other statements that use the value; the migration adds values in their own statements first (Prisma emits them separately).                                                                                                                                                                                                                                                                                  |

### 7.1 Failure scenarios

| #   | Scenario                                                     | Handling                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Staff member loses the authenticator                         | Recovery code (single use) → sign in → regenerate secret and codes. Codes also lost → an ADMIN resets their 2FA (re-auth, audited); the last ADMIN with no access → the promote script on another account (§13).   |
| 2   | Two ADMINs demote each other at the same moment              | Advisory lock serialises; the second sees one ADMIN left and is refused; the trigger refuses any path that slips through.                                                                                          |
| 3   | A request with a revoked session is in flight                | Sessions are read from the database on every request; the next request after revocation fails `requireStaffSession`; nothing cached grants access.                                                                 |
| 4   | Clock drift between authenticator and server                 | ±1 step tolerance; the accepted step still advances so a drifted code cannot be replayed.                                                                                                                          |
| 5   | `ADMIN_TOTP_KEY` rotated                                     | Old ciphertexts decrypt with the previous key by `keyVersion` and are re-encrypted on the next successful verification; a missing key refuses staff sign-in with a clear server-side error (customers unaffected). |
| 6   | Business transaction fails after the operator confirmed      | Rolled back; a `FAILED` audit row records the attempt; the page shows the typed error; nothing partial persists.                                                                                                   |
| 7   | Audit insert fails inside the transaction                    | The whole operation fails; the operator retries; alert via the server log (Phase 10 monitoring).                                                                                                                   |
| 8   | Cloudinary upload succeeded but attach was refused or failed | The asset is orphaned at Cloudinary; a daily `cleanup` step lists assets in the folder not referenced by `product_images` and deletes those older than a day (best effort, audited as a system action).            |
| 9   | Upload response tampered by the browser                      | Response signature check fails → refused; dimensions/bytes/format outside policy → refused; nothing stored.                                                                                                        |
| 10  | COD collected recorded by mistake                            | ADMIN `cod_collection_reversed` with reason; both transitions audited; revenue reports follow the current state.                                                                                                   |
| 11  | Refund retried twice by two admins                           | Reset is idempotent on a `FAILED` row; the worker claims with `SKIP LOCKED`; the provider reference prevents a second refund (Phase 6).                                                                            |
| 12  | Re-auth code accepted but the original form was lost         | By design: re-auth never replays the original request; the operator submits it again within the window.                                                                                                            |
| 13  | Inventory adjustment races a checkout                        | Both lock the inventory row; the adjustment is checked against the current `reserved` under the lock; the checkout's conditional update sees the new stock.                                                        |
| 14  | Promote script run against the wrong database                | Production requires `ADMIN_PROMOTE_CONFIRM=<email>` matching the argument and prints the database host for confirmation; a local URL needs no confirmation.                                                        |

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
| Record COD refused; reverse a COD collection       | ✓ / — | ✓ / ✓ |
| Reveal customer contact details                    | grant |   ✓   |
| Reset another staff member's two-factor            |       |   ✓   |
| Reports                                            |   ✓   |   ✓   |
| CSV export, audit log browser                      |       |   ✓   |

Encoded once in `features/admin/authz.ts` as a pure map and unit-tested; capabilities marked sensitive carry `reauth: true` (refunds, attach payment, accept mismatch, cancel confirmed orders, role changes, two-factor resets, run now, discard, hard delete, exports, reveal grants). `requirePermission` throws `ForbiddenError` and `runAudited` writes a REFUSED audit row in its own transaction.

---

## 10. Emails

New outbox kinds rendered by the existing templates module: `order.processing` (optional, off by default), `order.shipped` (carrier, tracking link), `order.delivered`, `order.cancelled` (reason "shop", refund note when applicable), `refund.processed` (amount, reference). Owner notices: `ops.refund_created`, `ops.role_changed`.

---

## 11. Tests

| Level                       | What is proven                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**                    | permission matrix (every capability × role, `reauth` flags); fulfilment and COD transitions (allowed and forbidden edges, including `cod_collected` only from `CREATED` on COD attempts); TOTP against RFC 6238 Appendix B vectors, ±1 step window, step comparison for replay; secret encryption round-trip and key-version fallback; recovery-code generation and hashing; redactors (every target type drops secrets and masks contact fields); masking helpers; slug generation; rupee→paise parsing; adjustment arithmetic against reserved; Cloudinary signature construction and response-signature verification with known vectors; upload policy checks (format, bytes, dimensions, folder); report SQL builders (parameters, no interpolation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Integration**             | **Gate:** CUSTOMER, anonymous, STAFF-without-verification and STAFF-for-ADMIN-only callers are refused by every admin action and a `REFUSED` audit row exists afterwards; an unverified enrolment never satisfies the gate. **Audit atomicity:** a forced failure inside `work` leaves no business change and one `FAILED` row; a success leaves the change and one `SUCCESS` row in the same transaction (checked by reading inside the transaction and after). **2FA:** enrol → verify → session verification row; same code replayed → refused; earlier-step code → refused; recovery code once; reset by ADMIN clears everything; rate limits trip and lapse. **Re-auth:** a sensitive action with a stale `verifiedAt` redirects; a fresh verification allows it. **Orders:** processing/ship/deliver with shipments and emails; cancel of CONFIRMED restocks with adjustments recording before/after/reserved and queues a refund that `refund-payments` executes; cancel of PENDING releases; COD collected only on DELIVERED/SHIPPED with the exact amount, refused otherwise, reversed by ADMIN; COD refused cancels and restocks. **Review:** attach payment via the fake gateway (captured / uncaptured / wrong order / mismatch), accept mismatch requires a captured attempt, cancel-and-refund; partial refund bounds; external refund verified via `listRefunds`. **Operations:** outbox retry resets and the worker sends; webhook re-apply idempotent; refund retry; run-now writes two audit rows. **Customers:** STAFF reads are masked, reveal is audited and time-boxed, STAFF cannot reveal without the grant; role change revokes sessions and verifications, refuses self and the last ADMIN, and serialises under `Promise.all` (two concurrent demotions → exactly one succeeds); the trigger refuses a direct SQL demotion of the last ADMIN. **Catalogue/inventory:** publish rules; variant delete refused with order items; adjustment refused below holds and recorded with quantities; CHECKs for adjustments, shipments, audit immutability trigger. **Reports** match hand-computed fixtures; CSV export shape. **Promote script:** promotes a verified account, refuses unverified/unknown/already-admin, writes the script audit row, refuses production without confirmation. Migration 7 CHECKs, triggers and `rollback.sql`. |
| **E2E** (admin user seeded) | CUSTOMER is refused at `/admin` and by a direct action; a seeded STAFF account signs in, is sent to enrolment, scans/enters the secret (the test derives codes with the same RFC 6238 code), verifies, sees recovery codes once, then reaches the overview; a second browser context for the same account must verify again; a replayed code is refused; a sensitive action after the window prompts for re-auth; overview renders real counts; create product → variant → image by URL → publish → visible in the storefront; adjust stock with reason → storefront availability changes; customer order → start processing → ship (email via outbox job) → deliver → COD collected with amount; NEEDS_REVIEW order (fake mismatch) → re-check → attach payment → confirmed; failed outbox row → retry → sent; customer page masked for STAFF, reveal audited for ADMIN; role change by ADMIN; axe and keyboard on every admin page; mobile drawer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **CI**                      | `SEED_ADMIN_PASSWORD` and `ADMIN_TOTP_KEY` throwaway values so the seed creates the dev admin and staff sign-in works; fake Cloudinary path (uploads by URL in e2e; signature code unit-tested with vectors); `npm audit` unchanged (no new runtime dependency)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

---

## 12. Implementation sequence

1. **Foundation and the gate:** migration 7 + rollback; `admin-policy.ts`; `authz.ts` with `reauth` flags; `runAudited` + redactors; TOTP module, enrolment, verification, recovery codes, re-auth page; `requireStaffSession`; admin shell, layout gate, proxy matcher; promote script and dev-seed admin; transitions extended (fulfilment, COD events). Tests, including the gate matrix and audit atomicity.
2. **Orders and fulfilment:** list/detail with masking rules, processing/ship/deliver, notes, admin cancel with restock adjustments and refund intent, COD collected/refused/reversed, emails. Tests.
3. **Payments and refunds:** review queue and investigation, attach/accept/cancel-and-refund, refunds (create, retry, external), refund operations page. Tests.
4. **Operations monitoring:** jobs, outbox, webhooks, alerts; retries and run-now. Tests.
5. **Catalogue and inventory:** products, options/variants, images with hardened signed uploads, categories; inventory levels and adjustments. Tests.
6. **Customers and reports:** masked lists and detail, reveal, role change, 2FA reset; report queries and CSV export. Tests.
7. **E2E, docs (admin.md §16, roadmap, data-model, auth.md, architecture, CLAUDE.md), gates, commit.**

The second factor is part of step 1 because nothing in the admin area is reachable without it. Each step ends with green gates and a commit; steps 2–3 are front-loaded because they touch money.

---

## 13. Operational requirements before production

These are needed regardless of Phase 7 and are documented here because the admin pages are where their effects become visible.

| Requirement                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cron frequency**               | `vercel.json` schedules `expire-reservations`, `recover-payments`, `process-webhooks`, `send-notifications` every 5 minutes, `reconcile-payments` and `refund-payments` every 15 minutes, `cleanup` daily. Vercel Hobby runs crons **once a day**, which would delay reservation release, emails and refunds by up to a day. Production needs **Vercel Pro** or an external scheduler (e.g. a monitored HTTP pinger) calling `/api/cron/<job>` with `Authorization: Bearer $CRON_SECRET` on those intervals. Decide in Phase 11 (D4/D11); the Operations page shows the last claim time per queue so a stalled scheduler is obvious.                                                                                                          |
| **Payment reconciliation**       | `reconcile-payments` must run at least every 15 minutes: it confirms captures whose webhook and callback were both missed. Alert when any `PENDING_PAYMENT` order with a `CREATED`/`AUTHORIZED` attempt is older than 30 minutes (Operations page + `ops.alert` in Phase 7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Refund recovery**              | `refund-payments` must run at least every 15 minutes; a refund `FAILED` after the policy's attempts sends an `ops.alert` and stays listed until an ADMIN retries it or records an external refund. Razorpay refunds take 5–7 working days; "REQUESTED" rows are polled until `processed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Webhook secret and events**    | Dashboard: webhook URL `https://<domain>/api/webhooks/razorpay`, secret in `RAZORPAY_WEBHOOK_SECRET`, events `payment.captured`, `payment.failed`, `payment.authorized`, `order.paid`, `refund.processed`; rotate with `RAZORPAY_WEBHOOK_SECRET_PREVIOUS` for an overlap window. Auto-capture enabled.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Alert inbox**                  | `ORDER_NOTIFY_EMAIL` set to a monitored mailbox; `ops.alert` emails are the only signal for FAILED rows until Phase 10 monitoring.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Razorpay test-mode smoke**     | Still outstanding from Phase 6: run checkout.md §15 on a preview deployment with test keys before going live.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **First admin (promote script)** | `npm run admin:promote -- <email>` runs only from a shell with database access, never over HTTP. Safeguards: the account must exist with a verified email; the script prints the database host and the account and requires the email typed back (or `--yes` in CI); when `SITE_ENV=production` or the database host is not local it also requires `ADMIN_PROMOTE_CONFIRM=<same email>` in the environment for that one invocation; it takes the `user-roles` advisory lock, sets `ADMIN`, deletes the user's sessions so the next sign-in enrols the second factor, writes an audit row with `actorLabel = script:promote-admin@<hostname>`, and is a no-op (logged) if the account is already ADMIN. Demotion is not offered by the script. |
| **Second-factor key**            | `ADMIN_TOTP_KEY` (32 random bytes) set before the first staff sign-in; rotate with `ADMIN_TOTP_KEY_PREVIOUS`; keep recovery codes offline; an ADMIN can reset a colleague's second factor, and the promote script is the recovery path for a lost last ADMIN.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Backups**                      | Orders, payments and the audit log are the records of money; point-in-time recovery on the hosted database (Phase 11, D4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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
10. No staff session reaches an admin page or action without a second-factor verification row for that session; replayed codes are refused; sensitive operations require a fresh code; all proven by tests.
11. Every refused or failed admin operation leaves an audit row even though its business transaction rolled back, and no audit row contains a secret, token, raw payload or unmasked contact detail; proven by tests and a redactor unit suite.
12. STAFF see masked customer data by default; every reveal is audited; proven by tests.
13. Every inventory adjustment row carries kind, reason, actor (or order for system restocks), and before/after quantities consistent with its delta, enforced by CHECKs.
