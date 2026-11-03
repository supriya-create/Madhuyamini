# Step 8.2 decision report: Q1–Q8, revised

Status: **revision 2 (3 November 2026), awaiting the owner's approval. Nothing of step 8.2 is implemented.** Revision 1 was delivered in the working session; this revision answers the owner's six clarifications: no override of an unconfirmed exchange preference (Q1), multiple deductions under one combined ceiling with a dispute window (Q3), a concrete key-rotation procedure (Q5), a dedicated capability for bank details (Q7), deterministic per-unit allocation with sequential consumption (arithmetic), and the consequences of refunding held units (Q8, raised as a separate business decision D8.19). Every example was recomputed under the revised rules.

Companion documents: the [step 8.2 plan](phase-8-step-8.2-plan.md) (revised in the same change) and the [decision register](phase-8-decision-register.md) (D8.19 added as pending).

All amounts are integer paise, with rupees alongside, under the live checkout policy: ₹99 shipping below a ₹1,999 subtotal and free above it, a cash-on-delivery fee of ₹0, a 7-day return window, a 30 % deduction ceiling (D8.7).

---

## Q1. Exchange preference at settlement

**Proposed behaviour.**

- Until step 8.3 ships replacement orders, the request form does not offer "exchange" (policy flag `exchanges.offered = false`; D8.4 stays approved and is honoured by 8.3). So in 8.2 no new exchange preference can be recorded.
- Any item that nevertheless carries an exchange preference (none exist today; the rule protects the future) **cannot be settled as a refund without the customer's explicit confirmation.** Settlement refuses with "customer choice needed". There is **no ADMIN override** that converts the preference, at any age.
- The customer's choice is an action on their return page, offered only after inspection: "Your replacement is not available. Choose: refund this item, or wait for a replacement." The choice is stored on the item with a timestamp and the actor; it is reversible until settlement; the e-mail `return.choice_needed` links to it. A "wait" choice is equally explicit and keeps the item open.
- **Unresponsive customer.** Reminders at 3, 7 and 14 days (engineering defaults). After 30 days without a choice the request is marked "on hold" (open, no clock, visible in the queue under its own tab) and the owner is alerted once. The remedies are human: the owner contacts the customer; when step 8.3 exists and stock returns, the owner fulfils the exchange the customer asked for. The restocked unit is already on the shelf since inspection; the shop holds the customer's money as an open obligation shown on the Operations page. Nothing closes the item as a refund without the customer's own confirmation. If the owner judges a case abandoned after a long period, that is a business write-off handled outside the system and recorded as a staff note, never as a refund the customer did not choose.

**Scenario.** Priya asks to exchange a medium kurta for a large. At inspection the large is sold out. She is e-mailed and chooses "refund this item" on her return page; the ADMIN then settles the refund of the medium's value. Had she chosen "wait", the item stays open until a large is back and 8.3 can ship it.

**Finance.** No effect on amounts; a confirmed refund is the item's value under the normal rules.

**Implications.** Security: owner-scoped, rate-limited customer action; the choice token is the signed-in session, nothing in e-mails. Operations: one more sub-state in the queue; an on-hold tab. Customer: money never replaces goods without their say.

**Recommendation.** Approve as revised.

---

## Q2. Return-shipping label charge

**Proposed behaviour.** D8.5 approved the payer rule but named no amount. The policy value `returnShipping.labelChargeInPaise` starts at 0, so the "return shipping charge" line is never produced; customers who are not at fault arrange and pay their own postage. Raising the value later needs no design change, and the line then appears only when staff tick "shop label used" on a not-at-fault return.

**Scenario.** Rahul returns a tote for size reasons, posts it himself and pays the courier; his refund is the full item value.

**Finance.** One ₹1,299 tote, not at fault, accepted as new: refund 129,900 (₹1,299). Were the charge ₹99 and a shop label used, the refund would be 129,900 − 9,900 = 120,000 (₹1,200).

**Recommendation.** Approve ₹0 now; revisit with a carrier arrangement.

---

## Q3. Deductions: reasons, combination, ceiling and dispute

**Reasons (fixed list).**

| Reason                | Meaning                                          | Extra validation                              |
| --------------------- | ------------------------------------------------ | --------------------------------------------- |
| `WORN`                | Used or washed; not resaleable as new            | Condition must be "used"                      |
| `MISSING_PARTS`       | Accessories, hardware or pieces missing          | Note naming what is missing (≥ 10 characters) |
| `CUSTOMER_DAMAGE`     | Damage the customer caused                       | Condition must be "damaged"                   |
| `PACKAGING_DESTROYED` | Original packaging needed for resale is unusable | —                                             |
| `OTHER`               | Anything else                                    | Note of at least 10 characters                |

**Combination and ceiling.** A line may carry several deductions, one per reason, each with its own amount and at least one staff photograph from this request's inspection uploads. The **combined** deductions on a line may not exceed floor(value of the line's accepted units × 30 ÷ 100); each deduction is at least 1 paisa; the same reason cannot appear twice on a line. Deductions apply to the line's accepted units as a whole (units are of one variant and one condition record), so the per-unit ceiling is the line ceiling divided across them. No deduction on any fault reason (damage on arrival, wrong item, not as described: the database refuses the first two, the service all three) and none when the condition is "as new".

**Dispute process before settlement.** Deductions are never applied unseen:

1. After inspection, ADMIN prepares a **settlement proposal**: the full breakdown including deductions, with the photographs. The request stays `INSPECTED` with `proposed_at` set; the customer is e-mailed `return.settlement_proposed` with the breakdown and a link.
2. The customer may **accept** or **dispute** (with a message) on the return page during the dispute window (`deductions.disputeWindowDays`, engineering default 3 days). Both are explicit, recorded actions.
3. ADMIN may settle when the customer accepted, or when the window lapsed without a dispute (money is being paid to the customer, so silence is treated as acceptance of the proposal they received), or at any time when the proposal has no deductions.
4. A dispute returns the proposal to ADMIN with the message; ADMIN may revise the deductions (a new proposal restarts the window), keep them with a written reply, or escalate by phone. A settlement cannot proceed while a dispute is open and unanswered. Every proposal, acceptance, dispute and reply is a return event and a message row.

**Scenario.** A wall hanging comes back with a tear the customer made while hanging it and its original box crushed. Staff photograph both; ADMIN proposes "customer damage ₹250" and "packaging destroyed ₹60"; the customer accepts; settlement follows.

**Finance.** Example 3 (single reason) and example 8 (two reasons under one ceiling) below.

**Implications.** Every deduction is evidenced, bounded, proposed before it is applied, and audited; the customer always has a say before money moves.

**Recommendation.** Approve the list, the combined ceiling and the 3-day window.

---

## Q4. Cash-on-delivery fee

**Proposed behaviour.** The COD fee paid for a service rendered and is never refunded. Today the fee is ₹0; the rule is stated so a future fee behaves predictably. Example 4 shows a hypothetical ₹49 fee.

**Recommendation.** Approve.

---

## Q5. Bank-detail encryption, retention and key rotation

**Storage.** Bank details are collected in the return form for COD orders (D8.8), encrypted with AES-256-GCM under `CUSTOMER_DATA_KEY` before the row is written, and stored as ciphertext plus the last four characters and the key version. Nothing displays more than the last four characters except an audited reveal (Q7).

**Retention and deletion.** The daily sweep nulls the ciphertext 30 days after the manual refund is marked paid, or 30 days after the request closes without a refund. The last four characters, key version and payment reference remain. Each deletion writes a system audit row (`customer_data.swept`, target `manual_refund` or `return`).

**Key rotation, concrete procedure (runbook, step 8.2 ships the tooling).**

1. _Generate_ a new 32-byte key; store it in the secrets manager with its creation date.
2. _Stage_: set `CUSTOMER_DATA_KEY` to the new key and `CUSTOMER_DATA_KEY_PREVIOUS` to the old one; deploy. From this moment new writes use the new key (version n+1) and reads accept both.
3. _Re-encrypt_: run `npm run job -- rotate-customer-data-key` (also schedulable). It selects rows whose `beneficiary_key_version < n+1` in batches of 100, decrypts with the matching key, re-encrypts under the current key, writes ciphertext and version in one conditional update per row (version unchanged since read), and is idempotent and resumable. It reports counts and writes one system audit row per run with totals; a row that fails to decrypt is counted, left unchanged and listed by id for investigation.
4. _Verify_: `SELECT count(*) … WHERE beneficiary_key_version < n+1` on both tables must be 0; the job's final run reports zero candidates; a sample reveal under the new key succeeds.
5. _Retire_: remove `CUSTOMER_DATA_KEY_PREVIOUS` and deploy. The application no longer accepts the old key.
6. _Backups_: database backups taken before step 4 contain ciphertext under the old key. Keep the retired key sealed in the secrets manager, access-logged, for as long as any restorable backup holds such rows (the backup retention window chosen in Phase 11); then destroy it and record the destruction date. A restore from an older backup therefore requires the matching retired key, which the runbook states.
7. _Compromise_: if a key is suspected compromised, rotate at once (steps 1–5) and additionally run the retention sweep early for rows already paid.

**Scenario.** Meera's COD return is paid on 10 November; on 10 December her account number is gone from the database while the record shows "paid, account ending 4521, reference NEFT-…". A key rotation in between re-encrypted her row within minutes, invisible to her.

**Implications.** Data minimisation; the rotation tooling is small; a lost key makes details unrecoverable, hence the backup rule.

**Recommendation.** Approve 30 days and the procedure.

---

## Q6. Unpaid manual refund alerts

**Lifecycle.** Settlement creates a pending manual refund and e-mails the customer. From day 3 unpaid, the returns clock job sends the owner one alert per day (deduplicated by day) until the row is paid or cancelled; from day 10 the alert subject escalates ("overdue"). The Operations page lists pending rows with age. Nothing auto-cancels or auto-pays. Marking paid requires the dedicated capability (Q7), a fresh second factor and the bank reference; cancelling requires a reason and e-mails the customer.

**Recommendation.** Approve 3 days with the day-10 escalation.

---

## Q7. Access to full bank details

**Proposed behaviour.**

- A **dedicated capability `returns.bank_view`** (the "manual refund bank view" permission) is required to reveal full details. It is **not** part of the STAFF set and **not** granted to ADMIN by role; it is held only through an explicit, time-bound grant recorded in the existing grant table (field `bank`, up to 24 hours, issued by an ADMIN to a named user, including themselves as the owner, every issue and revocation audited). The capability model is role-based today; the grant is how it becomes personal.
- Revealing requires the grant, a fresh second factor (10-minute window), an explicit "reveal" action, and writes an audit row per reveal (`return.beneficiary_revealed`, naming the manual refund and the user); it counts against the existing reveal limit. The page renders the last four characters by default and never embeds the full value before the reveal.
- "Mark paid" and "cancel" keep their own sensitive capability (`returns.manual_refund`, ADMIN); paying does not require viewing (the owner may already have made the transfer from details revealed earlier).

**Scenario.** The owner grants herself `bank` for two hours, reveals Meera's details once, makes the transfer, records the reference. The audit log shows the grant, one reveal and the payment.

**Recommendation.** Approve: least privilege, explicit, time-bound and audited.

---

## Arithmetic: deterministic per-unit allocation and partial returns

**Allocation of an order-level discount to lines.** `share_i = floor(D × L_i / S)`; the remainder `D − Σ share_i` paise go one each to the lines with the largest fractional parts of `D × L_i / S`, ties broken by ascending variant id. `discounted_i = L_i − share_i`; the shares sum exactly to `D`.

**Per-unit values within a line.** For a line of `q` units with `discounted` value: `unit = floor(discounted / q)`, `r = discounted − unit × q` (0 ≤ r < q). Units are numbered 1..q; units 1..(q − r) are worth `unit`, units (q − r + 1)..q are worth `unit + 1`. So `value(k)`, the worth of the first `k` units, is `k × unit + max(0, k − (q − r))`, and `value(q) = discounted`.

**Which units a partial return takes.** Returned units of a line are always valued from unit 1 upward, continuing from where earlier settlements on the same line stopped: if `u` units of the line were already refunded (sum of `units` on earlier `ITEM_VALUE` lines for that order item), a settlement of `k` more units is worth `value(u + k) − value(u)`. The customer therefore never receives more than the average per unit on a partial return, and the sum of any sequence of partial returns equals the line's full discounted value once all `q` units are refunded. Deductions and caps apply after this value.

**Tests (step 8.2).** For every `q` in 1..10, every `r` in 0..q−1 and every `k` in 1..q: `value(q)` equals `discounted`; `value` is non-decreasing with increments of `unit` or `unit + 1` only; for every split of `q` into sequential partial returns, the sum of their values equals `discounted`; allocation shares sum to `D` and ties resolve by variant id; Appendix A vectors; property-style loops over random line sets.

---

## Q8. Repaired and quarantined units

**What the approved proposal says.** §4.3 counts restocked, repaired and quarantined units as accepted and refunds them at settlement, before repair or quarantine reaches its outcome.

**Consequences if retained.** Money leaves before the shop knows whether a quarantined unit is acceptable; if it is later written off, the refund is not reversed (nothing in the design charges a customer after a refund), so the loss is the shop's. Inventory is unaffected either way: held units are not stock until released, and release is an audited restock. Repair is different in kind: the customer's part is done and the repair cost is the shop's choice, so refunding at settlement is fair. Quarantine is a pending judgement about the unit, so refunding before it is a financial exposure.

**This is a business decision, not an engineering default.** It is raised as **D8.19** in the register with this recommendation: refund repaired units at settlement (as proposed); hold the refund of quarantined units until their release decision, which must happen within `quarantineDecisionDays` (engineering default 7); release to stock refunds the unit under the normal rules, a write-off after quarantine refunds it only for a fault reason, and a unit sent back to the customer is not refunded. The customer sees "1 unit held for checks; decision by <date>". Until D8.19 is decided, step 8.2 is specified with the proposal's behaviour and the alternative behind a policy switch (`heldUnits.refundQuarantineAtSettlement`), so either answer is a value, not a redesign.

**Edge cases (both options).** Partial quantity with mixed outcomes is example 5; two settlements on one line is example 9; a quarantined unit later written off for a customer-fault reason is refunded under the proposal's behaviour and not under the recommended one.

---

## Worked examples, recomputed under the revised rules

| #   | Setup                                                                                                                                                                                      | Calculation                                                                                                                                                                                                                                                                                                                                                                                                                                            | Refund                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 1   | Online, 2 × tote ₹1,299 (259,800), shipping free, no discount. Return 1 unit, size reasons; as new, restocked.                                                                             | `q = 2, discounted = 259,800, unit = 129,900, r = 0`; `value(1) = 129,900`. No deduction; shipping refund 0; label charge 0 (Q2). Provider balance 259,800.                                                                                                                                                                                                                                                                                            | 129,900 (₹1,299)                                                      |
| 2   | Online with a ₹100 coupon (hypothetical): line A 1 × ₹1,299 (129,900), line B 2 × ₹1,299 (259,800), `S = 389,700`, `D = 10,000`, shipping free, captured 379,700. Return 1 unit of line B. | Shares: A = floor(10,000 × 129,900 ÷ 389,700) = 3,333 (fraction .333), B = floor(10,000 × 259,800 ÷ 389,700) = 6,666 (fraction .667); remainder 1 → B = 6,667. Discounted A 126,567, B 253,133 (sum 379,700). Line B: `unit = 126,566, r = 1`: unit 1 is worth 126,566, unit 2 is worth 126,567. First partial return takes unit 1.                                                                                                                    | 126,566 (₹1,265.66); a later return of the last unit: 126,567         |
| 3   | As 1, but the unit is used; staff photograph; one deduction `WORN`.                                                                                                                        | Ceiling floor(129,900 × 30 ÷ 100) = 38,970. ₹300 (30,000) allowed; ₹400 (40,000) refused. Proposal sent; customer accepts or 3 days pass; then settlement.                                                                                                                                                                                                                                                                                             | 99,900 (₹999)                                                         |
| 4   | COD, 1 × tote ₹1,299 (129,900), shipping ₹99 (9,900), hypothetical COD fee ₹49 (4,900); collected 144,700. Arrived damaged; full return accepted.                                          | Fault reason: no deduction possible; shipping refunded. 129,900 + 9,900 = 139,800. Fee kept (Q4). Manual bank transfer with encrypted details (Q5); reveal needs the `bank` grant (Q7).                                                                                                                                                                                                                                                                | 139,800 (₹1,398) by transfer; ₹49 fee not refunded                    |
| 5   | Online, 3 × tote (389,700), shipping free. Return 3, "changed my mind". Approved 3, received 2 (1 missing). Inspection: 1 restocked as new, 1 written off (customer damage).               | Accepted: 1 restocked; written-off unit refunded only if ADMIN chooses (Q8 rule for non-fault reasons), default no; missing unit never. `unit = 129,900, r = 0`; `value(1)`. Had the reason been "damaged on arrival", the written-off unit is refunded automatically: `value(2) = 259,800`.                                                                                                                                                           | 129,900 (₹1,299); 259,800 with the goodwill choice or a fault reason  |
| 6   | Online, 2 × tote (259,800) captured; an earlier goodwill refund of ₹500 (50,000) processed. Both units returned and accepted as new.                                                       | Gross `value(2) = 259,800`. Cap 2 (provider balance): 259,800 − 50,000 = 209,800; a "capped to provider balance" line of −50,000 appears.                                                                                                                                                                                                                                                                                                              | 209,800 (₹2,098)                                                      |
| 7   | Online, 2 × scarf ₹899 (179,800), shipping ₹99 (9,900), captured 189,700. First return: 1 unit, size; accepted. Second return later: the other unit; accepted.                             | Line: `unit = 89,900, r = 0`. First settlement: `value(1) = 89,900`, shipping not refunded (not every unit, not at fault). Second: `value(2) − value(1) = 89,900` plus shipping 9,900, since every unit of the order is now accepted (D8.6). Total 189,700, exactly the capture; the attempt then becomes "refunded".                                                                                                                                  | 89,900 (₹899), then 99,800 (₹998)                                     |
| 8   | As 3, but two deductions: `CUSTOMER_DAMAGE` ₹300 (30,000) and `PACKAGING_DESTROYED` ₹100 (10,000), each with a photograph.                                                                 | Combined 40,000 > ceiling 38,970: the proposal is refused until the amounts fit; ADMIN sets ₹289.70 (28,970) and ₹100 (10,000) = 38,970. Refund 129,900 − 38,970.                                                                                                                                                                                                                                                                                      | 90,930 (₹909.30)                                                      |
| 9   | Line B from example 2 (2 units worth 126,566 and 126,567). First return of 1 unit settled (126,566). A second request returns the last unit; accepted.                                     | Units already refunded `u = 1`; `value(2) − value(1) = 253,133 − 126,566 = 126,567`. The two settlements sum to the line's discounted value exactly. Order-wide: line A untouched, so no shipping question (shipping was free).                                                                                                                                                                                                                        | 126,567 (₹1,265.67)                                                   |
| 10  | Online, 1 × tote (129,900), shipping ₹99 (9,900), captured 139,800. Return 1 unit, "quality"; received; inspection: quarantined (suspected counterfeit claim pending check).               | Under the proposal: accepted now, refund 129,900 at settlement; shipping not refunded (not at fault; and D8.6's "every unit accepted" rule is met only if quarantine counts as accepted, which the proposal says it does, so 9,900 would be added: 139,800). Under D8.19's recommendation: nothing refunded until release; release to stock → 129,900 (+ shipping 9,900 by the all-units rule); write-off after quarantine → 0 for a non-fault reason. | 139,800 now (proposal) or 139,800 on release / 0 on write-off (D8.19) |

Observations from the recheck: examples 1, 4, 6 and 7 are unchanged by the revisions; example 2 is now unambiguous (units 1 then 2, lowest first); example 3 gains the proposal-and-dispute step; example 5 is unchanged in amounts; examples 8, 9 and 10 are new. Example 10 shows that D8.19 also changes when D8.6's shipping rule is satisfied, which is why it is a business decision.
