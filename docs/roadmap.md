# Madhuyamini — Roadmap

Status: **Phases 1–7 implemented (1 Nov 2026); Phase 8 approved on 2 Nov 2026 and in progress from step 8.0 (not implemented yet).** Brand inputs (D2) and the Razorpay test-mode smoke are still outstanding; the admin dashboard ([admin.md](admin.md), §17 for implementation notes) is built and tested, and its production blockers are listed in admin.md §16.

Related: [architecture.md](architecture.md) · [design-system.md](design-system.md). Decision IDs (D1–D9) refer to architecture.md §7.

| #   | Phase                                       | Status                                                                                                        | Decisions needed first         |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Project setup and homepage foundation       | **Implemented; open items**                                                                                   | D2 (D1 decided)                |
| 2   | Database and backend foundation             | **Implemented; open items**                                                                                   | D4 (deferred to 11)            |
| 3   | Product catalog                             | **Implemented; open items**                                                                                   | D2 (imagery)                   |
| 4   | Authentication and customer accounts        | **Implemented** ([auth.md](auth.md))                                                                          | decided (D3, D5, P1–P5)        |
| 5   | Cart and wishlist                           | **Implemented** ([cart.md](cart.md))                                                                          | decided (C1–C6)                |
| 6   | Checkout and payments (Razorpay + COD)      | **Implemented** ([checkout.md](checkout.md))                                                                  | decided (D6, D7a–c, P6–P12)    |
| 7   | Admin dashboard                             | **Implemented** ([admin.md](admin.md))                                                                        | A1–A13                         |
| 8   | Returns, exchanges and custom artwork       | **Approved; in progress (step 8.0)** ([phase-8-returns-custom-artwork.md](phase-8-returns-custom-artwork.md)) | D8.1–D8.18 approved 2 Nov 2026 |
| 9   | Brand experience and content                | Not started                                                                                                   | D2                             |
| 10  | Testing, security and performance hardening | Not started                                                                                                   | D8, D9                         |
| 11  | Production deployment                       | Not started                                                                                                   | none                           |

### Sequencing notes

- **Data-driven homepage sections wait for real data.** Category collections, best sellers, featured collection, the editorial product showcase, reviews and newsletter signup all need the database or catalog. They are built in Phases 2–3, so the homepage never ships fake products or fake success messages.
- **"Best-selling" is computed, never claimed.** It is only used once it can be calculated from real orders. Until then the section is an admin-curated "Featured" selection.
- **Reviews appear only when real.** Only verified-purchase reviews are shown, and the section is hidden when there are none.
- **Policy pages may need to move earlier.** Razorpay's live-mode activation reviews the website for Contact, Terms, Privacy, Refund/Cancellation and Shipping pages. Those pages (Phase 9) can be pulled ahead of Phase 6 go-live.
- **Phase 1 is a development build, not a public release.** Links into routes from later phases are tracked by a link-check end-to-end test that must pass before launch.

---

## Phase 1 — Project setup and homepage foundation

### Objective

A production-grade foundation (tooling, strict TypeScript, linting, tests, CI, design system) plus an accessible storefront shell and the editorial homepage sections that need no database. Every later phase builds on this, so correctness and conventions matter more than page count.

### In scope

- Repository, tooling and configuration
- Design tokens, fonts and UI primitives
- Root and storefront layouts: announcement bar, header, desktop and mobile navigation, footer
- Error, not-found and robots handling
- Homepage sections: hero, brand introduction, heritage and artist storytelling, craftsmanship and authenticity
- Money formatting utility (the foundation for every price)
- Unit-test, end-to-end and accessibility-test infrastructure, plus CI

### Out of scope

- Database, catalog data, authentication, cart and payments (Phases 2–6)
- Data-driven homepage sections (Phases 2–3)

### Checklist

**1.1 Repository and tooling**

- [x] `git init`, `.gitignore` (including `.env*` except `.env.example`), `.nvmrc` (24), `engines` field
- [x] Scaffold Next.js 16.4: App Router, `src/`, `@/*` alias, ESLint, **no Tailwind**
- [x] Pin TypeScript 5.9.x. Enable `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch`.
- [x] ESLint flat config:
  - Next core-web-vitals and TypeScript presets, plus the full jsx-a11y recommended set
  - Type-aware rules: `no-floating-promises`, `no-misused-promises`, `no-explicit-any` (error), `consistent-type-imports`, `ban-ts-comment`
- [x] Prettier (formatting only)
- [x] npm scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `format`, `format:check`, `test`, `test:e2e`, and `check` (runs every gate)
- [x] `next.config.ts`: baseline security headers, `poweredByHeader: false`
- [x] `src/server/env.ts`: Zod-validated, so startup fails on missing or invalid variables. Add `.env.example`.
- [x] `CLAUDE.md`: the project's non-negotiable engineering rules, so every future session follows them

**1.2 Design system**

- [x] `reset.css`, `tokens.css`, `globals.css`: layers, focus ring, reduced motion, `scroll-padding-top`
- [x] Fonts via `next/font`: Cormorant Garamond and Mukta
- [x] Primitives: `Button`/`ButtonLink`, `Container`, `Section`, `Eyebrow`, `SkipLink`, `Icon`. Visually-hidden text uses a global `.visually-hidden` class rather than a component.
- [x] Ornament: `MotifDivider`, `FramedPanel` (geometric only)
- [x] `src/lib/money.ts`: `formatINR(paise)` with input guards (integers only)
- [x] Development-only `/design-system` specimen page for type and colour sign-off (returns 404 in production)

**1.3 Layout shell**

- [x] Root layout: `lang="en-IN"`, metadata title template (`%s | Madhuyamini`), viewport and theme colour
- [x] `(storefront)/layout.tsx`: `AnnouncementBar`, `Header` (`DesktopNav` disclosures, `MobileNav` `<dialog>`), `Footer`
- [x] `not-found.tsx`, `error.tsx`, `global-error.tsx`
- [x] `robots.ts`: disallow all crawling unless `SITE_ENV=production`

**1.4 Homepage editorial sections**

- [x] Hero: headline, primary and secondary calls to action, framed image slot. **The image itself is pending (D2).**
- [x] Brand introduction (draft copy, pending owner review)
- [x] Madhubani heritage: history and the five styles (draft copy). **Artist storytelling is pending (D2).**
- [x] Craftsmanship and authenticity (draft copy, pending owner review)
- [ ] Footer content: the structure is built, but **contact details, social handles and business details are pending (D2)**. They stay hidden until supplied.

**1.5 Testing and CI**

- [x] Vitest: unit tests for `formatINR`, env validation and the production placeholder guard
- [x] Playwright projects: Chromium and WebKit, at desktop and mobile viewports
- [x] End-to-end tests:
  - Landmarks, single `h1`, named regions
  - Skip link moves focus to `main`
  - Desktop disclosures (keyboard, Escape, outside click, focus leaving)
  - Mobile dialog (focus containment, Escape, focus return, scroll lock)
  - No horizontal scroll at 320 px
  - Reduced motion is respected
  - Target size, security headers, `noindex`, 404 page
  - Internal-link audit
- [x] axe: zero violations at mobile and desktop sizes, including with the navigation open
- [ ] GitHub Actions workflow written (`.github/workflows/ci.yml`, actions pinned to commit SHAs). **It has not run yet because no GitHub repository exists.**

### Acceptance criteria and results (31 Oct 2026)

| #   | Criterion                                                                    | Result                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | typecheck, lint, unit tests, build and e2e all pass                          | **Met.** `npm run check`: typecheck clean, lint 0 problems, Prettier clean, 26/26 unit tests, 75/75 e2e tests (17 skipped by design: desktop-only tests on mobile projects and vice versa, and the link audit runs once). `npm run build` succeeds.                             |
| 2   | No `any`, `@ts-ignore` or unjustified `eslint-disable`                       | **Met.** Enforced by lint rules; verified by a deliberate violation probe.                                                                                                                                                                                                      |
| 3   | axe zero violations; manual keyboard pass                                    | **Met for automated checks**, plus keyboard e2e tests and a manual browser check of both navigations. A VoiceOver pass has not been done yet.                                                                                                                                   |
| 4   | No horizontal scroll at 320 px, 200 % zoom usable, reduced motion honoured   | **320 px and reduced motion: met (tested).** 200 % text zoom: not yet checked manually.                                                                                                                                                                                         |
| 5   | Lighthouse mobile: A11y 100, Best Practices ≥ 95, SEO ≥ 95, Performance ≥ 90 | **Partially met.** Performance 100 (LCP 0.9 s, CLS 0; no real imagery yet), Accessibility 100, Best Practices 96. SEO 63 because non-production builds are `noindex` by design. A production build cannot be made until the hero image exists, so production SEO is unmeasured. |
| 6   | No fabricated content                                                        | **Met.** No products, prices, reviews, statistics, offers or contact details. Brand copy is marked as a draft for owner review.                                                                                                                                                 |
| 7   | No server modules or secrets in client bundles                               | **Met.** `server-only` guards are in place, and a scan of `.next/static` found no server code.                                                                                                                                                                                  |
| 8   | Non-production builds are `noindex`                                          | **Met** (`robots.txt` and meta tag, tested).                                                                                                                                                                                                                                    |

### Known issues and follow-ups

- **ESLint is on 9.39.x,** which npm reports as unsupported. Next's lint plugins (react, import, jsx-a11y) don't declare ESLint 10 support yet. Revisit when `eslint-config-next` moves.
- **Console 404 for `/collections`:** Next.js prefetches the hero's call to action, and that route is built in Phase 3. It is tracked in `e2e/pending-routes.ts`.
- **₹ glyph:** Mukta's `latin-ext` subset (which contains ₹) loads on demand rather than being preloaded. Consider preloading it in Phase 3, when prices appear above the fold.
- **Stray lockfile:** a `package-lock.json` in the user's home folder (outside this project) triggers a harmless Next.js warning.
- **Next.js-generated files:** `AGENTS.md` is maintained by Next.js. `CLAUDE.md` imports it.

### Inputs needed from you

| Input                                                                                | Why                                                                                                         |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Logo (SVG preferred) and any brand marks                                             | Header, favicon, social preview image                                                                       |
| Hero, heritage and artist photography                                                | Without real imagery the hero cannot be authentic. Stock and AI imagery are off the table.                  |
| Brand story facts                                                                    | Founding story, region, how you work with artists                                                           |
| Artist names, photos and stories, **with their consent**                             | Artist storytelling section                                                                                 |
| Technique per product line (hand-painted, hand-printed, digital print, embroidered…) | Authenticity copy must be truthful. Do not claim GI-tag status unless you are a registered authorised user. |
| Announcement bar message                                                             | Must describe a real, current policy or offer                                                               |
| Contact details, social handles, registered business name and address                | Footer; also required by the Consumer Protection (E-Commerce) Rules 2020                                    |
| Domain name                                                                          | Metadata, canonical URLs, email sending later                                                               |

---

## Phase 2 — Database and backend foundation

Approved 31 Oct 2026 on the proposal in [data-model.md](data-model.md).

### Objective

A production-ready PostgreSQL schema for customers and the catalog, with database-enforced invariants, repeatable migrations and seed, validated read-only services, and tests that run against a real database. No authentication, cart, checkout or payments.

### Checklist

**2.1 Database tooling**

- [x] Prisma 7.10 with the `prisma-client` generator → `src/generated/prisma` (git-ignored, regenerated by `postinstall`)
- [x] `prisma.config.ts` loads `.env.local`; `@prisma/adapter-pg` driver adapter; `pg` pinned below 9
- [x] `DATABASE_URL` validated in `src/server/env-schema.ts` (PostgreSQL scheme, never echoed)
- [x] `src/server/prisma-client.ts` factory and `src/server/db.ts` server-only singleton
- [x] `src/server/errors.ts` (`AppError`, `NotFoundError`, `ValidationError`) and `src/lib/validation.ts`

**2.2 Schema and migration**

- [x] `prisma/schema.prisma`: User, Address, Category, Product, ProductImage, ProductOption, ProductOptionValue, ProductVariant, ProductVariantValue, Inventory, Review (snake_case tables, UUID v7 ids)
- [x] Migration `20261031103938_init_catalog_and_customers` with 14 hand-written `CHECK` constraints and the one-default-address partial unique index
- [x] Deletion behaviour as documented (cascade from users and products; restrict on categories and option values in use)

**2.3 Services**

- [x] `src/features/catalog/`: `schemas.ts` (Zod), `rules.ts` (pure), `types.ts` (DTOs), `data.ts` (Prisma, server-only), `service.ts`
- [x] Reads: category tree, category by slug, paginated product listing (category incl. children, sort), product detail with options/variants/availability, featured products
- [x] Admin writes (create/update products, stock adjustments) — Phase 7
- [ ] Price sorting and filters — Phase 3 (needs a denormalised minimum price or SQL ordering)

**2.4 Seed**

- [x] `prisma/seed.ts` via `tsx`, run only by `npm run db:seed`; idempotent upserts by slug/SKU/option name
- [x] Guard refuses production and non-local hosts (`SEED_ALLOW_REMOTE=1` to override)
- [x] Fixtures: the 27 real categories from the navigation taxonomy, plus 9 clearly labelled development products (7 active, 1 draft, 1 archived), no images

**2.5 Tests and CI**

- [x] Unit: catalog rules, catalog schemas, env (`DATABASE_URL`), seed guard
- [x] Integration (real PostgreSQL, `tests/integration/`): constraints, deletion behaviour, services on the seeded catalog, seed idempotency
- [x] CI: PostgreSQL 17 service, test database creation, `prisma migrate deploy`, integration tests

### Results (31 Oct 2026)

| Gate                       | Result                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`        | Clean (includes the generated client)                                                                  |
| `npm run lint`             | 0 problems                                                                                             |
| `npm run format:check`     | Clean                                                                                                  |
| `npm test` (unit)          | 64 passed                                                                                              |
| `npm run test:integration` | 32 passed against PostgreSQL 18 locally                                                                |
| `npm run test:e2e`         | 75 passed, 17 skipped by design (unchanged from Phase 1; the homepage does not query the database yet) |
| `npm run build`            | Succeeds (run inside the e2e step)                                                                     |
| `npx prisma migrate dev`   | Applied; schema and database in sync, no drift from the hand-written constraints                       |
| `npm run db:seed` twice    | 27 categories, 9 products, 17 variants both times; row counts unchanged                                |
| CI on GitHub               | Not yet run with the database service at the time of writing (runs on push)                            |

### Known issues and follow-ups

- **`pg` deprecation warning** during integration tests ("Calling client.query() when the client is already executing a query"). The stack is inside Prisma's query interpreter over `@prisma/adapter-pg`, not application code. Harmless on `pg` 8.x; `pg` is pinned below 9. Revisit on Prisma updates.
- **Hosted database (D4)** is still undecided. Local development uses PostgreSQL 18; no 18-only features are used, and CI runs PostgreSQL 17.
- **Local PostgreSQL** was started for the session only (`pg_ctl`), not installed as a service; see the README for the commands.
- **Dev-tool advisories:** `npm audit` reports 16 moderate findings, all inside the ESLint 9 toolchain (`minimatch`, `eslint-utils`). Production dependencies have none; the CI audit gate covers production only.

---

## Phase 3 — Dynamic product catalogue

Started 31 Oct 2026 after the owner's four pre-checks (CI #3 green; reservation expiry/release modelled; multiple techniques and construction methods per product; migrations rebuild from scratch and the seed stays guarded).

### Objective

Database-backed listing, detail and search pages with filters, sorting, pagination, variants, honest image handling and every state (loading, empty, error, not-found), on the Phase 1 design system.

### Checklist

**3.1 Schema additions (Phase 2.5)**

- [x] `InventoryReservation` with status, quantity, `expiresAt`/`closedAt`, sweep indexes and CHECKs; `Inventory.reserved` invariant documented and tested
- [x] `Product.techniques[]` (non-empty, GIN) and `Product.constructionMethods[]`; hand-written data migration retiring `HANDWOVEN`/`MIXED_MEDIA`, adding `APPLIQUE`
- [x] Full-text GIN expression index (title A, subtitle B, description C); planner verified to use it

**3.2 Queries and services**

- [x] One parameterised SQL query for listing/search: category scope (incl. children), technique overlap, price range on active variants, in-stock, `websearch_to_tsquery` + title prefix match, five sort orders, window-function total
- [x] Facets: techniques available in scope
- [x] Related products: same category, then sibling categories, never self or hidden
- [x] Strict Zod query schema (rupees → paise, comma/repeated techniques, flags, limits); unknown URL keys ignored, invalid values redirect to the clean URL
- [x] React `cache()` memoisation of category tree, category and product lookups

**3.3 Pages and components**

- [x] `/collections` index, `/collections/[slug]` (breadcrumbs, child-category chips, filters, sort, pagination, empty states), `/products/[slug]` (gallery or honest fallback, variant selector with live price/availability/SKU, how-it-is-made facts, related), `/search`
- [x] Loading skeletons, 404 via `notFound()`, storefront error boundary, empty states with a way out
- [x] Header navigation sourced from the Category table; search in header and drawer
- [x] Homepage: "Shop by collection" and admin-curated "Featured pieces" (hidden when empty; never labelled best-selling)
- [x] Cloudinary `next/image` loader (unit-tested); hero image slot with a build-time guard
- [ ] Product photography (D2): every product currently shows "Photograph coming soon"
- [x] Add-to-cart (Phase 5)
- [ ] Size guide and delivery information (Phase 6/8, needs D7)

**3.4 Tests**

- [x] Unit: rules (LIKE escaping, variant matching, pagination window), schemas, URL builder, image loader, labels
- [x] Integration: search ranking and partial matches, each filter, price sorts, facets, related products, reservations
- [x] E2E: collections index, parent/child listing, breadcrumbs, filters as a GET form, empty states, price sort, pagination with filters, junk params, header search (desktop and drawer), product page facts/related, variant selection (one and two axes), one-of-a-kind, 404s for draft/archived/unknown, DB-driven nav, homepage sections, axe on five catalog pages
- [x] CI seeds the development database before building, so the e2e server has fixtures

### Results (31 Oct 2026)

| Gate                          | Result                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`           | Clean                                                                                                                                                                                                                           |
| `npm run lint`                | 0 problems                                                                                                                                                                                                                      |
| `npm run format:check`        | Clean                                                                                                                                                                                                                           |
| `npm test` (unit)             | 86 passed                                                                                                                                                                                                                       |
| `npm run test:integration`    | 49 passed (PostgreSQL 18 locally)                                                                                                                                                                                               |
| `npm run build`               | Succeeds; `/collections/[slug]`, `/products/[slug]`, `/search` and `/` are dynamic, the rest static                                                                                                                             |
| `npm run test:e2e`            | 167 passed, 17 skipped by design, across Chromium and WebKit at desktop and phone sizes, including axe on five catalogue pages                                                                                                  |
| HTTP statuses                 | Unknown categories and draft/archived/unknown products return 404; junk query values redirect client-side to the clean URL (the shell has already streamed, so it is 200)                                                       |
| Pre-checks requested by owner | CI #3 green; reservation expiry/release modelled and tested; multiple techniques and construction methods per product; scratch database rebuilt from migrations with zero drift; seed guard refuses production and remote hosts |

Fixes made because tests caught them: pagination links dropped the page size; `pageSize` was not accepted from URLs; an in-stock one-of-a-kind piece read "In stock"; the size radios were unclickable for automation (now the input overlays its label); the search page listed everything when no term was given; unknown slugs returned 200 because `notFound()` ran inside the streamed boundary (now resolved in a segment layout).

### Known issues and follow-ups

- **Hidden browser panes don't hydrate streamed boundaries.** While verifying, the product page appeared non-interactive in the Claude desktop browser pane; the cause was the pane running as a background page (animation frames paused), not the code. Visible tabs hydrate in ~100 ms and Playwright passes.
- **Price sort uses a correlated subquery** over active variants. Fine at catalogue scale; revisit with a denormalised minimum price if listings grow large (Phase 10).
- **Catalog pages are dynamic** (D10): no caching yet; measured and tagged caching comes with admin edits (Phase 7) and hardening (Phase 10).
- **No product images exist** (D2), so the gallery's multi-image behaviour is covered by unit tests of the loader and by component structure only, not by e2e.

---

## Phase 4 — Authentication and customer accounts

Approved 31 Oct 2026 with Better Auth (D3), PostgreSQL rate limits (D5) and policies P1–P5; design and implementation notes in [auth.md](auth.md).

### Checklist

- [x] Pre-implementation verification of Better Auth against Next 16, Prisma 7.10 and the existing `User` model (`tests/integration/auth.test.ts`, 13 checks)
- [x] Migration 4 with `rollback.sql` (exercised), zero drift
- [x] Better Auth instance: email/password, verification (24 h), reset (30 min, revokes all), change (rotates session), 14-day idle sessions, 30-day absolute cap, no IP storage, server-owned `role`/`phone`, HTTP surface closed except the verification link
- [x] Password policy (P3): 10–128 chars, not your email/name, predictable/common list, optional HIBP fail-open check
- [x] PostgreSQL rate limits (D5) per IP and hashed email for sign-in, registration, reset and verification; cleanup function
- [x] Email module: file/log/Resend transports, text + HTML templates; Resend required in production but checked at send time (requirement 6)
- [x] Server Actions for register, sign in, sign out, forgot, reset, resend verification; generic enumeration-safe responses
- [x] Identity data-access layer (`getCurrentUser`, `requireUser`, `requireRole`); `proxy.ts` optimistic redirect only
- [x] Pages: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/account` (overview with verification nudge), `/account/profile`, `/account/addresses` (list, add, edit, delete, default), `/account/security` (change password, devices, sign out everywhere)
- [x] Header shows Sign in / Your account
- [ ] Newsletter with an auditable consent record (P5) — still outstanding from Phase 2
- [ ] Email change, account deletion/export (DPDP) — Phase 8/10
- [x] Admin role assignment with session revocation — Phase 7

### Results (31 Oct 2026)

| Gate                       | Result                                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`        | Clean                                                                                                                                                                                                                                                                                                           |
| `npm run lint`             | 0 problems                                                                                                                                                                                                                                                                                                      |
| `npm run format:check`     | Clean                                                                                                                                                                                                                                                                                                           |
| `npm test` (unit)          | 112 passed (password policy, rate-limit arithmetic, schemas, email templates, env)                                                                                                                                                                                                                              |
| `npm run test:integration` | 71 passed, including the 13-check Better Auth probe, rate limiter atomicity, address ownership (IDOR) and reservations                                                                                                                                                                                          |
| `npm run build`            | Succeeds (inside the e2e step)                                                                                                                                                                                                                                                                                  |
| `npm run test:e2e`         | 217 passed, 19 skipped by design: registration → emailed link → sign-in, duplicate registration, predictable password, wrong password, return path, sign-out, header state, reset flow, profile, addresses, password change with device sign-out, keyboard and show-password, axe on all auth and account pages |
| Migration 4                | Applied on both local databases; `rollback.sql` exercised and re-applied; zero drift                                                                                                                                                                                                                            |

Fixes made because tests caught them: Better Auth's rate-limit table needs its own `id`; the raw rate-limit upsert must supply an id (Prisma's `uuid(7)` default is client-side); the password-change action must redirect after rotating the session, otherwise the re-render still carries the revoked cookie; verification links return to the sign-in page with a notice because registration no longer signs in. Test-side: each e2e test now sends its own `x-forwarded-for`, which also demonstrates the per-IP registration limit (shared addresses were blocked after five sign-ups).

### Known issues and follow-ups

- **Dev server must be restarted after `prisma generate`:** Better Auth inspects the Prisma client's model metadata at startup, so a long-running `next dev` keeps the old client and reports "Prisma schema mismatch" until restarted.
- **Reset links in email are app URLs** (`/reset-password?token=…`); Better Auth's default link to its own API is not used, which keeps the HTTP surface closed.
- **Expired session and rate-limit rows** are not yet swept on a schedule; `cleanupRateLimits()` exists and the cron arrives in Phase 6.
- **`npm audit`** continues to report only the dev-only ESLint 9 advisories; Better Auth added no vulnerabilities.

---

## Phase 5 — Cart and wishlist

Approved 31 Oct 2026 with decisions C1–C6 as refined by the owner; design, refinements and implementation notes in [cart.md](cart.md).

### Checklist

- [x] Migration 5 (`carts`, `cart_items`, `wishlist_items`) with CHECK constraints, partial unique index for one active cart per user, `rollback.sql`; zero drift
- [x] Pure rules (`clampQuantity`, `lineAvailability`, subtotal/count/`canCheckout`, merge arithmetic, guest expiry) with unit tests
- [x] Guest identity: 256-bit random token in an `HttpOnly`/`SameSite=Lax` cookie (`__Host-` + `Secure` in production), only its SHA-256 stored, renewed on each guest mutation, 30 days from last activity (C2)
- [x] Cart service: add (atomic under a row lock; re-reads status, stock and price; C1 limits with explicit "limited by" feedback), update, remove, price acknowledgement (C5), guest→account merge (C6: transactional, idempotent, nothing discarded), cleanup of expired guest carts
- [x] Server Actions with Zod, cart taken from the request only, 60 mutations/min per cart identity; guest cookie issued on first add
- [x] Sign-in merges the guest cart; adjusted quantities land on `/cart?cart=adjusted` with a notice; merge failures never block sign-in
- [x] UI: quantity + Add to cart on every product page (single- and multi-variant), header bag with count, `/cart` (live prices, price-change notice with "Got it", quantity select that submits on change with a `<noscript>` Update button, remove, subtotal, shipping/tax note, availability banners, merge notice, empty and loading states, no checkout button yet), `/account/wishlist` with Remove, Save/Saved heart on the product page, Wishlist in the account navigation
- [x] Unavailable lines (archived, inactive, sold out, fewer than chosen) stay visible with a status, are excluded from the subtotal and block checkout (requirement 1)
- [x] Tests: unit (rules, schemas, token), integration (26: limits, stock, one-of-a-kind, unavailable states, live price and acknowledgement, ownership across guest/user/anonymous, expiry refresh, stale token, cleanup, merge sums/caps/flags/idempotency/concurrency, wishlist ownership/uniqueness/active-only), e2e (add + header count + cart page, persistence across reload and a restored session, quantity change and remove, one-of-a-kind cap, tampered quantity rejected, guest→account merge with adjustment, wishlist sign-in redirect/toggle/page, private wishlist, axe on cart and wishlist)
- [ ] Hearts on listing cards — follow-up
- [ ] Scheduled `cleanupCarts()` — Phase 6 cron
- [ ] Checkout gating on `canCheckout`, `CONVERTED` status — Phase 6

### Results (31 Oct 2026)

| Gate                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`        | Clean                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run lint`             | 0 problems                                                                                                                                                                                                                                                                                                                                                                                                                |
| `npm run format:check`     | Clean                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm test` (unit)          | 131 passed (+14: cart rules, schemas, guest token)                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run test:integration` | 101 passed (+26: `cart.test.ts` 22, `wishlist.test.ts` 4)                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run build`            | Succeeds (inside the e2e step)                                                                                                                                                                                                                                                                                                                                                                                            |
| `npm run test:e2e`         | 249 passed, 19 skipped by design (+32: `cart.spec.ts`, 8 journeys × 4 browser projects): add from the product page with header count, persistence across reload and a restored session, quantity change and remove, one-of-a-kind cap, tampered quantity via the no-JavaScript form post, guest→account merge with adjustment, wishlist redirect/toggle/page, private wishlist, axe on cart (full and empty) and wishlist |
| Migration 5                | Applied on both local databases; `rollback.sql` exercised on the test database and re-deployed; zero drift on both                                                                                                                                                                                                                                                                                                        |

Fixes made because tests caught them: a `"use server"` module may export only async functions, so the form's state type and idle value moved to `action-state.ts`; a `<label>` wrapping a `<select>` takes the selected value into its accessible name, so the quantity controls use `htmlFor`/`aria-label`; Next's route announcer is also `role="alert"`, so the e2e locators are scoped to the form; the tamper test posts the server-rendered form (React removes the `$ACTION_*` fields once hydrated, so they are read from the raw HTML). Design-side: a cookie that outlives its cart now gets a fresh cart (the stale hash is released first), the cookie's `Max-Age` is renewed on each guest mutation so it tracks the cart's expiry, and add-to-cart runs under a row lock so concurrent adds are not lost (both proven by integration tests).

### Known issues and follow-ups

- **No hearts on listing cards yet.** The wishlist can be toggled from the product page and the wishlist page; adding the heart to every card means threading the saved-id set through the listing pages, which is a small follow-up.
- **Sold-out and price-change states are covered by integration tests, not e2e.** The e2e server runs on the seeded development database and must not alter stock or prices mid-run.
- **Expired guest carts** are closed by `cleanupCarts()`, which has no schedule yet (Phase 6 crons, with the session and rate-limit sweeps).

---

## Phase 6 — Checkout and payments

Approved 1 Nov 2026 with D6 (15-minute holds, one 15-minute extension), D7a (₹99 shipping, free from ₹1,999), D7b (cash on delivery up to ₹5,000, no fee), D7c (not GST-registered: no tax line) and P6–P12 as recommended; design and implementation notes in [checkout.md](checkout.md).

### Checklist

- [x] Migration 6: `orders`, `order_items`, `payments`, `refunds`, `order_access_tokens`, `payment_webhook_events`, `order_events`, `notification_outbox`, `inventory_reservations.order_id`; 24 CHECK constraints and two partial unique indexes (one live order per cart, one open attempt per order); `rollback.sql`; zero drift
- [x] One validated policy object (`src/config/checkout-policy.ts`) holding every amount, duration, limit and schedule; a unit test scans the checkout, orders, payments, inventory and jobs modules for stray literals
- [x] Pure rules: quotes and `quoteHash` (P12), shipping and COD eligibility, included tax, order numbers (P7), order/payment/reservation state machines, HMAC signature helpers
- [x] Inventory service: conditional single-row updates for reserve/commit/consume/release, ascending variant-id lock order, lock-then-check commit for late captures
- [x] Placement (T1/T2) with immutable item snapshots at live prices, the cart as idempotency key (row lock + partial unique index), COD confirmed at once, guest access token issued in the same transaction
- [x] Provider steps outside transactions (S2/S3): attempts start `INITIATED` with a unique receipt; lost responses recovered by receipt; failures recorded with give-up after the policy's attempts
- [x] Razorpay over its REST API behind a `PaymentGateway` interface, plus a deterministic fake gateway for development, tests and CI (refused in production by the env schema)
- [x] Capture handling (T5) with amount/currency check, late-capture restock or refund intent, duplicate-payment refund intent; failure handling (T6) that never overwrites a capture; capture allowed after a recorded failure on the same provider order
- [x] Browser callback: signature verified, then the capture confirmed from the provider before T5; "confirming" page polls when the provider has not captured yet
- [x] Webhook route: raw-body signature, event-id ledger, 200 once stored, inline apply with `SKIP LOCKED`, retries by job
- [x] Jobs with one claim/lease/backoff contract: expire-reservations (reconciles before cancelling), recover-payments, reconcile-payments, process-webhooks, refund-payments (find-by-reference before create; polls to completion), send-notifications (outbox with provider idempotency key), cleanup (carts, rate limits, sessions, verifications, tokens); cron routes with bearer secret; `vercel.json`; `npm run job -- <name>`
- [x] Guest order access: 256-bit tokens, hash-only storage, rotation on lookup, 7-day expiry, full details for the first hour then reduced
- [x] UI: `/checkout` (contact, saved or new address, payment method, note; works without JavaScript), `/checkout/pay/[id]` (Razorpay Checkout, deadline countdown, retry, cancel; simulator panel with the fake gateway), `/checkout/confirming/[id]`, `/checkout/confirmation/[id]`, `/account/orders` and `/account/orders/[number]` with timeline, `/orders/track`; cart gains "Proceed to checkout"; account navigation gains Orders
- [x] Emails: order confirmed (customer), new order (owner), cancelled, refund requested, operations alerts; all through the outbox
- [ ] Razorpay **test-mode smoke** on a deployed preview with the owner's keys (§15 of checkout.md) — not run; needs keys
- [ ] Vercel Hobby plan runs crons at most daily; per-5-minute schedules need Pro or an external pinger — decide at deployment (Phase 11)
- [ ] Policy pages for Razorpay live activation — Phase 9, before go-live
- [x] Admin tooling for `NEEDS_REVIEW` orders and `FAILED` queue rows — Phase 7

### Results (1 Nov 2026)

| Gate                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck`        | Clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm run lint`             | 0 problems                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `npm run format:check`     | Clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `npm test` (unit)          | 181 passed (+50: policy and literal scan, pricing rules and `quoteHash`, state machines, order numbers, signatures, fake gateway, env)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run test:integration` | 172 passed (+71: inventory 11 incl. last-unit race and opposite-order locking; schema invariants 10; checkout 19 incl. concurrent placement, provider recovery, attempts, access; payments 16 incl. callback, webhook ledger, out-of-order and late captures, reconciliation; jobs 15 incl. sweeps, leases, retries, give-up alerts, concurrent workers, cron auth)                                                                                                                                                                                                                                                            |
| `npm run build`            | Succeeds (inside the e2e step)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run test:e2e`         | 281 passed, 19 skipped by design (+32: `checkout.spec.ts`, 8 journeys × 4 browser projects): guest cash-on-delivery → confirmation → email through the outbox job → tracking by number and email (wrong email refused); private confirmation page; empty cart blocked; signed-in online order → simulated capture → confirmation, orders list, detail with timeline, address saved; failed payment → Try again → cancel keeps the cart; capture delivered by webhook only (signed accepted, tampered refused); no-JavaScript placement; cron route auth; axe on checkout, pay, confirmation, orders, order detail and tracking |
| Migration 6                | Applied on both local databases; `rollback.sql` exercised on the test database and re-deployed; zero drift on both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Fixes made because tests caught them: a `"use server"` module may export only async functions; a `<label>` wrapping a `<select>` takes the value into its name, and jsx-a11y wants label text within two levels; leaving `CANCELLED` must clear the cancellation reason (CHECK); one provider order can carry several payment tries, so `FAILED → CAPTURED` is allowed; fake gateway ids must stay unique across server restarts (they sit under a unique index); the pay page said "Start payment" instead of "Try again" after a failed attempt; e2e journeys consume stock, so they buy a deep-stock fixture and Playwright re-seeds before each run; new browser contexts need their own client address and unique lookup emails or the per-IP and per-email limits trip; Chromium restores the scroll position on reload, which parked the sticky header over a button the axe audit measured.

### Known issues and follow-ups

- **Not verified against real Razorpay.** Everything is proven against the fake gateway and the documented API shapes; the first run with test-mode keys (UPI `success@razorpay` / `failure@razorpay`, webhook delivery to a preview URL) is still to be done and may surface field-mapping differences.
- **Cron frequency on Vercel Hobby** is once a day; the design tolerates slow sweeps (deadlines are enforced on read as well), but refunds and emails would lag. Use Pro or an external scheduler hitting `/api/cron/*` with the bearer secret.
- **Resend idempotency header** is sent as `Idempotency-Key`; if Resend ignores it, the only duplicate window is a crash between send and completion (logged on the row).
- **Guest orders are not linked to a later account** with the same email (Phase 8).
- **Refund status webhooks** (`refund.processed`) are applied; staff-initiated refunds and the review screen are Phase 7.

---

## Phase 8 — Returns, exchanges and custom artwork

Status: **approved on 2 Nov 2026; implementation in progress from step 8.0 (placement entry point); nothing customer-facing is live yet.** The design is [phase-8-returns-custom-artwork.md](phase-8-returns-custom-artwork.md): customer returns and exchanges for delivered orders, item-level refunds on the Phase 6 refund worker and the Phase 7 refund operation keys, and a quotation-based custom artwork workflow, with a decision register (D8.1–D8.18) that needs the owner's answers before the gated steps start. The readiness review of 2 Nov 2026 is in [phase-8-decision-register.md](phase-8-decision-register.md) (all 18 decisions pending owner approval) and [phase-8-implementation-readiness.md](phase-8-implementation-readiness.md) (dependency graph, risks, rollback, production criteria). Coupons and verified-purchase reviews, listed under "advanced commerce" in the table below, are deferred to a later proposal; shipments and tracking already shipped in Phase 7.

---

## Phases 2–11 at a glance

Each phase gets its own detailed plan, with objectives, tasks, tests and acceptance criteria, before work starts.

| Phase                        | Core deliverables                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2. Database and backend**  | Prisma 7 + PostgreSQL schema and migrations (with CHECK constraints), dev-only seed, database client, error model, logging, newsletter subscription with consent record, integration-test database |
| **3. Product catalog**       | Collections, product pages (gallery, variants, size guide, stock text, care, delivery), search (Postgres full-text and trigram), filters, Cloudinary loader, homepage data sections, sitemap       |
| **4. Auth and accounts**     | Registration, login, sessions, email verification, password reset, rate limiting, roles, account pages, address book                                                                               |
| **5. Cart and wishlist**     | Guest cart via an opaque `HttpOnly` cookie, merge on login, server-computed totals, wishlist, accessible cart feedback                                                                             |
| **6. Checkout and payments** | Address and delivery step, idempotent order creation, stock reservation, Razorpay order, signature check, webhooks and reconciliation, COD, confirmation emails, guest order tracking              |
| **7. Admin**                 | Role-gated dashboard: products, variants, images, inventory, orders and status transitions, refunds, audit log, admin 2FA                                                                          |
| **8. Advanced commerce**     | Coupons, verified reviews, returns, custom artwork requests, shipments and tracking                                                                                                                |
| **9. Brand and content**     | About, artists, craft and care guides, policy pages                                                                                                                                                |
| **10. Hardening**            | CSP, security review, load test of checkout, performance budgets, full accessibility audit, monitoring                                                                                             |
| **11. Deployment**           | Vercel (`bom1`), database backups and point-in-time recovery, DNS, email authentication (SPF/DKIM/DMARC), runbooks, launch checklist                                                               |
