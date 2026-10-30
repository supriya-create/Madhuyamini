# Madhuyamini: engineering rules

@AGENTS.md

Madhubani-inspired e-commerce store (clothing, wall art, home décor, accessories).
Before changing code, read:

- `docs/roadmap.md`: phase status and the current phase's checklist
- `docs/architecture.md`: structure, layering rules, open decisions (D1–D9)
- `docs/design-system.md`: tokens, type, components, accessibility rules

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
- **Links:** internal URLs come from `src/lib/routes.ts`. Links to routes not yet built must be listed in `e2e/pending-routes.ts`.
- **Accessibility (WCAG 2.2 AA):** axe must report zero violations, and keyboard paths are covered by e2e tests.
- **Tests:** never weaken or delete a test to make it pass. Fix the cause.

## Commands

| Command                           | Purpose                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`                     | Development server on http://localhost:3000                                              |
| `npm run typecheck`               | Generate route types, then `tsc --noEmit`                                                |
| `npm run lint`                    | ESLint (type-aware rules, full jsx-a11y), zero warnings allowed                          |
| `npm run format` / `format:check` | Prettier                                                                                 |
| `npm test`                        | Vitest unit tests                                                                        |
| `npm run test:e2e`                | Builds, starts on :3100, runs Playwright and axe (Chromium + WebKit, desktop and mobile) |
| `npm run check`                   | Every gate above, in order                                                               |
