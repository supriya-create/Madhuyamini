# Madhuyamini

E-commerce platform for a Madhubani art-inspired brand: clothing, wall art, home décor and accessories.

Built with Next.js 16 (App Router), React 19, strict TypeScript and CSS Modules. PostgreSQL/Prisma, Razorpay and Cloudinary arrive in later phases; see [docs/roadmap.md](docs/roadmap.md).

## Getting started

Prerequisites: Node.js 24 LTS (≥ 22.12 works; see `.nvmrc`) and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. The internal design-system specimen is at `/design-system` (it returns 404 when `SITE_ENV=production`).

## Quality gates

```bash
npm run check
```

This runs typecheck, lint, format check, unit tests and end-to-end/accessibility tests. The first end-to-end run needs the Playwright browsers:

```bash
npx playwright install chromium webkit
```

## Environment

| Variable   | Required                                                   | Purpose                                                                                                           |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `SITE_ENV` | No (defaults to `development`; falls back to `VERCEL_ENV`) | `development` / `preview` / `production`. Only production is indexable, and only production rejects placeholders. |
| `SITE_URL` | In production (https)                                      | Canonical origin for metadata.                                                                                    |

Variables are validated at startup in `src/server/env-schema.ts`.

> **Note:** a production build (`SITE_ENV=production`) intentionally fails until the hero photograph replaces its `ImagePending` placeholder.

## Documentation

- [Roadmap and phase status](docs/roadmap.md)
- [Architecture and decisions](docs/architecture.md)
- [Design system](docs/design-system.md)
- [Engineering rules](CLAUDE.md)
