# Madhuyamini — Authentication and Customer Accounts

Status: **Proposed for Phase 4, awaiting approval** · 31 Oct 2026

Scope: registration, sign-in, sign-out, email verification, password reset and change, session management, profile and address book, protected routes and role checks. Not in this phase: social or phone sign-in, two-factor authentication (admin, Phase 7), order history (Phase 6), cart merging (Phase 5), newsletter consent (outstanding from Phase 2).

---

## 1. Decisions needed first

### D3 — Authentication approach

| Option                                     | What we get                                                                                                                                                           | What we take on                                                                                                                                       | Verdict                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Custom database sessions** (recommended) | Full control: revocable sessions, our own schema, our own rate limiting, no beta dependency. Inside the brief's stated stack ("secure session-based authentication"). | We own ~600 lines of security code (hashing, tokens, cookies, limits) and must test it exhaustively. No social or phone sign-in without further work. | **Recommended for email + password.**                                                     |
| Better Auth 1.7                            | Email/password, verification, reset, sessions, rate limiting, plus plugins for phone OTP, social and admin roles. Maintained; listed in Next's own guide.             | Stack deviation needing approval; its own tables and routes; upgrade churn; another large dependency in the trust boundary.                           | Choose this **only if phone-OTP or social sign-in is wanted within the next few phases.** |
| Auth.js (NextAuth) v5                      | —                                                                                                                                                                     | Still `5.0.0-beta.32` after three years; credentials sign-in forces stateless JWT sessions, which cannot be revoked server-side.                      | Not suitable for a store.                                                                 |

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
