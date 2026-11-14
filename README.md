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

| Variable          | Required                                                     | Purpose                                                                                                                                    |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `SITE_ENV`        | No (defaults to `development`; falls back to `VERCEL_ENV`)   | `development` / `preview` / `production`. Only production is indexable, and only production rejects placeholders.                          |
| `SITE_URL`        | In production (https)                                        | Canonical origin for metadata.                                                                                                             |
| `PAYMENT_GATEWAY` | No (defaults to `fake` in development, `razorpay` elsewhere) | `razorpay` / `fake`. Production refuses `fake`; a preview must opt in explicitly.                                                          |
| `DATABASE_URL`    | Yes                                                          | PostgreSQL connection. A preview deployment must use a separate database whose name ends in `_preview` or `_test`, or it refuses to start. |

Variables are validated at startup in `src/server/env-schema.ts`: Razorpay key id, key secret and webhook secret are set together or not at all, and a production server additionally refuses to start without a complete, live Razorpay configuration (`src/instrumentation.ts`). The full per-environment configuration, including which values belong to local, CI, preview and production, is in [docs/environments.md](docs/environments.md).

> **Note:** a production build (`SITE_ENV=production`) intentionally fails until the hero photograph replaces its `ImagePending` placeholder.

Phase 7 (admin) adds: `ADMIN_TOTP_KEY` (32 random bytes, base64url; encrypts staff authenticator secrets — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`), `ADMIN_TOTP_KEY_PREVIOUS` (during rotation), `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` / `CLOUDINARY_UPLOAD_PRESET` (signed product image uploads; optional in development, where images can be added by address), `SEED_ADMIN_PASSWORD` (development only: seeds `admin@example.com` and `staff@example.com`), and `MIGRATION_DATABASE_URL` (the owning role for migrations once the runtime role `madhuyamini_app` exists; run `scripts/provision-db-roles.sql` first). The first production admin is created with `npm run admin:promote -- <email>` (docs/admin.md §13).

## Documentation

- [Roadmap and phase status](docs/roadmap.md)
- [Architecture and decisions](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Authentication and accounts](docs/auth.md)
- [Cart and wishlist](docs/cart.md)
- [Checkout and payments](docs/checkout.md)
- [Design system](docs/design-system.md)
- [Engineering rules](CLAUDE.md)
