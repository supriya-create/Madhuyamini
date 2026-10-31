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

### Database

The app needs PostgreSQL (16 or newer). With Homebrew on macOS:

```bash
brew install postgresql@18
```

```bash
brew services start postgresql@18
```

```bash
createdb madhuyamini && createdb madhuyamini_test
```

Set `DATABASE_URL` and `TEST_DATABASE_URL` in `.env.local` (see `.env.example`), then apply the migrations and load the development fixtures:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

The seed is idempotent and refuses to run against production or any non-local host. The storefront's collections, product pages, search and header navigation all read from this database, and the e2e suite expects the seed fixtures to be present. If PostgreSQL complains that `/tmp/.s.PGSQL.5432` is in use (a stale socket from another install), start it with a private socket directory: `pg_ctl -D /opt/homebrew/var/postgresql@18 -o "-c unix_socket_directories=/tmp/pgsock" start` (and `LC_ALL=en_US.UTF-8` if it reports becoming multithreaded).

## Quality gates

```bash
npm run check
```

This runs typecheck, lint, format check, unit tests, integration tests (real PostgreSQL, `TEST_DATABASE_URL`) and end-to-end/accessibility tests. The first end-to-end run needs the Playwright browsers:

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
- [Data model](docs/data-model.md)
- [Authentication and accounts](docs/auth.md)
- [Cart and wishlist](docs/cart.md)
- [Checkout and payments](docs/checkout.md)
- [Design system](docs/design-system.md)
- [Engineering rules](CLAUDE.md)
