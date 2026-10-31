# Madhuyamini — Roadmap

Status: **Phases 1–2 implemented (31 Oct 2026).** Phase 1 awaits owner review and brand inputs; Phase 2 awaits owner review.

Related: [architecture.md](architecture.md) · [design-system.md](design-system.md). Decision IDs (D1–D9) refer to architecture.md §7.

| #   | Phase                                       | Status                      | Decisions needed first |
| --- | ------------------------------------------- | --------------------------- | ---------------------- |
| 1   | Project setup and homepage foundation       | **Implemented; open items** | D2 (D1 decided)        |
| 2   | Database and backend foundation             | **Implemented; open items** | D4 (deferred to 11)    |
| 3   | Product catalog                             | Not started                 | none                   |
| 4   | Authentication and customer accounts        | Not started                 | D3, D5                 |
| 5   | Cart and wishlist                           | Not started                 | none                   |
| 6   | Checkout and payments (Razorpay + COD)      | Not started                 | D6, D7                 |
| 7   | Admin dashboard                             | Not started                 | none                   |
| 8   | Advanced e-commerce features                | Not started                 | D7                     |
| 9   | Brand experience and content                | Not started                 | D2                     |
| 10  | Testing, security and performance hardening | Not started                 | D8, D9                 |
| 11  | Production deployment                       | Not started                 | none                   |

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
- [ ] Admin writes (create/update products, stock adjustments) — Phase 7
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
