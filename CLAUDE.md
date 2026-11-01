# Madhuyamini: engineering rules

@AGENTS.md

Madhubani-inspired e-commerce store (clothing, wall art, home décor, accessories).
Before changing code, read:

- `docs/roadmap.md`: phase status and the current phase's checklist
- `docs/architecture.md`: structure, layering rules, open decisions (D1–D9)
- `docs/design-system.md`: tokens, type, components, accessibility rules
- `docs/data-model.md`: schema, constraints, deletion behaviour
- `docs/auth.md`: authentication design, Better Auth configuration, security checklist
- `docs/cart.md`: cart and wishlist rules (C1–C6), guest cookie, merge on sign-in
- `docs/checkout.md`: orders, payments, reservations, jobs; transaction catalogue and lock order (§5.5), recovery (§5.6–§5.8)

## Workflow

- Work one roadmap phase at a time. Propose the plan and get the owner's approval before
  architectural changes, stack deviations or new dependencies.
- Report each phase as: objective, approach, plan, files, implementation, testing,
  verification, completion report.
- Never claim a command passed unless it was run. `npm run check` runs every gate.
- Ask about business rules (pricing, shipping, returns, tax) instead of assuming them.

## Non-negotiables

- **Styling:** no Tailwind and no CSS-in-JS. Use CSS Modules plus the global tokens in `src/styles/`. No raw hex values in modules; use tokens.
- **TypeScript:** strict. No `any`, no `@ts-ignore`, and no `eslint-disable` without a written reason.
- **Components:** Server Components by default. Add `"use client"` only where interactivity requires it.
- **Server code:** server-only modules start with `import "server-only"`. Read configuration through `@/server/env`, never from `process.env` directly.
- **Money:** always integer paise. Format with `formatINR` (`src/lib/money.ts`), and only at display time.
- **Trust boundary:** never trust client-sent prices, discounts, stock or roles. Validate input with Zod at every server boundary, and enforce authorisation in services, not in `proxy.ts`.
- **No fabricated content:** no invented products, reviews, ratings, statistics, testimonials, offers, contact details or imagery.
  - Unset brand data stays `null`, and the UI that would show it is hidden.
  - Missing imagery uses `ImagePending`, which throws in production on purpose.
- **Database:** schema changes go through `prisma migrate dev`; invariants Prisma cannot express (`CHECK`) are hand-written into the migration SQL and tested in `tests/integration/`. Data access lives in `features/*/data.ts` with explicit `select`; UI never imports Prisma types (use the DTOs in `types.ts`). Storefront reads expose only `ACTIVE` products.
- **Authentication:** Better Auth is configured in `src/server/auth/auth.ts`; call it only through Server Actions, never expose new HTTP paths without a reason. Authorisation lives in `src/server/auth/current-user.ts` (`requireUser`, `requireRole`) and in data access scoped by user id; `proxy.ts` is optimistic only. Never accept `role` from input. Rate-limit every credential-handling action with `consumeRateLimit`. Responses to sign-in, registration and reset must not reveal whether an email exists.
- **Cart:** the cart is resolved from the request (`resolveCartContext`: session first, else the hashed guest cookie), never from form input; line ids are always checked against that cart. Prices and stock are re-read from the database in every operation; `priceSeenInPaise` is for the price-change notice only and is never charged. Quantities obey `clampQuantity` (max 10, 1 for one-of-a-kind, never above available stock). Wishlists are accounts-only.
- **Checkout and payments:** every amount, duration, limit and schedule lives in `src/config/checkout-policy.ts` (a unit test rejects literals elsewhere); orders snapshot what they applied. Never mark an order paid from the browser callback alone: verify the signature, then confirm the capture from the provider (`confirmFromCallback`) or a signed webhook, and apply it through `applyCapture`. Never call the provider inside a transaction; write the intent row (attempt with `receipt`, refund with `reference`) first, call, then persist. Follow the lock order `carts → orders → payments/refunds → inventory (ascending variant id) → reservations`. Stock moves only through `features/inventory/service.ts` conditional updates. Guest order access is by hashed token only; orders are never fetched by id alone. Jobs go through `server/jobs/queue.ts` claims and are idempotent.
- **Admin (Phase 7):** every admin data and service function takes a `StaffContext` (`src/server/auth/staff.ts`) as its first argument and calls `requirePermission` (the signature-scan unit test enforces this); mutations go through `runAudited` / `runAuditedExternal` so every attempt leaves a SUCCESS, REFUSED or FAILED audit row; the audit log, `inventory_adjustments` and `order_events` are append-only; stock moves only through `applyAdjustment` or the Phase 6 reservation service; payments are never asserted from a form (provider facts → `applyCapture`); customer contact details stay masked unless an active grant (or ADMIN) reveals them, and every reveal is recorded; uploads are signed per product and verified on return; no admin page or action is reachable without an enrolled and verified second factor.
- **Seed data** is development-only: idempotent, clearly labelled, guarded against production. Never add real merchandise, customers or reviews to fixtures.
- **Links:** internal URLs come from `src/lib/routes.ts`. Links to routes not yet built must be listed in `e2e/pending-routes.ts`.
- **Accessibility (WCAG 2.2 AA):** axe must report zero violations, and keyboard paths are covered by e2e tests.
- **Tests:** never weaken or delete a test to make it pass. Fix the cause.

## Commands

| Command                            | Purpose                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`                      | Development server on http://localhost:3000                                              |
| `npm run typecheck`                | Generate route types, then `tsc --noEmit`                                                |
| `npm run lint`                     | ESLint (type-aware rules, full jsx-a11y), zero warnings allowed                          |
| `npm run format` / `format:check`  | Prettier                                                                                 |
| `npm test`                         | Vitest unit tests                                                                        |
| `npm run test:e2e`                 | Builds, starts on :3100, runs Playwright and axe (Chromium + WebKit, desktop and mobile) |
| `npm run job -- <name>`            | Runs one scheduled job by hand (expire-reservations, send-notifications, cleanup, …)     |
| `npm run check`                    | Every gate above, in order                                                               |
| `npm run admin:promote -- <email>` | Promote a verified account to ADMIN (shell only; see docs/admin.md §13)                  |
