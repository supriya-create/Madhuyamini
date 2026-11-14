# Phase 8 decision register

Status: **all 18 decisions were approved as recommended by the owner on 2 November 2026** (instruction in the working session: "Approve defaults, start 8.0"). Each "recommended default" below, carried over unchanged from [phase-8-returns-custom-artwork.md](phase-8-returns-custom-artwork.md) §14, is therefore the policy the implementation follows; a later change needs a new owner decision recorded against the ID here. Step 8.0 was authorised at the same time.

Companion: [phase-8-implementation-readiness.md](phase-8-implementation-readiness.md) (dependency graph, risks, rollback, production criteria).

## How to change an approved decision

Reply per decision with one of:

- `D8.n: approved as recommended`
- `D8.n: approved with change — <the rule in your words>`
- `D8.n: use alternative — <which one>`
- `D8.n: defer — <until when>` (only for decisions classified "during implementation" or "not in Phase 8")

Changes are recorded in the "Approval" column below by editing this file in a documentation commit; the policy values go into `src/config/returns-policy.ts` and `src/config/commissions-policy.ts` (both new) during the step named in "Blocks".

## Summary

| ID    | Decision                                        | Group | Classification                                                                      | Approval                                                                                                    |
| ----- | ----------------------------------------------- | :---: | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| D8.1  | Return window                                   |   A   | During implementation (value); mandatory before launch                              | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.2  | Non-returnable categories                       |   A   | During implementation (value); mandatory before launch                              | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.3  | Guest returns                                   |   E   | Blocks the start of step 8.1 if changed; not needed for launch if default stands    | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.4  | Exchange eligibility and stock holding          |   B   | Blocks the start of step 8.3                                                        | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.5  | Return shipping cost responsibility             |   D   | During implementation (8.2); mandatory before launch                                | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.6  | Refund of the original shipping charge          |   A   | During implementation (8.2); mandatory before launch                                | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.7  | Damage deduction ceiling and evidence           |   A   | During implementation (8.2); mandatory before launch                                | Approved as recommended (owner, 2 Nov 2026); base clarified 12 Nov 2026 (step 8.2 Q3)                       |
| D8.8  | COD refund method                               |   E   | Blocks the start of step 8.2; mandatory before launch                               | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.9  | Return parcel lost in transit                   |   A   | During implementation (8.4); mandatory before launch                                | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.10 | Shipping on replacement orders                  |   D   | During implementation (8.3); mandatory before launch                                | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.11 | Commission payment methods and deposit          |   C   | Blocks the start of step 8.6; mandatory before launch                               | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.12 | Artist assignment and commission model          |   C   | During implementation (8.5); not needed for launch                                  | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.13 | Quotation tax and invoice lines                 |   C   | During implementation (8.6); mandatory before launch                                | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.14 | Commission cancellation rules                   |   C   | During implementation (8.8); mandatory before launch                                | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.15 | Commission returns                              |   C   | During implementation (8.8); mandatory before launch                                | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.16 | Quotation validity and revisions                |   C   | During implementation (8.6); mandatory before launch                                | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.17 | Carrier tracking synchronisation                |   D   | Not in Phase 8 unless approved; never blocks                                        | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.18 | Guest commission requests                       |   E   | Blocks the start of step 8.5 if changed; not needed for launch if default stands    | Approved as recommended (owner, 2 Nov 2026)                                                                 |
| D8.19 | Refund timing of repaired and quarantined units |   A   | Blocks the start of step 8.2 sub-step 7 (held units) only; the rest of 8.2 proceeds | Pending owner approval (revised 12 Nov 2026, step 8.2 revision 6; engineering pass 14 Nov 2026, revision 7) |

"Blocks the start of step X" means the default and the alternatives lead to different data models or transaction designs, so the step cannot be coded safely before the owner chooses. "During implementation" means the code supports the default and the alternatives through policy values or flags, so the step can be built while the owner decides, and the chosen value is set before the step's acceptance test. "Mandatory before launch" means the rule is customer-facing or financial and must be final, and stated on the policy pages (Phase 9), before Razorpay live activation.

---

## A. Returns and refunds

### D8.1 Return window

- **Why required:** eligibility (`returnEligibility`, proposal §3.1) is evaluated against `returnsPolicy.windowDays` at submission; the e-mail copy and the policy page quote it; the Consumer Protection (E-Commerce) Rules require the return policy to be stated.
- **Recommended default (not approved):** 7 days from the delivery date for all categories; damage on arrival to be reported within 48 hours, inside those 7 days.
- **Alternatives:** 10 or 14 days; category-specific windows (longer for clothing, shorter for décor); a separate longer window for exchanges.
- **Financial implications:** longer windows raise return volume, refund outflow and stock held in quarantine; shorter windows raise disputes and support contacts.
- **Customer experience:** the window end date is shown on the account order page; a closed window shows a plain-words reason and the support contact.
- **Security and operations:** none beyond the policy value; a late-window request can be created by staff with a reason (D8.9 flow in step 8.4), which is audited.
- **Dependencies:** policy page text (Phase 9); e-mail templates.
- **Classification:** during implementation (a value in `returns-policy.ts`); **mandatory before production launch**.
- **Exact approval required:** the number of days, whether it differs by category, and the damage-report deadline.

### D8.2 Non-returnable categories

- **Why required:** `returnsPolicy.nonReturnableCategorySlugs` decides which lines the form offers; one-of-a-kind originals need their own rule; the policy page must list the exceptions.
- **Recommended default (not approved):** no catalogue category is non-returnable; commission products are governed by D8.15; one-of-a-kind originals are returnable only for damage on arrival or wrong item.
- **Alternatives:** exclude accessories or sale items; exclude all wall art; make originals fully returnable.
- **Financial implications:** exclusions reduce refunds and the handling of fragile art; they also reduce conversion for first-time buyers of originals.
- **Customer experience:** ineligible lines say why; damage and wrong-item reasons still work for every category (proposal §3.4).
- **Security and operations:** slugs resolved to ids at startup; renaming a category must keep the slug or the policy is updated in the same change.
- **Dependencies:** category slugs in the seed and the live catalogue; policy page.
- **Classification:** during implementation; **mandatory before production launch**.
- **Exact approval required:** the list of excluded categories (or "none") and the rule for one-of-a-kind originals.

### D8.6 Refund of the original shipping charge

- **Why required:** `H_refund` in the settlement arithmetic (proposal §4.3) has a mode: never, when the shop is at fault, or always; the breakdown line is shown to the customer.
- **Recommended default (not approved):** refunded only when the shop is at fault (damage on arrival, wrong item, not as described) or when every unit of the order has been returned and accepted.
- **Alternatives:** never refund shipping; always refund shipping on any accepted return.
- **Financial implications:** ₹99 per affected order today (`checkoutPolicy.shipping.flatInPaise`), free above ₹1,999; small per order, visible in aggregate.
- **Customer experience:** the breakdown names the shipping line and the reason it is or is not refunded.
- **Security and operations:** none.
- **Dependencies:** D8.5 (who pays return shipping) for consistent wording.
- **Classification:** during implementation (8.2); **mandatory before production launch**.
- **Exact approval required:** the mode, and whether the COD fee (currently ₹0) follows the same rule.

### D8.7 Damage deduction ceiling and evidence

- **Why required:** the inspection form allows a deduction per item only within `deductions.maxPercentOfLine` and only with a reason and staff photograph; damage-on-arrival and wrong-item lines refuse deductions by CHECK (proposal §7.2).
- **Recommended default (not approved):** up to 30 % of the unit value, with a reason from a fixed list and at least one staff photograph; never on damage-on-arrival or wrong-item lines.
- **Alternatives:** no deductions at all (refuse the return or accept it in full); a higher ceiling such as 50 %; a fixed-amount schedule per category.
- **Financial implications:** deductions recover part of the loss on used or damaged returns; they also create disputes and chargebacks if applied loosely.
- **Customer experience:** the deduction appears as its own breakdown line with the reason; the customer sees the staff photograph on the return page.
- **Security and operations:** deductions are ADMIN-settled with a fresh second factor, evidenced and audited; per-actor limits apply.
- **Dependencies:** staff photograph upload (step 8.1 ledger).
- **Classification:** during implementation (8.2); **mandatory before production launch**.
- **Exact approval required:** the ceiling percentage (or "no deductions"), the reason list, and the evidence rule.
- **Clarification (owner, 12 November 2026, step 8.2 Q3):** the ceiling's base is the value of the line's accepted units after proportional discount allocation (`G_i` in proposal §4.3); shipping, the COD fee, other lines and the order total never increase it. The reason list and the evidence rule were approved with Q3 on the same day.

### D8.9 Return parcel lost in transit

- **Why required:** `LOST` closes an `IN_TRANSIT`/`OVERDUE` request; the settlement rule decides whether a refund is queued without goods received (proposal §3.3 R11).
- **Recommended default (not approved):** refund as declared when the customer provides carrier tracking proof and used the instructed carrier; otherwise close without a refund and point the customer to the carrier claim.
- **Alternatives:** always refund (shop absorbs carrier losses); never refund (customer bears the carrier risk).
- **Financial implications:** direct loss exposure equal to the item value per lost parcel; carrier claims may recover part of it.
- **Customer experience:** the instructions e-mail states the rule before the customer ships.
- **Security and operations:** ADMIN sensitive operation with the carrier reference recorded; fraud pattern (claimed shipments that never existed) is bounded by the proof requirement and per-customer history visible in the admin.
- **Dependencies:** D8.5 (prepaid labels make proof automatic).
- **Classification:** during implementation (8.4); **mandatory before production launch**.
- **Exact approval required:** the rule and what counts as proof.

---

## B. Exchanges

### D8.4 Exchange eligibility and stock holding

- **Why required:** three design choices depend on it: whether the customer form offers variants of the same product only (`exchanges.sameProductOnly`), the maximum price difference the customer may pay (`differenceMaxInPaise`), and **when replacement stock is held**. The proposal holds no stock before inspection (proposal §5.4); holding at approval needs a reservation with a multi-week expiry, which the Phase 6 reservation model (minutes-scale `expiresAt`, sweep every 5 minutes) does not support without changes.
- **Recommended default (not approved):** same product, different variant only; difference up to ₹5,000; no stock hold before inspection, stock confirmed at settlement.
- **Alternatives:** any product (credit applied to any variant); hold stock at approval (requires a new long-lived hold kind and starves the storefront); exchanges disabled in Phase 8 (returns only).
- **Financial implications:** no hold means an occasional "replacement unavailable, refunded instead" outcome; holds mean unsold stock for weeks.
- **Customer experience:** the form states that stock is confirmed at inspection; a failed replacement is explained in the closing e-mail with the refund.
- **Security and operations:** replacement orders are ordinary orders with a `kind`; the credit cap and unique replacement guards are independent of this decision.
- **Dependencies:** D8.10 (replacement shipping).
- **Classification:** **blocks the start of step 8.3** (the hold timing changes the inventory design); 8.0–8.2 proceed regardless.
- **Exact approval required:** same-product-only or any product; the maximum difference; hold at approval or at settlement; or "no exchanges in Phase 8".

---

## C. Custom artwork and commissions

### D8.11 Commission payment methods and deposit

- **Why required:** the instalment-order design (proposal §6.5, §6.6) assumes online payment for both the deposit and the balance; a COD balance would need a COD instalment order with cash collection on delivery and a different cancellation exposure. The deposit percentage is a per-category value bounded by `commissionsPolicy.minDepositPercent`.
- **Recommended default (not approved):** online only; deposit per category, recommended 50 %; balance paid before dispatch.
- **Alternatives:** 30 % deposit; 100 % upfront (no balance order); COD for the balance (cash on delivery of the piece).
- **Financial implications:** deposit size sets the exposure on abandoned commissions; COD balance adds refusal risk on a one-of-a-kind piece that cannot be resold at the quoted price.
- **Customer experience:** the quotation page states the deposit, the balance and when each is due.
- **Security and operations:** online-only keeps the Phase 6 capture verification for every rupee; COD would reuse the Phase 7 cash collection flow but needs a return-to-origin rule for refused commissions.
- **Dependencies:** D8.14 (cancellation), D8.16 (validity).
- **Classification:** **blocks the start of step 8.6**; mandatory before production launch.
- **Exact approval required:** online only or COD balance allowed; the minimum deposit percentage the system enforces; whether a category may require 100 % upfront.

### D8.12 Artist assignment and commission model

- **Why required:** the `artists` table and `assigned_artist_id` exist for scheduling and the public artist pages (Phase 9); whether the application records an artist's share per commission decides whether that data falls under financial audit and reports.
- **Recommended default (not approved):** internal assignment only; no payout or share recorded in the application.
- **Alternatives:** record a `commission_share_percent` per commission for bookkeeping (no payments made by the system); full payout tracking (out of scope for Phase 8).
- **Financial implications:** none in the application under the default; a recorded share becomes a reported figure.
- **Customer experience:** the artist's name is shown only when the profile is public.
- **Security and operations:** a recorded share is ADMIN-only and audited.
- **Dependencies:** none.
- **Classification:** during implementation (8.5, additive column); not needed for launch.
- **Exact approval required:** whether to record a share, and who may see it.

### D8.13 Quotation tax and invoice lines

- **Why required:** `custom_artwork_quotations` has an optional `tax_in_paise` and quotation lines may carry a GST line; the catalogue applies included tax only where a product carries a rate (checkout §4). Commissioned art may fall under a different rate or exemption; the accountant must confirm.
- **Recommended default (not approved):** show GST as a separate quotation line only once the accountant confirms the rate for commissioned art; otherwise prices are quoted inclusive with no tax line.
- **Alternatives:** always inclusive; always a separate line at the catalogue's default rate.
- **Financial implications:** invoice correctness and GST filing; a wrong treatment is costly to correct after payment.
- **Customer experience:** the quotation shows either an inclusive total or an itemised tax line; both are clear.
- **Security and operations:** none.
- **Dependencies:** the accountant's answer (proposal §15).
- **Classification:** during implementation (8.6); **mandatory before production launch**.
- **Exact approval required:** inclusive or itemised, and the rate if itemised.

### D8.14 Commission cancellation rules

- **Why required:** the cancellation service computes refunds from the rule snapshotted on the accepted quotation (proposal §6.8); the rule is shown to the customer before acceptance and before confirming a cancellation.
- **Recommended default (not approved):** customer cancellation: full deposit refund before production starts; 50 % of the deposit after the sketch stage; no refund after preview approval. Shop-side cancellation: full refund of everything paid.
- **Alternatives:** no refund after acceptance; full refund until preview approval; a flat cancellation fee.
- **Financial implications:** exposure on abandoned work versus perceived fairness; refunds flow through the existing engine and are capped by captures.
- **Customer experience:** the rule is a snapshot, so a later category change never surprises an existing commission.
- **Security and operations:** shop-side cancellation is ADMIN sensitive; refunds are audited.
- **Dependencies:** D8.11 (deposit size), production stages (8.7).
- **Classification:** during implementation (8.8; the snapshot field exists from 8.6); **mandatory before production launch**.
- **Exact approval required:** the refund rule per stage, for customer and for shop cancellations.

### D8.15 Commission returns

- **Why required:** `custom_artwork_categories.returnable` and the returns eligibility rule exclude or include delivered commissions; the policy page must state it.
- **Recommended default (not approved):** not returnable, except damage in transit or a piece that does not match the approved preview (assessed by staff against the approval evidence).
- **Alternatives:** returnable within the standard window like catalogue items; never returnable.
- **Financial implications:** a returned commission has no resale value at the quoted price; the exceptions protect the customer against shipping damage and non-conformance.
- **Customer experience:** the quotation and the commission page state the rule.
- **Security and operations:** the approval record (immutable preview hash) is the evidence for non-conformance claims.
- **Dependencies:** D8.1 (window applies to the exceptions), 8.2 refund arithmetic.
- **Classification:** during implementation (8.8); **mandatory before production launch**.
- **Exact approval required:** the rule and the exceptions.

### D8.16 Quotation validity and revisions

- **Why required:** per-category `quotation_validity_days`, `included_revisions` and lead-time ranges bound by `commissionsPolicy` maxima; the expiry job and the revision counter enforce them.
- **Recommended default (not approved):** quotations valid 14 days; 2 included revisions; delivery estimate per category of 21–45 days, shown as an estimate, never a promise.
- **Alternatives:** 7-day validity; 1 revision; fixed delivery dates with a penalty rule (not recommended).
- **Financial implications:** more revisions cost artist time; longer validity delays scheduling.
- **Customer experience:** the quotation shows the expiry date, the revisions included and what a change order costs.
- **Security and operations:** none.
- **Dependencies:** none.
- **Classification:** during implementation (8.6, category values); **mandatory before production launch**.
- **Exact approval required:** validity days, included revisions, the lead-time ranges per category, and the wording "estimate".

### D8.18 Guest commission requests

- **Why required:** acceptances, approvals and payments need a durable identity; the proposal makes commissions accounts-only (`custom_artwork_requests.user_id` required).
- **Recommended default (not approved):** accounts only; the `/custom-artwork` page asks guests to sign in or register before the form.
- **Alternatives:** allow guest requests with e-mail verification and convert to an account at acceptance (needs a guest identity model similar to order access tokens, plus a conversion flow).
- **Financial implications:** none directly; fewer abandoned requests under the alternative, more support work.
- **Customer experience:** one registration step before a request.
- **Security and operations:** accounts keep ownership checks uniform; guest identity would add a token-based surface for private files and messages.
- **Dependencies:** none.
- **Classification:** **blocks the start of step 8.5 only if the alternative is chosen** (the data model changes); not needed for launch under the default.
- **Exact approval required:** accounts only, or guest requests with e-mail verification.

---

## D. Shipping and fulfilment

### D8.5 Return shipping cost responsibility

- **Why required:** the approval step snapshots who pays and whether a shop label is provided; the settlement arithmetic has a `RETURN_SHIPPING_CHARGE` line (`labelChargeInPaise`) when the customer pays through a shop label (proposal §4.3).
- **Recommended default (not approved):** the shop pays (prepaid label or reimbursement) when at fault (damage on arrival, wrong item, not as described); the customer pays otherwise, deducted at `labelChargeInPaise` when a shop label is used.
- **Alternatives:** the shop always pays; the customer always pays; a flat return fee for change-of-mind returns.
- **Financial implications:** a direct cost per return; the label charge is a policy value.
- **Customer experience:** the instructions e-mail states who pays before the customer ships; the breakdown shows the charge when applied.
- **Security and operations:** labels are staff-uploaded private files; reimbursement of customer-paid postage (if chosen) needs an amount field and evidence, which the proposal does not include and would be a small addition to 8.2.
- **Dependencies:** D8.6 (original shipping refund), D8.9 (proof of shipment).
- **Classification:** during implementation (8.2); **mandatory before production launch**.
- **Exact approval required:** the rule, the label charge amount, and whether postage reimbursement is offered.

### D8.10 Shipping on replacement orders

- **Why required:** `H_x` in the exchange money rules (proposal §5.3) is either free or the standard `shippingCharge` over the replacement subtotal.
- **Recommended default (not approved):** free when the shop is at fault; otherwise the standard charge over the replacement subtotal (free above the free-shipping threshold).
- **Alternatives:** always free; always charged.
- **Financial implications:** per-exchange cost of ₹99 at today's policy.
- **Customer experience:** the replacement order shows its shipping line like any order; a difference due includes it.
- **Security and operations:** none.
- **Dependencies:** D8.4.
- **Classification:** during implementation (8.3); **mandatory before production launch**.
- **Exact approval required:** the rule.

### D8.17 Carrier tracking synchronisation

- **Why required:** inbound return parcels are tracked by numbers typed by the customer or staff; a carrier API would update status automatically and detect lost parcels earlier, at the cost of an integration, credentials and a job.
- **Recommended default (not approved):** not in Phase 8; tracking numbers recorded manually.
- **Alternatives:** integrate one carrier API in a later step; integrate an aggregator.
- **Financial implications:** integration and subscription cost versus staff time checking tracking pages.
- **Customer experience:** manual recording means status updates lag until staff act.
- **Security and operations:** a carrier API adds secrets, a job and a failure mode.
- **Dependencies:** carrier choice (not a Phase 8 decision).
- **Classification:** not in Phase 8 unless approved; never blocks.
- **Exact approval required:** whether to budget an integration, and with which carrier.

---

## E. Security, retention and operations

### D8.3 Guest returns

- **Why required:** returns are owner-scoped through the signed-in user; guest orders have only the hashed access token. Allowing guest returns extends the token to a request form, evidence uploads and messages (proposal §3.4), which is a larger surface and relies on e-mail-only identity.
- **Recommended default (not approved):** not in Phase 8; guests contact support and staff create the request on their behalf with a reason (step 8.4), audited.
- **Alternatives:** token-based guest returns with the same form; require account creation first (the order would also need linking to the account, which is a separate roadmap follow-up).
- **Financial implications:** support time per guest return under the default.
- **Customer experience:** the tracking page tells guests how to return; no self-service.
- **Security and operations:** the default keeps private uploads and messages behind accounts; the alternative needs token-scoped file ownership and rate limits per token.
- **Dependencies:** the guest-order linking follow-up (roadmap, Phase 6 notes).
- **Classification:** **blocks the start of step 8.1 only if the alternative is chosen** (ownership model and ledger columns change); under the default, nothing blocks and launch does not depend on it.
- **Exact approval required:** no self-service for guests in Phase 8, or token-based self-service.

### D8.8 COD refund method

- **Why required:** COD orders have no provider to refund through; the settlement records a `manual_refunds` row with the method and beneficiary details, encrypted under a new `CUSTOMER_DATA_KEY`, and an ADMIN marks it paid with a reference (proposal §4.6). Store credit is not modelled and would need a new balance system.
- **Recommended default (not approved):** bank transfer (NEFT/IMPS) made by the owner; account details collected in the return form; marked paid with the transfer reference.
- **Alternatives:** UPI id instead of (or as well as) bank details; store credit (not modelled; would add a customer balance ledger and a redemption path at checkout, a separate proposal).
- **Financial implications:** manual work per COD return; no provider fee; errors in typed account numbers are the owner's risk, mitigated by a confirmation field.
- **Customer experience:** the form asks for details once; the return page shows "paid on <date>" with the last four characters.
- **Security and operations:** beneficiary data is sensitive financial information: encrypted at rest, last-four only in the UI, revealed to ADMIN through the audited grant flow, nulled after `retention.beneficiaryDays`; a new production secret (`CUSTOMER_DATA_KEY`) with the same rotation pattern as the TOTP key.
- **Dependencies:** step 8.2; key provisioning before production.
- **Classification:** **blocks the start of step 8.2** (store credit would change the model; UPI vs bank only changes fields); mandatory before production launch.
- **Exact approval required:** bank transfer, UPI, or both; whether store credit must be designed instead; the retention period for beneficiary details (engineering default 30 days after payment).

---

### D8.19 Refund timing of repaired, quarantined and written-off units (raised 3 November 2026 during the step 8.2 review; revised 12 November 2026 to the owner's rule: explicit resolution, never a deemed acceptance; final documentation pass the same day, step 8.2 revision 5; day-58 ambiguity resolved the same day, revision 6; engineering pass on the readiness review, 14 November 2026, revision 7, with no change to the rule or the values)

- **Why required:** the approved proposal (§4.3) refunds repaired and quarantined units at settlement, before the repair or the quarantine check has an outcome, and a refund on a unit later found unacceptable cannot be reversed. The owner's rule of 12 November 2026 settles the principle: inventory disposition, the customer's acceptance of deductions and refund eligibility are three separate recorded decisions, and no money moves on a decision nobody made.
- **Proposed (the owner's rule, pending approval of the exact wording and values):** per unit: restocked at inspection → refunded at settlement; successful repair (`REPAIRED`, restocked at the resolution) → refunded at settlement if recorded by then, otherwise at the outcome; unsuccessful repair → a write-off at the resolution, with its fault determination; quarantine → refunded only after its explicit resolution (`RELEASED` restocks and refunds); shop-fault write-off (`SHOP_FAULT`, at inspection or at a resolution; never a stock movement) → refunded by policy; non-fault write-off (`CUSTOMER_FAULT` or `NO_FAULT`) → no refund by policy, paid only by a separate, separately audited goodwill decision recorded beside the policy decision, once per unit and always at the unit's full value, never a chosen amount; sent back → no refund. The inspector's counts on a line are final once it is inspected; a hold's outcome is recorded on its own `return_held_units` row and moves only the line's held and released counts, so a unit written off from a hold is never added to the line's write-off count and can be counted, and paid goodwill, through exactly one record. **The refund decision is derived from the recorded disposition and fault determination and is never selected by ADMIN**; the database refuses any row in which the three disagree. **Deadline:** at day 14 a unit needs a mandatory ADMIN resolution (accept and restock, repair, write off, send back) or the one documented exception, never a deemed acceptance. Lifecycle per held unit, repair and quarantine alike: `HELD` → `OVERDUE` at `heldUnits.decisionDays` (7; one owner alert per day) → `RESOLUTION_REQUIRED` at `heldUnits.deadlineDays` (14; escalated daily alert; one customer notice of administrative delay that approves nothing); `EXCEPTION` recorded once per unit by ADMIN with a written reason, ending after the original day-14 deadline and at most `heldUnits.exceptionMaxDays` (30) after it whatever day it is granted (the service and the database CHECK test the same two bounds), never extended, and returning to `RESOLUTION_REQUIRED` when it expires, after which resolution is mandatory; `RESOLVED` only by ADMIN. **No transition resets a unit's clock:** the single quarantine-to-repair re-disposition changes the unit's kind only (state, due date, deadline, exception and count unchanged; the date columns are immutable by trigger), so the latest permissible end of any hold is `deadline_at + exceptionMaxDays`, day 44 after inspection, on every path, and day 14 when no exception is recorded; a four-point boundary test records an exception ending at `deadline_at` as refused, one second after it as accepted, exactly at `deadline_at + 30 days` as accepted and one second later as refused, by the service and by the CHECK. **Idempotency:** a unit is paid at most once, by the next settlement when resolved before it, or by refunds queued at the resolution under derived keys when resolved after it, one refund row per unit and captured payment attempt, with a unique value-line index, a unique refund index per unit and attempt, and conditional updates as the database-level guards; a cash-on-delivery amount amended by a late outcome is paid only at the amount the owner saw when marking it paid. The request's other accepted units are refunded at settlement; the original shipping charge is refunded at the first settlement or resolution where D8.6's condition is decidable, and at most once per order. After day 44 no column of a held unit changes; only the daily alert continues until a person resolves it. The customer sees "1 unit held for checks; decision by <date>", then "still being checked; a decision is due by <deadline>", then "taking longer than promised; we will e-mail you when it is resolved".
- **Alternatives:** the proposal's behaviour (refund held units at settlement; rejected by the owner); revision 3's automatic day-14 acceptance (rejected by the owner as an unverified financial decision); a selectable refund outcome at resolution (rejected: inconsistent with the recorded facts unless through the separate goodwill decision); a longer or shorter due date, deadline or exception; more than one exception or an extendable one (rejected: it reopens an indefinite state); fresh due and deadline dates on a re-disposition to repair (revision 5; rejected on the owner's review of 12 November 2026: a second extension in all but name, reaching day 58); a timeout that favours the shop (rejected earlier).
- **Financial implications:** no money leaves for a held unit until a person has recorded its outcome, and then only what policy or a separately audited goodwill decision pays, once; the delay is bounded by 14 days plus one exception of up to 30 days, day 44 after inspection on every path, with no transition that resets it; the residual exposure is a unit left unresolved while the owner leaves an escalated daily alert unanswered, which the Operations page, the dashboard and the reports make visible with its age.
- **Customer experience:** stated dates at every stage; the day-14 notice is an administrative delay, not a decision; the refund of a held unit arrives when it is resolved, which the shop controls; the other units of the request are not delayed.
- **Security and operations:** every resolution, exception and goodwill decision is a sensitive ADMIN operation with a fresh second factor and an audit row; the clock job writes system-actor audit rows and never changes money or stock; the derived keys (the labels `held:<heldUnitId>:attempt:<n>` and `goodwill:<…>:attempt:<n>` turned into version-5 UUIDs by `deriveOperationKey`, since `refunds.operation_key` is a `uuid` column), the unique value-line index and the unique refund index per unit and attempt make a repeated outcome harmless; the mark-paid action for a cash-on-delivery refund is refused when the amount changed since it was displayed; `return_held_units` rows cannot be deleted by the runtime role, the date columns, `exception_until` and `exception_reason` are immutable by trigger, `exceptions_count` never decreases, and a line's inspection counters are immutable once inspected.
- **Dependencies:** step 8.2 sub-step 7; the inspection page gains the fault determination and creates the held-unit rows; `return_held_units` is created by the 8.2 migration and backfilled from `held_qty`.
- **Classification:** during implementation; the values must be set before the step's acceptance test; **mandatory before production launch** (customer-facing timing).
- **Exact approval required:** the rule as worded above (in particular: the refund decision is derived, never selected; a goodwill refund is the only non-policy payment, is a separate audited action and pays the unit's full value, never a chosen amount; a repair outcome recorded after settlement is paid at the outcome, once, one refund row per unit and payment attempt; the same clocks apply to repair and quarantine; the exception runs from the day-14 deadline, once, never extended; no transition, the re-disposition to repair included, resets a unit's dates, so day 44 after inspection is the latest permissible end of any hold), and the values `heldUnits.decisionDays` (7), `deadlineDays` (14), `exceptionMaxDays` (30), `maxExceptions` (1).

## Decisions that are not business decisions

For completeness, the readiness review found engineering defaults that the owner may override but that do not require business approval: evidence and reference-file retention periods (180 and 365 days), beneficiary retention (30 days), consolidation of the three new sweeps into one cron entry, and the e2e upload stub. They are listed under "Outstanding approvals" in the readiness document, not here, so this register stays a faithful copy of §14.
