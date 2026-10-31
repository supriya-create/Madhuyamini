# Madhuyamini — Architecture

Status: **Approved 31 Oct 2026** (D1 decided: route groups; D3 decided: Better Auth). Phases 1–4 are implemented; see [roadmap.md](roadmap.md), [data-model.md](data-model.md) and [auth.md](auth.md).

Companion documents: [roadmap.md](roadmap.md) (phases and the Phase 1 checklist) and [design-system.md](design-system.md).

---

## 1. Starting state (31 Oct 2026, before Phase 1)

| Item            | Finding                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Source code     | None. The project folder was empty: no `package.json`, no `src/`, no config.                                      |
| Version control | Not a git repository. No remote.                                                                                  |
| Roadmap         | No roadmap file existed; the 11-phase roadmap from the project brief is now recorded in [roadmap.md](roadmap.md). |
| Brand assets    | None in the repository (logo, photography, artist material).                                                      |
| Local toolchain | Node 22.23.2, npm 10.9.8, Git 2.50.1, PostgreSQL 18.3 (Homebrew; installed, service not running). No Docker.      |
| Current phase   | Phase 1, not started (now implemented).                                                                           |

There is no existing code to preserve.

---

## 2. Stack and version policy

I checked the npm registry on 31 Oct 2026. Exact versions will be locked in `package-lock.json`. Each dependency is added in the phase that first needs it, not up front.

| Concern                    | Choice                               | Version                            | Notes                                                                                                                                                                            |
| -------------------------- | ------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                    | Node.js LTS                          | 24.x on Vercel; ≥ 22.12 locally    | Node 22 leaves maintenance in April 2027. Standardise on 24 before launch.                                                                                                       |
| Framework                  | Next.js App Router                   | 16.4.x                             | Turbopack by default. `proxy.ts` replaces `middleware.ts`. `cookies()`, `headers()` and `params` are async. `next lint` is gone, so scripts call ESLint directly.                |
| UI                         | React                                | 19.x (as required by Next)         |                                                                                                                                                                                  |
| Language                   | TypeScript                           | **5.9.x, pinned**                  | npm `latest` is 7.0.2, but `typescript-eslint` 8.72 only supports TS < 6.1. Revisit when the lint toolchain supports TS 7.                                                       |
| ORM                        | Prisma + `@prisma/adapter-pg` + `pg` | **7.10.x, pinned**; `pg` < 9       | npm's `latest` tag currently points to `8.0.0-rc.29`, a release candidate, so a bare `npm i prisma` would install it. Prisma 7 requires `prisma.config.ts` and a driver adapter. |
| Database                   | PostgreSQL                           | Match hosted major version locally | See D4.                                                                                                                                                                          |
| Validation                 | Zod                                  | 4.x                                |                                                                                                                                                                                  |
| Unit and integration tests | Vitest                               | 5.x                                | Requires Node ≥ 22.12.                                                                                                                                                           |
| End-to-end tests           | Playwright + `@axe-core/playwright`  | 1.64.x / 4.14.x                    | axe runs automated WCAG checks inside e2e tests.                                                                                                                                 |
| Icons                      | `lucide-react`                       | 1.x                                | Per-icon imports (tree-shaken).                                                                                                                                                  |
| Client state               | Zustand                              | 5.x                                | Added only when cross-component client state appears (cart drawer, Phase 5).                                                                                                     |
| Payments                   | `razorpay` Node SDK                  | 2.9.x                              | Server-only.                                                                                                                                                                     |
| Email                      | Resend                               | 6.x                                | Needs a verified sending domain (SPF/DKIM).                                                                                                                                      |
| Password hashing           | `@node-rs/argon2`                    | 2.x                                | Argon2id. Only if we own authentication (D3).                                                                                                                                    |
| Images                     | Cloudinary                           | n/a                                | Served through a custom `next/image` loader that builds transformation URLs (`f_auto,q_auto,w_…`). No client SDK and no double optimisation through Vercel.                      |

**Lint toolchain:** ESLint stays on 9.39.x. Next's lint plugins (react, import, jsx-a11y) don't declare ESLint 10 support yet.

**Deliberately not added:** Tailwind, UI kits, CSS-in-JS, axios (we use `fetch`), lodash, moment/dayjs (we use `Intl`), React Testing Library (added only if component-level tests become necessary).

---

## 3. Folder structure

```
madhuyamini/
├── .github/workflows/ci.yml        # typecheck · lint · unit · build · e2e
├── docs/                           # roadmap, architecture, design system, ADRs, business rules
├── e2e/                            # Playwright specs, axe checks, pending-routes.ts (links to unbuilt routes)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/                 # generated SQL + hand-written CHECK constraints
│   ├── seed.ts                     # entry: env, guard, client
│   └── seed/                       # guard.ts · fixtures.ts · catalog.ts (idempotent upserts)
├── prisma.config.ts                # Prisma 7 CLI config (loads .env.local)
├── public/                         # favicon, logo SVG, static brand assets
├── src/
│   ├── app/
│   │   ├── layout.tsx              # <html lang="en-IN">, fonts, global CSS; no site chrome
│   │   ├── not-found.tsx · global-error.tsx · robots.ts · icon.svg · sitemap.ts (Phase 3)
│   │   ├── design-system/          # development-only specimen page (404 in production)
│   │   ├── (storefront)/           # route group: does not appear in URLs
│   │   │   ├── layout.tsx          # announcement bar, header, footer
│   │   │   ├── page.tsx            # homepage "/"  (see D1)
│   │   │   ├── error.tsx
│   │   │   ├── collections/        # index + [slug] listing (filters, sort, pagination) + loading
│   │   │   ├── products/[slug]/    # product detail + loading
│   │   │   ├── search/             # full-text search + loading
│   │   │   ├── login/ · register/ · reset-password/   # Phase 4
│   │   │   ├── account/            # Phase 4, session-guarded
│   │   │   ├── cart/ · checkout/   # Phases 5–6
│   │   │   ├── orders/track/       # Phase 6, guest order lookup
│   │   │   └── (content)/          # about, artists, care guide, policies (Phase 9)
│   │   ├── admin/                  # Phase 7: own layout, role checked on every request
│   │   └── api/
│   │       ├── webhooks/razorpay/route.ts   # raw-body signature verification
│   │       └── cron/                        # reservation expiry, payment reconciliation
│   ├── components/
│   │   ├── catalog/                # ProductCard, ProductGrid, ListingControls, VariantSelector, gallery, states …
│   │   ├── ui/                     # design-system primitives: Button, Container, Section, Eyebrow, Icon …
│   │   ├── layout/                 # AnnouncementBar, Header, DesktopNav, MobileNav, Footer, SkipLink
│   │   ├── home/                   # homepage sections
│   │   └── motifs/                 # geometric Madhubani borders and dividers (SVG)
│   ├── features/                   # one folder per business domain, added as phases land
│   │   └── <domain>/               # catalog, cart, checkout, orders, payments, auth, admin …
│   │       ├── schemas.ts          # Zod input schemas + inferred types (safe to import on the client)
│   │       ├── rules.ts            # pure business logic: unit-tested, no I/O
│   │       ├── data.ts             # Prisma queries (server-only)
│   │       ├── service.ts          # authorisation, transactions, orchestration (server-only)
│   │       ├── actions.ts          # 'use server' adapters: parse → service → typed result
│   │       └── components/
│   ├── server/                     # server-only infrastructure
│   │   ├── auth/                   # auth.ts (Better Auth) · current-user.ts (DAL) · password-policy · rate-limit
│   │   ├── email/                  # transports (file · log · Resend) · templates
│   │   ├── env.ts · env-schema.ts  # Zod-validated environment; fails fast
│   │   ├── db.ts                   # Prisma client singleton (server-only)
│   │   ├── prisma-client.ts        # client factory shared by db.ts, seed and tests
│   │   ├── errors.ts               # AppError → safe user-facing messages
│   │   └── log.ts                  # structured logging with PII redaction
│   ├── content/                    # editorial copy, navigation taxonomy, site config (nullable brand data)
│   ├── generated/prisma/           # Prisma client output (git-ignored; `prisma generate`)
│   ├── lib/                        # isomorphic pure helpers: money (paise ↔ ₹), routes, cx, validation, image-loader
│   ├── styles/                     # reset.css · tokens.css · globals.css · fonts.ts
│   └── proxy.ts                    # /account/* cookie-presence redirect only; never the sole check
├── tests/
│   ├── integration/                # Vitest against a real PostgreSQL test database (name must end in _test)
│   └── stubs/server-only.ts        # replaces `server-only` under Vitest
├── .env.example                    # every variable name, no values
├── CLAUDE.md                       # non-negotiable engineering rules for every contributor session
└── next.config.ts · tsconfig.json · eslint.config.mjs · vitest.config.ts · playwright.config.ts
```

Unit tests sit next to the code they test (`rules.test.ts`). Integration tests live in `tests/integration/`. End-to-end tests live in `e2e/`.

### Layering rules

| Layer        | Location                                           | Responsibility                                                                                                      | Must not                                                        |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| UI           | `app/**`, `components/**`, `features/*/components` | Rendering. Server Components by default.                                                                            | Import Prisma, `server/env`, or secrets into client components. |
| Entry points | `features/*/actions.ts`, `app/api/**/route.ts`     | Parse input with Zod, call one service, map the result.                                                             | Contain business logic.                                         |
| Services     | `features/*/service.ts`                            | Authorisation, transactions, orchestration.                                                                         | Trust any caller to have checked permissions.                   |
| Rules        | `features/*/rules.ts`                              | Prices, discounts, tax, state transitions.                                                                          | Perform I/O. Kept pure so it is cheap to test exhaustively.     |
| Data access  | `features/*/data.ts`                               | Prisma queries with explicit `select`. Ownership in the signature, e.g. `getOrderForCustomer(orderId, customerId)`. | Return unbounded lists.                                         |

Every server-only module begins with `import 'server-only'`, so an accidental client import fails the build instead of leaking code or secrets.

---

## 4. Routing and layouts (decision D1)

The storefront and the admin need different chrome. Header and footer belong to a layout, and admin pages must not ship storefront JavaScript and CSS.

**Decided (31 Oct 2026):** the root `layout.tsx` holds only `<html>`, `<body>`, fonts and global CSS. The storefront chrome lives in `src/app/(storefront)/layout.tsx`, and `admin/` has its own layout.

The trade-off is that the homepage file moves from `src/app/page.tsx` to `src/app/(storefront)/page.tsx`. The URL stays `/`.

**Alternative:** keep `src/app/page.tsx` and render the header and footer in the root layout. The admin area would then inherit storefront chrome and need fragile hiding logic. I don't recommend this.

The brief asked to keep the initial homepage in `src/app/page.tsx`. The owner approved the route-group layout instead. The root `not-found.tsx` renders outside the group, so it reuses the storefront chrome through `StorefrontShell`.

---

## 5. Cross-cutting concerns

### 5.1 Security

- **Every Server Action and Route Handler is a public HTTP endpoint.** Each one validates input with a strict Zod schema (unknown keys rejected), then authenticates and authorises inside the service, not in the page.
- **Authorisation never lives only in `proxy.ts`/middleware.** CVE-2025-29927 showed that middleware checks can be bypassed. The data layer enforces ownership.
- **The client sends intents only:** variant ID, quantity, coupon code. Price, discount, tax, shipping and stock are computed on the server inside the order transaction.
- **No mass assignment.** Fields are mapped explicitly into Prisma `data`. Roles, prices and stock are never accepted from request input.
- **Secrets** are read only through `server/env.ts`. The only planned public variable is the Razorpay key ID.
- **Errors:** `AppError` carries a safe message for users. Stack traces and database errors are logged on the server only. Logs redact passwords, tokens, OTPs, full addresses and phone numbers.
- **Baseline headers (Phase 1):** `Strict-Transport-Security` (production), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, a restrictive `Permissions-Policy`, and `poweredByHeader: false`. The full Content-Security-Policy comes in Phase 10 (D8).
- **Authentication (Phase 4):**
  - Passwords hashed with Argon2id.
  - Session tokens are 256-bit random values, stored only as SHA-256 hashes.
  - Session cookie is `HttpOnly; Secure; SameSite=Lax`.
  - Sessions rotate on login and privilege change, have idle and absolute expiry, and are all revoked on password change.
  - Password-reset tokens are hashed, single-use and expire after 30 minutes.
  - Login and reset responses are identical whether or not an account exists, so they don't reveal which emails are registered.
  - Rate limiting applies per IP and per account.
  - Recommended addition: TOTP two-factor authentication for admin accounts.
- **Payments (Phase 6):**
  - Razorpay orders are created on the server.
  - `order_id|payment_id` signatures are verified with HMAC-SHA256 using a constant-time comparison.
  - Webhook HMACs are computed over the raw request body, and events are stored by Razorpay event ID so each is processed exactly once.
  - A reconciliation job resolves orders stuck in pending.
  - Refunds are admin-only and recorded in the audit log.
  - No card or UPI data is ever stored.
- **Supply chain:** committed lockfile, `npm ci` in CI, an `npm audit --omit=dev` gate, and automated dependency update PRs.
- **Privacy:** the DPDP Act 2023 and its Rules require minimum collection, a clear privacy notice, recorded consent for marketing email, a retention policy, and a way for customers to export or delete their data. This is not legal advice; confirm the obligations with counsel.

### 5.2 Performance

- Server Components by default. Client components only for the mobile navigation dialog, desktop navigation disclosures, cart count and drawer, variant picker, image gallery, and forms with live validation.
- Catalog pages (home, collections, products) are cached and invalidated by tag when an admin edits them. Next 16 Cache Components will be evaluated in Phase 3. **Checkout re-reads price and stock from the database.** A cached page is never trusted for money or inventory.
- **Never cached:** cart, checkout, account, orders, admin, stock reservations.
- **Images:** Cloudinary `f_auto,q_auto` with explicit `sizes`. Only the LCP image is preloaded; everything else is lazy-loaded.
- **Fonts:** two families via `next/font` (self-hosted at build time, no runtime requests to Google), limited weights, `display: swap`.
- **Database:**
  - Vercel functions and the database co-located in Mumbai (Vercel `bom1`), with a pooled connection string for serverless.
  - Indexes on slugs, foreign keys and `(status, created_at)`.
  - Cursor pagination, explicit `select`, and batched queries instead of N+1 loops.
- **Budgets (p75, mobile):** LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. First-load JavaScript per route is tracked in CI, and regressions are investigated.

### 5.3 Accessibility (WCAG 2.2 AA)

- Landmarks, one `h1` per page, logical heading order, and a skip link.
- Visible focus: a 2 px outline with offset. The sticky header must never hide the focused element, so `scroll-padding-top` matches the header height (2.4.11 Focus Not Obscured).
- Interactive targets are at least 24 × 24 px (2.5.8). Primary controls use 44 px.
- Desktop navigation uses the **disclosure** pattern (buttons with `aria-expanded`), not ARIA `menu`. Mobile navigation uses the native `<dialog>` element for focus containment, Escape to close, and focus return.
- No auto-rotating carousels and no autoplaying media with sound. `prefers-reduced-motion` is honoured.
- **Forms:**
  - Visible labels, correct `autocomplete` tokens, and inline errors linked with `aria-describedby`.
  - An error summary on submit. Errors are never signalled by colour alone.
  - Checkout never asks for the same information twice ("billing same as shipping", 3.3.7 Redundant Entry).
  - Login allows paste and password managers, with no puzzle CAPTCHA (3.3.8 Accessible Authentication).
- Cart updates and stock messages are announced through a polite live region. Stock status is always written as text.
- Prices use `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`, which gives Indian digit grouping (₹1,49,999).
- Content reflows at 320 px without horizontal scrolling and stays usable at 200 % text zoom.
- Alt text describes the piece (artwork subject, garment, motif). Decorative ornaments are `aria-hidden`.
- **Testing:** axe runs in every Playwright test. Each phase also gets a manual keyboard pass and a VoiceOver pass of its key journeys.

---

## 6. Data model

Implemented in Phase 2. The authoritative description, including every constraint and the deletion rules, is [data-model.md](data-model.md). The preview below is kept for the reasoning behind it.

### Original preview

The brief's entities are User, Address, Category, Product, ProductImage, ProductVariant, Inventory, Cart, CartItem, Wishlist, Order, OrderItem, Payment, Coupon, Review, Shipment, ReturnRequest and CustomRequest. I propose these additions, each with a concrete reason:

| Addition               | Why                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| `Session`              | Database-backed sessions that can be revoked (stolen session, password change, staff leaving). |
| `VerificationToken`    | Email verification and password reset: hashed, single-use, expiring.                           |
| `WebhookEvent`         | A unique Razorpay event ID makes webhook processing idempotent.                                |
| `InventoryReservation` | Holds stock while an online payment is pending (if D6 = reserve at checkout).                  |
| `AuditLog`             | Records who changed a price, stock level, order status or refund, and when.                    |
| `NewsletterSubscriber` | Email plus consent timestamp and source (DPDP).                                                |

Core rules the schema will enforce:

- **Money** is stored as integer paise. A Postgres `integer` holds up to about ₹2.14 crore per value, which is ample for prices and order totals. Reports aggregate as `bigint`.
- **Stock decrement** is one conditional statement inside the order transaction: `UPDATE … SET stock = stock - $n WHERE id = $id AND stock >= $n`. If zero rows change, the item is out of stock and the transaction rolls back. There is never a separate read followed by a write.
- **Database constraints Prisma cannot express** (`CHECK (stock >= 0)`, reserved stock never above stock on hand) are added in SQL migrations.
- **Order items snapshot** the title, variant label, SKU, unit price, tax rate, HSN code and image at the moment of purchase.
- **Explicit state machines** in `rules.ts` for Order, Payment, Shipment and ReturnRequest. Every transition is validated on the server and unit-tested.
- **Idempotency:**
  - Checkout carries a client-generated idempotency key that is unique on Order, so a double submit cannot create two orders.
  - Webhook event IDs are unique on `WebhookEvent`.
- **Public identifiers:**
  - Order numbers are human-readable and non-sequential (for example `MY-K7Q4-29XD`), so they don't reveal sales volume or allow enumeration.
  - Guest orders are opened with order number plus email, or with a signed link sent by email.
- **One-of-a-kind originals** are ordinary variants with stock 1. No special case is needed.
- **Technique attribute:** each product records how it is made (hand-painted, hand-printed, digital print, embroidered…). Listings can then never imply that printed goods are hand-painted (see D7).

---

## 7. Open decisions

| ID      | Decision                              | Needed before    | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1**  | Homepage location and layout split    | **Decided**      | Route groups; homepage at `src/app/(storefront)/page.tsx` (§4).                                                                                                                                                                                                                                                                                                                                                      |
| **D2**  | Brand assets and copy facts           | Phase 1 (during) | You supply the logo, imagery and real brand facts. No stock or AI imagery. Until they arrive, image frames show an obvious development-only placeholder that cannot ship (it fails a test in production mode).                                                                                                                                                                                                       |
| **D3**  | Authentication approach               | Phase 4          | Auth.js v5 is still `5.0.0-beta.32` (July 2026), so I don't recommend it for production. **Email and password only (Google later):** custom database-backed sessions, which the brief already allows and which add the fewest dependencies. **Phone-OTP login wanted:** Better Auth 1.7 (a stack deviation needing your approval) saves substantial work.                                                            |
| **D4**  | Hosted PostgreSQL provider and region | Phase 11 (was 2) | A provider with a **Mumbai** region, co-located with Vercel `bom1`. Confirm region availability for Neon and Supabase when choosing. Match the local PostgreSQL major version to the hosted one.                                                                                                                                                                                                                     |
| **D5**  | Rate-limit store                      | Phase 4          | In-memory limits don't work across serverless instances. Use a Postgres-backed limiter first (no new service). Move to Redis only if load requires it.                                                                                                                                                                                                                                                               |
| **D6**  | Stock reservation for online payments | Phase 6          | Reserve at order creation with a 15-minute expiry. Release on failure or timeout via webhook and cron. Decrement for COD at confirmation.                                                                                                                                                                                                                                                                            |
| **D7**  | Business rules                        | Phases 6–8       | Shipping zones and charges, COD eligibility and limits, returns window and exclusions, GST registration and invoicing, custom-artwork workflow, international shipping. To be documented in `docs/business-rules.md`.                                                                                                                                                                                                |
| **D8**  | Content-Security-Policy strategy      | Phase 10         | Nonce-based CSP forces every page to render dynamically, which defeats catalog caching. Evaluate hash-based CSP (Next SRI) versus a strict CSP without nonces.                                                                                                                                                                                                                                                       |
| **D10** | Catalog caching strategy              | Phase 7/10       | **Decided for now (Phase 3):** catalog pages render dynamically per request (no `cacheComponents`). Next 16's Cache Components are stable but change the rendering model (Suspense boundaries, `<Activity>`-preserved routes); adopt them with tag-based invalidation once admin edits exist (Phase 7) and after measuring (Phase 10). Per-request memoisation via React `cache()` already avoids duplicate queries. |
| **D9**  | Error monitoring                      | Phase 10         | Decide between Vercel's built-in logs and a dedicated error tracker.                                                                                                                                                                                                                                                                                                                                                 |
