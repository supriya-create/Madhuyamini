# Madhuyamini — Authentication and Customer Accounts

Status: **Approved and implemented, 31 Oct 2026.** The owner chose **Better Auth** for D3 (not the custom-session option this document originally recommended) and PostgreSQL counters for D5; policy answers P1–P5 are recorded below. Implementation notes follow the original design in §9.

Scope: registration, sign-in, sign-out, email verification, password reset and change, session management, profile and address book, protected routes and role checks. Not in this phase: social or phone sign-in, two-factor authentication (admin, Phase 7), order history (Phase 6), cart merging (Phase 5), newsletter consent (outstanding from Phase 2).

---

## 1. Decisions needed first

### D3 — Authentication approach

| Option                   | What we get                                                                                                                                                           | What we take on                                                                                                                                       | Verdict                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Custom database sessions | Full control: revocable sessions, our own schema, our own rate limiting, no beta dependency. Inside the brief's stated stack ("secure session-based authentication"). | We own ~600 lines of security code (hashing, tokens, cookies, limits) and must test it exhaustively. No social or phone sign-in without further work. | **Recommended for email + password.**                                        |
| Better Auth 1.7          | Email/password, verification, reset, sessions, rate limiting, plus plugins for phone OTP, social and admin roles. Maintained; listed in Next's own guide.             | Stack deviation needing approval; its own tables and routes; upgrade churn; another large dependency in the trust boundary.                           | **Chosen (owner decision).** Verified against this stack before use; see §9. |
| Auth.js (NextAuth) v5    | —                                                                                                                                                                     | Still `5.0.0-beta.32` after three years; credentials sign-in forces stateless JWT sessions, which cannot be revoked server-side.                      | Not suitable for a store.                                                    |

### D5 — Rate-limit store

In-memory counters do not work across serverless instances. **Recommended:** a `rate_limit_buckets` table in PostgreSQL (fixed window, atomic upsert). No new service, trivially testable, more than enough for authentication endpoints. Move to Redis only if measurement shows contention (Phase 10).

### Policy questions

| #   | Question                                             | Recommendation                                                                                                                          |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | May a customer sign in before verifying their email? | Yes. Verification is nudged in the account area; whether unverified accounts may check out is decided in Phase 6.                       |
| P2  | Phone number at registration?                        | Optional. It is required later on delivery addresses anyway.                                                                            |
| P3  | Password rules                                       | 10–128 characters, any characters, must not equal the email or name. No composition rules (they weaken passwords and frustrate people). |
| P4  | Session lifetime                                     | 30 days absolute, 14 days idle (sliding renewal). "Sign out everywhere" available.                                                      |
| P5  | Marketing consent at registration                    | Not in this phase; the newsletter (with its own consent record) is built separately.                                                    |

---

## 2. Data model additions

```prisma
model Session {
  id         String   @id @default(uuid(7)) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  /// SHA-256 of the random token held in the cookie; the token itself is never stored.
  tokenHash  String   @unique @map("token_hash")
  expiresAt  DateTime @map("expires_at")
  lastSeenAt DateTime @map("last_seen_at")
  /// Truncated user agent, so customers can recognise devices when revoking sessions.
  userAgent  String?  @map("user_agent")
  createdAt  DateTime @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([expiresAt])
}

enum TokenPurpose { EMAIL_VERIFICATION  PASSWORD_RESET }

model VerificationToken {
  id         String       @id @default(uuid(7)) @db.Uuid
  userId     String       @map("user_id") @db.Uuid
  purpose    TokenPurpose
  tokenHash  String       @unique @map("token_hash")
  expiresAt  DateTime     @map("expires_at")
  consumedAt DateTime?    @map("consumed_at")
  createdAt  DateTime     @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, purpose])
}

/// Fixed-window counters for authentication endpoints (D5).
model RateLimitBucket {
  key            String   @id
  windowStartsAt DateTime @map("window_starts_at")
  count          Int      // CHECK count >= 0
}
```

`User` gains `passwordUpdatedAt` and `lastLoginAt`. Deleting a user cascades to sessions and tokens (as it already does for addresses and reviews). IP addresses are **not** stored.

---

## 3. Flows

**Register** — name, email, password (phone optional). Rate-limited per IP. If the email is new: create the user (role `CUSTOMER`, never from input), hash the password, start a session, send a verification email, redirect to the account. If the email already exists: show the _same_ success screen and instead email the existing owner "someone tried to register with your address" with a reset link. Nothing on screen reveals whether an address is registered.

**Sign in** — email + password, optional `next` return path. Rate-limited per IP and per email. Unknown email still runs a hash comparison against a fixed dummy hash so timing is identical. On success: new session, cookie set, `lastLoginAt`, redirect to `next` (validated: a relative path starting with `/` and not `//`) or `/account`. On failure: one generic message.

**Sign out** — deletes the session row and clears the cookie. "Sign out everywhere" deletes all of the user's sessions.

**Verify email** — link with a 256-bit token; valid 24 h, single use; requesting a new link invalidates earlier ones. On success `emailVerifiedAt` is set.

**Forgot / reset password** — request form always answers "if an account exists we've sent a link". Token valid 30 minutes, single use. Completing a reset sets the new hash, revokes every session, signs the customer in fresh, and emails a confirmation.

**Change password** (signed in) — requires the current password; revokes all _other_ sessions.

**Account area** — `/account` overview (name, email, verification nudge), `/account/profile` (name, phone), `/account/addresses` (add, edit, delete, set default — the partial unique index enforces one default), `/account/security` (change password, active sessions with revoke, sign out everywhere).

---

## 4. Security controls

| Control                                | Decision                                                                                                                                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password hashing                       | Argon2id via `@node-rs/argon2` (OWASP parameters: 19 MiB memory, 2 iterations, 1 lane). Hash upgrades on next successful sign-in if parameters change.                                                                                                                                   |
| Session token                          | 32 random bytes (base64url) in the cookie; SHA-256 stored. Rotated on sign-in and password change.                                                                                                                                                                                       |
| Cookie                                 | `HttpOnly; Secure; SameSite=Lax; Path=/`. In production the name uses the `__Host-` prefix, which browsers only accept over HTTPS with `Path=/` and no `Domain`.                                                                                                                         |
| Expiry                                 | 30 days absolute, 14 days idle; renewed when more than half the idle window has passed. Expired sessions are deleted by a periodic sweep (Phase 6 cron) and ignored before then.                                                                                                         |
| Verification / reset tokens            | 32 random bytes; SHA-256 stored; single use; purpose-scoped; newer token invalidates older ones.                                                                                                                                                                                         |
| Rate limits                            | Sign-in: 10 / 15 min per IP, 5 / 15 min per email. Register: 5 / h per IP. Reset request: 3 / h per email, 10 / h per IP. Resend verification: 3 / h. Blocked attempts return the same generic message plus "try again later".                                                           |
| Enumeration                            | Identical responses and timing for existing and unknown emails on register, sign-in and reset.                                                                                                                                                                                           |
| CSRF                                   | All mutations are Server Actions, which Next.js protects with origin checks; no auth route handlers.                                                                                                                                                                                     |
| Authorisation                          | `getCurrentUser()` (React `cache`) reads the cookie, loads the session and user; `requireUser()` / `requireRole()` are called inside every action and page that needs them. `proxy.ts` only redirects `/account/*` optimistically when the cookie is absent and is never the sole check. |
| Input                                  | Zod schemas, `.strict()`, trimmed and normalised email.                                                                                                                                                                                                                                  |
| Logging                                | Authentication events are logged as counts and outcomes, never with passwords, tokens or full emails.                                                                                                                                                                                    |
| Accessible authentication (WCAG 3.3.8) | No CAPTCHA, paste allowed, password managers supported via `autocomplete` tokens, a show-password toggle, errors announced and linked to fields.                                                                                                                                         |

---

## 5. Email

`src/server/email/` exposes `sendEmail({ to, subject, text, html })` over a transport chosen by `EMAIL_TRANSPORT`:

- `file` (default outside production): writes each message as JSON into `.mail/` (git-ignored). End-to-end tests read verification and reset links from there.
- `log`: prints to the server log.
- `resend`: Resend with `RESEND_API_KEY` and `EMAIL_FROM`. **Required in production**; the environment validation refuses a production build without it. Resend needs a verified sending domain, which is still outstanding (D2).

Templates are plain text with a minimal HTML version (no images, no tracking). Four messages: verify email, reset password, password changed, "an account already exists".

---

## 6. Files

| Area                  | Files                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server infrastructure | `src/server/auth/{password,session,tokens,rate-limit,current-user}.ts`, `src/server/email/{index,transports,templates}.ts`, `src/proxy.ts`                                            |
| Feature: auth         | `src/features/auth/{schemas,rules,data,service,actions}.ts`, `components/` (sign-in, register, forgot, reset forms using `useActionState`)                                            |
| Feature: account      | `src/features/account/{schemas,data,service,actions}.ts`, `components/` (profile, address book, security)                                                                             |
| Pages                 | `(storefront)/login`, `register`, `verify-email`, `forgot-password`, `reset-password`, `account/` (layout + overview, `profile`, `addresses`, `security`)                             |
| Header                | Account link (signed-out: "Sign in"; signed-in: "Account") in the utility slot reserved in Phase 1                                                                                    |
| Schema                | Migration 4: sessions, verification tokens, rate-limit buckets, user columns                                                                                                          |
| Env                   | `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`. No signing secret is needed: session and verification tokens are random values checked against stored hashes, not signed payloads. |

---

## 7. Tests

- **Unit:** password rules, token generation and hashing, expiry and renewal arithmetic, return-path validation (rejects `//evil`, `http://…`, `javascript:`), rate-limit window maths, email template rendering (no token leaks into subjects).
- **Integration (real PostgreSQL):** register/sign-in/sign-out/verify/reset/change-password services; identical responses for unknown emails; token single use and invalidation; session revocation and renewal; rate limiter across windows; address CRUD including the one-default rule; `requireRole` rejections.
- **End-to-end:** register → read the verification link from `.mail/` → verified account; sign-in with a wrong password shows the generic message; protected route redirects to `/login?next=…` and returns after sign-in; sign-out; forgot → reset → sign-in with the new password; address add/edit/default/delete; sessions list and "sign out everywhere"; too many attempts shows the retry message; keyboard pass and axe on every auth and account page; the header reflects the signed-in state.

---

## 8. Acceptance criteria

1. Every gate passes with real output: typecheck, lint, format, unit, integration, build, e2e; CI green.
2. No password, token or session value ever appears in logs, URLs (other than the one-time links), or client bundles.
3. All flows above work without JavaScript except the show-password toggle.
4. axe reports zero violations on auth and account pages; forms are usable with a screen reader and password manager.
5. Rate limits and enumeration protections are demonstrated by tests, not asserted in prose.
6. The production environment refuses to start without a real email transport.

---

## 9. Implementation notes (Better Auth 1.7.14)

### Verification performed before building

| Owner's check                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js App Router, Prisma 7.10, `@prisma/adapter-pg` | Peer ranges declare Next 16, Prisma 7 and Vitest 5. `prismaAdapter(db, { provider: "postgresql" })` works over the existing driver-adapter client. Better Auth validates the Prisma schema at startup and reports mismatches precisely (it caught a missing `rate_limits.id`).                                                                                                                        |
| Existing `User` model                                 | Reused as is: Better Auth maps to Prisma model `User` (client property `user`). `role` and `phone` are declared as `additionalFields` with `input: false`, so the server owns them. `emailVerifiedAt` became `emailVerified Boolean`; the unused `passwordHash` moved to `accounts.password`. No duplicate user rows: `tests/integration/auth.test.ts` asserts a single row after duplicate sign-ups. |
| Database sessions, listing, revocation                | `sessions` table; `auth.api.listSessions`, `revokeSession({ token })`, `revokeOtherSessions`, `revokeSessions` all exercised. Cookie cache is disabled, so revocation is immediate.                                                                                                                                                                                                                   |
| Verification, reset, change                           | Verification link (24 h), reset link (30 min, single use, revokes all sessions), change password (revokes others and **rotates the current session**: a new cookie is issued).                                                                                                                                                                                                                        |
| Authorisation in our layer                            | `src/server/auth/current-user.ts` (`getCurrentUser`, `requireUser`, `requireRole`) and the account data layer scope every query by the verified user id. `proxy.ts` is cookie-presence only.                                                                                                                                                                                                          |

### Where the original design changed

- **Password policy** runs inside a Better Auth `hooks.before` on `/sign-up/email`, `/reset-password` and `/change-password`, so it covers server-side calls (verified) as well as HTTP. Hashing uses Better Auth's default scrypt (OWASP-acceptable) rather than Argon2id, avoiding a native dependency.
- **Compromised passwords** (P3): local rules (length, not your email/name, common/predictable list) plus a Have I Been Pwned k-anonymity lookup that **fails open** and is on only when `PASSWORD_BREACH_CHECK=hibp` (production default). Better Auth's own HIBP plugin fails closed, which would block registration during an outage, so it is not used.
- **HTTP surface:** every Better Auth endpoint except `/verify-email`, `/ok` and `/error` answers 404 over HTTP (hook on `ctx.request`). Sign-in, registration, reset and session management go through Server Actions, which add the PostgreSQL rate limits (D5) and generic responses. Better Auth's built-in limiter still guards the remaining HTTP paths.
- **Duplicate registration** (requirement 5): with `autoSignIn: false`, Better Auth returns an identical generic response for new and existing emails and performs a dummy hash for timing. No email is sent to the existing holder. Registration therefore never signs the customer in; the success screen offers sign-in (allowed before verification, P1).
- **Absolute session lifetime** (P4): Better Auth has no cap, so `getCurrentUser()` revokes sessions older than 30 days; the 14-day idle timeout is Better Auth's `expiresIn` with daily refresh.
- **IP addresses** are not stored (`disableIpTracking`); rate-limit keys hash the address and the normalised email.
- **Email** (requirement 6): `EMAIL_TRANSPORT` must be `resend` in production, but a missing `RESEND_API_KEY` fails only when a message is actually sent, not at build time. The file transport (`.mail/`) powers development and tests.
- **Optional phone at registration** is written by the app only when the user row was created by that very call (`createdAt` within 10 s and `phone` null), so a duplicate attempt can never alter an existing account.

### Migration and rollback

Migration `20261031150000_better_auth_sessions_accounts` adds `sessions`, `accounts`, `verifications` and `rate_limits`, and alters `users` (adds `email_verified`, `image`; drops the never-used `password_hash`, `email_verified_at`). `rollback.sql` beside it reverses the change; it was exercised on both local databases during development (tables dropped, `_prisma_migrations` row deleted, migration re-applied, zero drift).

### Dependencies added

`better-auth@1.7.14` (runtime). Nothing else: Resend is called over its REST API with `fetch`, and no password-hashing or validation libraries were added.

### Security checklist

| Requirement               | How it is met                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cookies                   | Better Auth session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production (`__Secure-` prefix).                                                                                                                                       |
| CSRF                      | All mutations are Server Actions (Next.js origin checks); Better Auth's HTTP handler also checks `Origin` against `trustedOrigins`.                                                                                                        |
| Session fixation          | A new session token is issued on every sign-in; password change rotates the session; reset revokes all sessions.                                                                                                                           |
| IDOR                      | Account data access takes the verified user id in every query (`tests/integration/account.test.ts` proves cross-user reads, edits, promotions and deletes fail). Session revocation only accepts tokens that belong to the signed-in user. |
| Privilege escalation      | `role` is `input: false`: Better Auth rejects it from any input (tested). Role changes are admin-only (Phase 7) and will revoke the user's sessions.                                                                                       |
| Authorisation placement   | Pages, layouts and actions call `requireUser`/`requireRole`; `proxy.ts` is optimistic only.                                                                                                                                                |
| Enumeration               | Generic responses on register, sign-in and reset; dummy hashing on duplicate sign-up; no email to existing holders.                                                                                                                        |
| Rate limiting             | PostgreSQL counters per IP and per hashed email for sign-in, registration, reset and verification resend; temporary blocks only; `cleanupRateLimits()` for the Phase 6 sweep.                                                              |
| Secrets                   | `BETTER_AUTH_SECRET` ≥ 32 chars, validated and never echoed; no secrets in client bundles.                                                                                                                                                 |
| Accessible authentication | Labels, `autocomplete` tokens, show/hide password, errors linked to fields and announced, no CAPTCHA, paste allowed.                                                                                                                       |
