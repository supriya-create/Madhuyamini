# Madhuyamini — Cart and Wishlist

Status: **Implemented (Phase 5)** · approved and built 31 Oct 2026. Sections 1–7 are the approved proposal; §8 records what was built and where it differs.

Scope: a persistent shopping cart for guests and signed-in customers, cart merging on sign-in, server-computed totals, stock-aware quantities, a cart page and header count, add-to-cart on product pages, and a signed-in wishlist. Not in this phase: checkout, payments, coupons, shipping or tax calculation, stock reservation (all Phase 6), and admin tooling (Phase 7).

---

## 1. Decisions needed first

| #   | Question                                               | Recommendation                                                                                                                                          |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Maximum quantity per line                              | 10, and never more than is available. One-of-a-kind pieces are capped at 1.                                                                             |
| C2  | Guest cart lifetime                                    | 30 days from last activity, then eligible for cleanup. Signed-in carts persist until converted.                                                         |
| C3  | Wishlist for guests?                                   | No. Wishlists belong to accounts; guests see a sign-in prompt. (Guest wishlists need another cookie-bound store for little benefit.)                    |
| C4  | Does adding to the cart reserve stock?                 | No. Stock is held only at checkout (Phase 6, `InventoryReservation`). The cart shows current availability and flags items that can no longer be bought. |
| C5  | Price shown in the cart                                | The variant's current price, read live. Prices are locked only at order creation (Phase 6); the cart says so in one line.                               |
| C6  | Merge rule when a guest signs in with an existing cart | Sum quantities per variant, capped by C1 and availability; the guest cart is then closed and its cookie cleared.                                        |

---

## 2. Data model additions

```prisma
enum CartStatus { ACTIVE  MERGED  CONVERTED  ABANDONED }

model Cart {
  id        String     @id @default(uuid(7)) @db.Uuid
  /// Signed-in owner; null for guest carts.
  userId    String?    @map("user_id") @db.Uuid
  /// SHA-256 of the guest cookie token; null once the cart belongs to a user.
  tokenHash String?    @unique @map("token_hash")
  status    CartStatus @default(ACTIVE)
  expiresAt DateTime?  @map("expires_at")      // guest carts only (C2)
  createdAt DateTime   @default(now()) @map("created_at")
  updatedAt DateTime   @updatedAt @map("updated_at")
  user  User?      @relation(fields: [userId], references: [id], onDelete: Cascade)
  items CartItem[]
  @@index([userId, status])
  @@index([status, expiresAt])
  @@map("carts")
}

model CartItem {
  id        String   @id @default(uuid(7)) @db.Uuid
  cartId    String   @map("cart_id") @db.Uuid
  variantId String   @map("variant_id") @db.Uuid
  quantity  Int      // CHECK 1..10
  addedAt   DateTime @default(now()) @map("added_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  cart    Cart           @relation(fields: [cartId], references: [id], onDelete: Cascade)
  variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Restrict)
  @@unique([cartId, variantId])
  @@map("cart_items")
}

model WishlistItem {
  id        String   @id @default(uuid(7)) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  productId String   @map("product_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at")
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  @@unique([userId, productId])
  @@map("wishlist_items")
}
```

Database rules in the migration: `CHECK (quantity BETWEEN 1 AND 10)`; at most one `ACTIVE` cart per user (partial unique index on `user_id WHERE status = 'ACTIVE'`); exactly one of `user_id` / `token_hash` set while `ACTIVE`. A variant with cart lines cannot be deleted (Restrict); archiving a product leaves lines in place and the cart flags them.

---

## 3. Behaviour

**Identity of a cart.** Guests get a 256-bit random token in an `HttpOnly; Secure; SameSite=Lax` cookie (30 days); only its SHA-256 is stored. Signed-in customers' carts are found by user id, never by cookie. On sign-in (and after registration sign-in), the guest cart is merged into the user's active cart per C6, marked `MERGED`, and the cookie cleared.

**Adding.** The product page's variant selector gains quantity and "Add to cart" (a Server Action that also works without JavaScript). The server re-reads the variant (active, product active), checks availability (`stockOnHand - reserved`), applies C1, upserts the line in a transaction, and returns the new line count. The header count and a small confirmation update without a full reload.

**Cart page.** Lines with image, title, options, unit price (live, C5), quantity control (select 1–10 or stepper), line total, remove; subtotal in paise formatted with `formatINR`; a note that shipping and taxes are calculated at checkout (Phase 6); lines that are no longer purchasable are kept but flagged ("Sold out" / "No longer available") and excluded from the subtotal, with a one-click remove. Empty state links to collections.

**Wishlist.** Heart toggle on product cards and the product page (signed-in; guests get a sign-in link that returns to the page). `/account/wishlist` lists saved products with "Add to cart" and remove. Product-level (C3), because variants change.

**Cleanup.** `cleanupCarts()` closes guest carts past `expiresAt`; scheduled with the other sweeps in Phase 6.

---

## 4. Security and correctness

| Concern          | Decision                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prices and stock | Never from the client. Lines store `variantId` and `quantity` only; prices are read from `ProductVariant` on every render and locked only at order creation.                   |
| Ownership        | Guest carts are reachable only with the cookie token (hashed lookup); user carts only through `requireUser()`. All mutations take the cart from the request, never from input. |
| Input            | Zod: `variantId` UUID, `quantity` integer 1–10, strict objects.                                                                                                                |
| Abuse            | Cart mutations rate-limited per cart (e.g. 60/min) using the Phase 4 limiter; no account lockouts.                                                                             |
| Concurrency      | Line upserts run in a transaction keyed by `(cartId, variantId)`; availability is re-checked at checkout, so a race here cannot oversell.                                      |
| Cookies          | Guest token cookie attributes as above; rotated on merge; cleared on sign-out? No: a guest cart created while signed out is independent of the account and survives sign-out.  |
| Privacy          | Carts hold no personal data; guest carts expire.                                                                                                                               |

---

## 5. Files

| Area              | Files                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Schema            | Migration 5: carts, cart_items, wishlist_items (+ rollback.sql)                                                                    |
| Feature: cart     | `src/features/cart/{schemas,rules,data,service,actions,types}.ts`, `components/` (AddToCart, CartLine, CartSummary, MiniCartCount) |
| Feature: wishlist | `src/features/wishlist/{data,service,actions}.ts`, `components/WishlistToggle.tsx`                                                 |
| Server            | `src/server/cart/cookie.ts` (token issue/read/clear, hashed), hook into sign-in action for merging                                 |
| Pages             | `/cart`, `/account/wishlist`; product page gains quantity + add-to-cart; header gains the cart link with count                     |
| Pending routes    | `/cart` leaves `e2e/pending-routes.ts`                                                                                             |

---

## 6. Tests

- **Unit:** totals and formatting, quantity clamping (C1), merge arithmetic (C6), purchasability flags.
- **Integration:** add/update/remove with stock caps, one-of-a-kind cap, unique line per variant, guest token lookup and ownership (a token cannot read another cart), merge on sign-in including caps, flagged lines when a product is archived or stock hits zero, wishlist uniqueness and ownership, cleanup.
- **End-to-end:** add from the product page (with and without JavaScript), header count, cart page quantity change and remove, persistence across reload, guest cart merged after sign-in, sold-out line flagged, wishlist toggle and page, axe on cart and wishlist pages, keyboard operation of the quantity control.

---

## 7. Acceptance criteria

1. Every gate passes with real output; CI green.
2. No price or stock value is ever accepted from the client; proven by tests that submit tampered values.
3. A guest cart survives reload and browser restart within 30 days and merges correctly on sign-in.
4. Lines that stop being purchasable are flagged, never silently dropped.
5. axe reports zero violations on cart and wishlist pages; the quantity control and add-to-cart are keyboard operable.

---

## 8. Implementation notes (31 Oct 2026)

Decisions C1–C6 were approved with these refinements, all implemented: C1 max 10 per variant, one-of-a-kind limited to 1, never above available stock, validated on the server; C2 30 days from last activity, refreshed on every valid activity; C3 accounts only; C4 no reservation on add; C5 live prices with an explicit price-change notice; C6 quantities merged per variant with limits applied and nothing discarded.

**Where the build differs from §2–§5**

| Proposal                                        | Built                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CartItem` stores `variantId` + `quantity` only | Also `priceSeenInPaise`: the price when the line was added or last acknowledged. It is **never charged**; it only drives the "price changed from X to Y" notice and the "Got it" acknowledgement (C5). The live price is read on every render.                                                                       |
| `Cart.expiresAt` only                           | Plus `lastActivityAt`; both move forward on every successful mutation (C2). The guest cookie is re-issued with a fresh 30-day `Max-Age` on each guest mutation, so the cookie and the cart expire together.                                                                                                          |
| `src/server/cart/cookie.ts`                     | `src/server/cart/token.ts` (random 256-bit token, SHA-256 hash, plausibility check; unit-tested) and `src/server/cart/context.ts` (`resolveCartContext`: session first, then cookie; cookie issue/renew/clear). The cookie is `__Host-my_cart` in production (`Secure`, `Path=/`, no `Domain`), `my_cart` elsewhere. |
| "Returns the new line count"                    | `AddToCartResult { quantityAdded, quantityInCart, limitedBy, itemCount }`, so the form can say "Only 3 available, so your cart now holds 3" or "already in your cart" rather than silently clamping.                                                                                                                 |
| Hearts on product cards and the product page    | Product page and the wishlist page (where the heart removes). Cards in listings do not have hearts yet; see follow-ups.                                                                                                                                                                                              |
| Wishlist page with "Add to cart"                | Lists saved pieces with Remove; adding goes through the product page because most pieces need a variant choice.                                                                                                                                                                                                      |
| MiniCartCount component / client state          | The header count is a Server Component (`getCartItemCount`) refreshed by `revalidatePath` after every cart action. No client store was needed.                                                                                                                                                                       |

**Correctness and security as built**

- **Atomic add:** `addToCart` finds or creates the cart (the partial unique index settles a concurrent first add), then runs the read-modify-write under `SELECT … FOR UPDATE` on the cart row, so two quick taps add twice instead of losing one. Stock, status and price are re-read inside the same request.
- **Stale tokens:** a cookie that outlives its cart (expired, merged, abandoned) gets a fresh cart; the old row's `token_hash` is released first so the unique index is honoured.
- **Merge (C6):** one transaction; the guest cart is claimed with `UPDATE … WHERE status = 'ACTIVE'` (0 rows → already merged, nothing happens), the target cart row is locked, and each line becomes `min(existing + incoming, cap)` further capped by stock when purchasable. An unpurchasable line keeps its quantity and is flagged rather than dropped. A merge that reduced any quantity redirects to `/cart?cart=adjusted` with a notice; otherwise sign-in continues to its normal destination. A failed merge never blocks sign-in: the cookie is kept and the merge retried on the next sign-in.
- **Ownership:** every mutation resolves the cart from the request and addresses lines as `(cartId, lineId)`; a line id from another cart, another token or an anonymous visitor is "not found". Covered by integration tests.
- **Input:** Zod strict objects; `quantity` is coerced and bounded (1–10 for add, 0–10 for update where 0 removes); an e2e test submits a tampered `99` and asserts the server rejects it.
- **Abuse:** 60 mutations per minute per cart identity (user id or guest token) through the Phase 4 limiter. Reads are not limited.
- **Unavailable lines** (archived product, inactive variant, no stock, less stock than chosen) stay visible with a status message, are excluded from the subtotal, and set `canCheckout = false`; Phase 6 will refuse to start checkout while `hasAvailabilityIssues` is true.
- **Privacy:** `/cart` and `/account/wishlist` are `noindex`; carts hold no personal data.

**Files:** `prisma/migrations/20261031170000_carts_and_wishlist` (+ `rollback.sql`) · `src/features/cart/{rules,schemas,types,action-state,data,service,actions}.ts` · `src/features/wishlist/{data,service,actions}.ts` · `src/server/cart/{token,context}.ts` · `src/components/cart/*` · `src/app/(storefront)/cart/{page,loading}.tsx` · `src/app/(storefront)/account/wishlist/page.tsx` · sign-in merge hook in `src/features/auth/actions.ts` · header count in `src/components/layout/Header.tsx`.

**Follow-ups:** hearts on listing cards (needs the saved-id set threaded through listing pages); a scheduled `cleanupCarts()` sweep alongside the Phase 6 crons; checkout gating on `canCheckout` (Phase 6); `CONVERTED` status set by order creation (Phase 6).
