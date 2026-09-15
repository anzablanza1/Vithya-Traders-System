# BUSINESS_RULES

These are the rules the numbers depend on. Breaking any of them produces
figures that look plausible and are wrong. Several were learned the hard way
(see `CHANGELOG.md` and `KNOWN_ISSUES.md`).

---

## 1. The lane rule (GST vs non-GST) — the most important rule

Vithya Traders bills on two lanes:
- **W = GST** (the registered, tax-invoice lane)
- **WO = non-GST** (the POS / non-registered lane)

Two markers encode it:

**On an item code: a trailing `/` means the non-GST (WO) SKU.**
```
STD10120S      -> W  (GST)
STD10120S/     -> WO (non-GST)
```
The same physical product exists as two SKUs. Strip the trailing `/` to get
`item_code_base`, which merges the two lanes for unified analytics. Keep the
lane where the tax treatment matters.

**On a customer name: a leading `.` means the non-GST ledger.**
```
AADHI PUMPS      -> W ledger
. AADHI PUMPS    -> WO ledger  (same firm, non-GST account)
```
The same firm has two ledgers. `party_key` merges them for a customer-level
view; **the ledgers themselves must NEVER be merged** — a quote or a balance
is either GST or it is not, and the rates differ.

**Rules:**
- Never merge the W and WO ledgers of a customer into one balance.
- The leading `.` is a ledger marker, not part of the name — resolve the real
  name via `customer_master`, but keep the lane.
- W selling prices are quoted including GST; the ex-GST figure is derived.
  WO carries no tax component.

---

## 2. `sales_data` is sacred raw

**Nothing except the FTP pipeline may write to `sales_data`.** It is the
record of exactly what Vasy sent. Every other sales source lives in its own
table:
- `sales_history` — the one-time backfill
- `sales_ftp_gap` — API pulls while FTP was down (deletable)

`v_sales_all` unions all three and picks **one source per voucher**, ranked
**FTP (1) > API-gap (2) > sheet-history (3)**. So when FTP re-sends a document
it automatically wins, and the gap table can be truncated with nothing lost.

Reason: mixing sources into `sales_data` would destroy the ability to know
what the ERP actually said, and the PHP pipeline deletes by `voucher_no` only
for documents in its own file — a foreign row would linger forever.

---

## 3. Receivables truth

- **Vasy's invoice `balance` is the outstanding truth**, NOT what receipts we
  can trace. Tracing only covers 17 Aug 2026 onward (when the FTP receipt feed
  began carrying `db_invoiceno`).
- The receipt → invoice link is `cash/bank_receipt_data.db_invoiceno` →
  `sales_invoice.sales_id`. The FTP **sales** feed has no such link
  (`invoice_id_db_id` is `'0'`).
- A single receipt can settle several invoices (`db_invoiceno` like
  `id1| id2| id3`). Do **not** divide the amount evenly — Vasy does not record
  the split. Attribute only when the receipt total matches the sum of the
  invoices' settled amounts (`total - balance`); otherwise flag for a human.
- **Reconciliation model:** history before Apr 2026 is unreliable (receipts
  were not always entered). Do NOT fix it invoice by invoice. Instead:
  `balance today = agreed opening balance (1 Apr 2026) + FY2026-27 billed −
  FY2026-27 received`. Agree ONE opening balance per customer, sign it off in
  `customer_opening_balance`, and that customer is closed.
- **Customers in credit** (negative ledger — paid more than billed) are a
  DIFFERENT job from customers who owe. Never net the two into one headline.
- The gap between the ledger closing and the invoice-detail outstanding is the
  **write-off list** — invoices settled but never marked against the bill.

---

## 4. Cost and margin

- **`landing_cost` is a LINE total, not per-unit.** Margin per line is
  `net_amount − landing_cost`. Multiplying by qty is wrong (it once produced
  −₹609 crore of "profit").
- **Landing cost in old sales rows is unreliable.** Pre-2026 margin must not be
  treated as real; this-year margin (~25%) is sound.
- Vasy holds several costs and several selling prices per product, none
  independently verified: ERP snapshot selling, Cost_Current cost, purchase
  register rate, sales register rate. The office product card shows both cost
  lanes (vasy-batch = Cost_Current, vasy-master = ERP snapshot) side by side
  and flags where they disagree.
- For margin, prefer `v_item_latest_cost` (most recent purchase rate) over
  Vasy's landing cost.
- **Vasy will not accept a selling price below landing cost**, so a genuine
  "selling below cost" is near-impossible. A negative margin computed against a
  *frozen/stale* cost is flagged `CHECK COST`, not `LOSS`.

---

## 5. The floor dashboard shows no cost

**The floor/counter dashboard must never display cost, supplier, margin, or
GMROI.** This is a deliberate business decision. It is enforced in code and
checked on every build (a test scans the floor JS for those words). The floor
read model is constructed without those fields by design.

---

## 6. Stock

- W and WO stock are combined into a total for the counter (they only want to
  know if the thing is on the shelf), but both lanes are kept.
- Stock must be pulled **whole**, never incrementally — a sale changes `qty`
  but does not "edit" the product, so an incremental (modified-date) pull sees
  nothing. (This caused stale stock for weeks.)
- **Vasy stock is scoped to the selected financial year**, and because the
  year-end rollover was never run, the API returns the SUM of every year's
  closing. Live stock is therefore **calibrated**: `true = api − offset`, where
  `offset` is measured once against the Stock Register. Recalibrate on 1 April
  and whenever the rollover is finally run.
- Stock API calls: page size and pacing must match the proven values in the
  working caller (see `ERP_INTEGRATION.md`). Guessing has repeatedly failed.

---

## 7. Inventory classification

- **ABC** by 12-month revenue share: A = top 80%, B = next 15%, C = last 5%.
- **XYZ** by demand steadiness: X = active in ≥9 months, Y = 4–8, Z = ≤3.
- **Days of cover** = `qty_total ÷ (units sold in 90 days ÷ 90)`.
- **Flags:** NEGATIVE (impossible qty), STOCKOUT (selling, zero on hand),
  DEAD (stock but no sale in 180 days), LOW (<15 days cover), EXCESS (>180
  days cover), OK.

---

## 8. Search behaviour

Product descriptions are mostly sizes, so search must be **punctuation-blind
and order-independent**: strip everything but letters and digits on both
sides, require every typed token as a substring in any order. So
`4 pel 35 mm`, `14303545`, `35*45` all find
`4 PEL 14*30/35*45 MM COUPLING AQA`.

---

## 9. Corrections established in earlier sessions (do not re-break)

- Counter sales **can** be on credit if the customer is named — that is normal,
  not an exception. The exception is a counter credit with **no customer**.
- "Marked cash but unpaid" is usually a **partial payment**, not an error.
- The invoice document number: POS uses `order_no`; GST uses `prefix +
  sales_no`. Both are shown.
- Customer names that are just `.` or blank are resolved via `contact_id` →
  `customer_master`, so the team's slow renaming effort flows through
  automatically.
