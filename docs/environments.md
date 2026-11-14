# Madhuyamini — Environment configuration

Which variables each deployment needs, what the application refuses, and why. The schema is `src/server/env-schema.ts`; the production startup check is `src/server/payments/readiness.ts`, run from `src/instrumentation.ts`. Added with the audit's batch 2 (B-03, 15 Nov 2026).

Related: [checkout.md](checkout.md) §6 and §10 · [admin.md](admin.md) §16 (production blockers) · `.env.example`.

## 1. The three stages

`SITE_ENV` selects the stage (`development` / `preview` / `production`) and falls back to Vercel's `VERCEL_ENV`, so a Vercel preview deployment is `preview` without any setting. Everything below keys off that value.

| Concern                                         | `development` (local, CI)                                        | `preview` (Vercel preview deployments)                    | `production`                                        |
| ----------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| Default `PAYMENT_GATEWAY`                       | `fake`                                                           | `razorpay`                                                | `razorpay`                                          |
| `PAYMENT_GATEWAY=fake`                          | allowed (default)                                                | allowed **only when set explicitly** for that preview     | **refused** at parse time                           |
| Razorpay key id mode                            | `rzp_test_` only                                                 | `rzp_test_` only; a live key fails parsing                | `rzp_live_` only; a test key fails parsing          |
| Missing Razorpay keys                           | online payment unavailable, COD works                            | online payment unavailable, COD works; the build succeeds | the build succeeds; **the server refuses to start** |
| Missing `RAZORPAY_WEBHOOK_SECRET` with keys set | **refused** at parse time (keys and webhook secret are one unit) | **refused** at parse time                                 | **refused** at parse time, and again at startup     |
| Email                                           | `file` (default) or `log`                                        | `file` / `log` / `resend`                                 | `resend` only                                       |
| Indexing, placeholders                          | `noindex`; placeholders allowed                                  | `noindex`; placeholders allowed                           | indexable; `ImagePending` throws                    |

Rules that hold in every stage: `RAZORPAY_KEY_ID` must look like a Razorpay key id (`rzp_test_…` / `rzp_live_…`), the id, the secret and `RAZORPAY_WEBHOOK_SECRET` must be set together (keys without the webhook secret are refused, because deliveries could not be verified), and no payment variable is ever read outside the schema or published through a `NEXT_PUBLIC_` variable (`src/server/payments/client-boundary.test.ts` enforces both).

**Preview database isolation.** A deployment identified as `preview` (by `SITE_ENV` or Vercel's `VERCEL_ENV`) must point `DATABASE_URL` at a separate, disposable database, and the schema refuses to start a preview unless the database's name ends in `_preview` or `_test`, whichever gateway is selected. The suffix does not prove which database the URL reaches; it is a configuration safeguard that makes the common mistake (pasting the production URL into the Preview scope) fail at startup instead of letting a fake payment mark real orders paid or Razorpay test mode create real orders. The actual isolation is the separate database you provision. Refusals name the rule only, never the URL, user or password.

## 2. Gateway selection is server-side

`getPaymentGateway()` (`src/server/payments/index.ts`) reads the parsed environment and nothing else. The browser receives only the public key id for the hosted checkout; the fake gateway's key secret and webhook secret live in `src/server/payments/fake-secrets.ts`, which only the fake gateway imports, and an end-to-end test scans the built client bundles for them (`e2e/security.spec.ts`). The development-only simulator panel and its Server Action both check `isFakeGateway()` on the server, so a crafted form post against a Razorpay-configured deployment does nothing.

The fake gateway's constants are public by design (tests sign simulated callbacks and webhooks with them). That is exactly why the fake gateway must never be reachable from a deployment anyone else can reach: a preview with `PAYMENT_GATEWAY=fake` lets anyone with the URL "pay" for orders and forge webhooks against that preview's database. Only use it on a preview whose database is disposable, and never point such a preview at the production database.

## 3. Variables by environment

Values are examples of shape only; never commit real ones.

| Variable                             | Local (`.env.local`)                                                                             | CI                            | Preview (Vercel, Preview scope)                                                                             | Production (Vercel, Production scope)                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `SITE_ENV`                           | `development` (default)                                                                          | `development`                 | unset (falls back to `VERCEL_ENV=preview`)                                                                  | unset (`VERCEL_ENV=production`) or `production`      |
| `SITE_URL`                           | `http://localhost:3000`                                                                          | `http://localhost:3100` (e2e) | the preview URL if emails must link back                                                                    | `https://<domain>` (required, https)                 |
| `DATABASE_URL`                       | local PostgreSQL                                                                                 | CI service database           | a **separate, disposable** database whose name ends in `_preview` or `_test` (enforced); never production's | the runtime role on the production database          |
| `TEST_DATABASE_URL`                  | `…/madhuyamini_test`                                                                             | `…/madhuyamini_test`          | –                                                                                                           | –                                                    |
| `BETTER_AUTH_SECRET`                 | random, ≥ 32 chars                                                                               | throwaway                     | its own value                                                                                               | its own value                                        |
| `PAYMENT_GATEWAY`                    | `fake` (or omit)                                                                                 | `fake` (set explicitly)       | omit for Razorpay test mode; `fake` only for a disposable preview                                           | omit or `razorpay`; `fake` is refused                |
| `RAZORPAY_KEY_ID` / `_KEY_SECRET`    | `rzp_test_…` pair, or omit                                                                       | omit                          | `rzp_test_…` pair for the test-mode smoke (checkout.md §15), or omit                                        | `rzp_live_…` pair (required to start)                |
| `RAZORPAY_WEBHOOK_SECRET`            | required whenever the keys are set; any non-empty value locally, where Razorpay cannot reach you | omit                          | the test-mode webhook secret (required with the keys)                                                       | the live webhook secret (required to start)          |
| `RAZORPAY_WEBHOOK_SECRET_PREVIOUS`   | –                                                                                                | –                             | during rotation only                                                                                        | during rotation only                                 |
| `EMAIL_TRANSPORT` / `RESEND_API_KEY` | `file`                                                                                           | `file`                        | `file` or a Resend test key                                                                                 | `resend` + live key                                  |
| `CRON_SECRET`                        | any ≥ 16 chars                                                                                   | throwaway                     | its own value                                                                                               | its own value (Vercel Cron sends it)                 |
| `ORDER_NOTIFY_EMAIL`                 | optional                                                                                         | `owner@example.com` (tests)   | optional                                                                                                    | the operations inbox (alerts are skipped without it) |
| `ADMIN_TOTP_KEY`                     | dev value                                                                                        | throwaway                     | its own value                                                                                               | its own value                                        |
| `SEED_ADMIN_PASSWORD`                | optional                                                                                         | throwaway                     | –                                                                                                           | never                                                |
| `CLOUDINARY_*`                       | optional                                                                                         | throwaway                     | a sandbox cloud                                                                                             | all three plus a signed `CLOUDINARY_UPLOAD_PRESET`   |
| `MIGRATION_DATABASE_URL`             | –                                                                                                | –                             | –                                                                                                           | the owning role (migrations and the promote script)  |

## 4. What fails, and when

| Situation                                                            | Build | Server start | First payment                                |
| -------------------------------------------------------------------- | ----- | ------------ | -------------------------------------------- |
| Preview or development without Razorpay keys                         | ok    | ok           | "online payment is not available"; COD works |
| Production without Razorpay keys                                     | ok    | **refused**  | –                                            |
| Production without `RAZORPAY_WEBHOOK_SECRET` (schema bypassed)       | ok    | **refused**  | –                                            |
| `PAYMENT_GATEWAY=fake` in production                                 | fails | –            | –                                            |
| `rzp_live_` key outside production, or `rzp_test_` key in production | fails | –            | –                                            |
| Key id without secret, or secret without key id                      | fails | –            | –                                            |
| Keys set without `RAZORPAY_WEBHOOK_SECRET`, or with an empty one     | fails | –            | –                                            |
| Preview whose database name does not end in `_preview` or `_test`    | fails | –            | –                                            |
| A key id that is not a Razorpay key id                               | fails | –            | –                                            |

"Fails" means `parseEnv` throws when the environment is first read (build or start); its message names the variable and never its value. "Refused" means `register()` in `src/instrumentation.ts` throws before the first request, so the deployment is unhealthy rather than quietly unable to take or verify payments. The startup check keeps its own webhook-secret rule as defence in depth behind the schema.

## 5. Vercel settings checklist

- Set Razorpay keys per scope: test-mode keys in the **Preview** scope only, live keys in the **Production** scope only. The key-mode rule makes a mix-up a startup failure rather than a silent one.
- Never set `PAYMENT_GATEWAY=fake` in the Production scope; set it in the Preview scope only for a preview with a disposable database.
- Give previews their own `DATABASE_URL`, provisioned separately from production, and name that database with a `_preview` or `_test` suffix; a preview will not start otherwise. A preview with the fake gateway pointed at production data would let anyone with the URL create paid orders, and even Razorpay test mode would write real orders.
- The webhook URL in the Razorpay Dashboard points at the production domain; a preview running the test-mode smoke uses its own preview URL and the test-mode secret.
- `ORDER_NOTIFY_EMAIL` must be set in production for operations alerts to exist (see checkout.md §16, outstanding improvement).
