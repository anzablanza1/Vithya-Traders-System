# BUSINESS_RULES_CURRENT.md — V1 (frozen)

CURRENT rules extracted from the build. **OLD/REJECTED** rules are labelled.

## GST / Non-GST
- **Item code trailing `/` ⇒ Non-GST.** No trailing `/` ⇒ GST. This drives lane, code generation, and
  which upload file a line lands in.
- **Supplier name leading `.` ⇒ Non-GST party.**
- Lanes: **w = GST** (teal `#1F6B7A`), **wo = Non-GST** (red `#C23A2C`).
- The whole PO system treats GST/Non-GST as the **same product** everywhere **except** at
  upload/split-bill time, where the w/wo split, lane-specific code, MRP and selling price apply.

## Prices / MRP / selling (lane-specific, upload only)
- **w MRP = GST MRP; wo MRP = Non-GST MRP. w selling = GST selling; wo selling = Non-GST selling.**
- Selling price is sourced **register-first** (last actual), then master, then MRP — **never the
  purchase cost**. (The master `price` columns are COST, not selling.)
- Cost for a line = split-bill/upload rate on the lot first, then PO line price, then register last
  landing, then master. (`lineCostBest`.)

## Quantities & PO status
- Core quantities: **Ordered · In transit (shipped, not received) · Received · Pending.**
- **Pending after a shipment reads "pending"** (awaiting next lot), not "created/sent". Re-marking sends it again.
- **Status model (V1):** made → sent → **partshipped** (some shipped, some still to ship) →
  **shipped** (all shipped, none received) → **partial** (some received) → received → closed.
  Fully-shipped-nothing-received = **Shipped**, not "Partially received".
- **Excess:** entering more than pending warns and, if confirmed, shows ⚠ excess on the line
  (no separate "add excess" button). Excess never silently increases PO qty.
- **Cancel** records a reason and cancels only the outstanding balance (shipped untouched); audit-logged.
- **Close** moves a PO to History (out of live tracking); reversible (Reopen); all data preserved.
- **Delete** wipes the PO and all its lots/receipts/splits/bills everywhere (tombstones lots so a stale
  sync can't resurrect them). Distinct from Cancel/Close, with a stern warning.
- **Sheet is the source of truth:** a PO not on the sheet after a sync is dropped unless it still has a
  queued outbox write.

## Allocation (V2-approved, documented here for continuity)
- **CURRENT/APPROVED rule: FIFO (oldest open PO first) as a *suggestion only*, fully manually editable.**
- **REJECTED: LIFO.** Any earlier "LIFO" note is stale — do not implement LIFO.
- (V1 itself does not yet do cross-PO allocation; this rule governs V2. Stated here because the freeze
  request requires the current allocation rule to be unambiguous.)

## Dates (two-date model, v8.0)
- **PO Promised ship date** — supplier's promised **ship** date; follow up **before** shipping.
- **Lot Shipped on (actual)** — real ship date.
- **Lot Expected delivery date** — promised **delivery**; follow up **after** shipping.
- **Lot Received** — actual delivery date.
- Follow-up phase = **ship** before shipping, **delivery** after (`poFollowDate`).

## Bill / material inward (V1)
- Built **per lot**. Full logic: **w/wo split, rates, GST%, additional charges (intelligent allocation
  70% qty / 30% value), round-off per lane (+/−), Vasy bill number, totals.** "Same rate w↔wo" copy
  buttons (per row + all). Selling price grossed for GST in the upload file.
- Upload file = **exact 7-column software format**, GST and Non-GST always separate files, per supplier×lane.
- **Weakness (V2 target):** one lot ↔ one PO only. Cross-PO shipments can't be billed as one MI.

## Goods check
- Read-only status. **Quantities only in the PO-Request app** — supplier/rate/amount must NEVER appear there.
- Purchase-dashboard Goods Check may show supplier/rate (Management). A5 PDF, thin rows.
- Rejection is an **exception** only; Accepted = Received − Rejected (derived).

## Reorder / EOQ / lead time
- **No live sales feed.** Reorder/EOQ use **purchase outflow as a sales proxy** (explicit limitation).
- Reorder measured from **today**. Lead time = ship→receive per lot (falls back to PO date / PO-number
  date when createdAt blank). Fill rate, OTIF, MOQ inference computed in Analytics; **populate only once
  enough completed cycles exist** (early cells read "—").

## Search
- **Strict** = whole-word token AND (each typed word must appear as a whole word / word-prefix; numbers
  may match inside a longer number). **Fuzzy** = in-order subsequence with consecutive-run preference.
- **Dimension-aware:** `*`, `x`, `×`, `-` are dimension separators. "10\*10" ranks exact-dimension
  matches first, digit-run ("1010") after; "10" ranks 10-starting items first; descriptor words after a
  dimension (e.g. "16\*24\*30 MM LG") are **soft** so same-size siblings still show.
- Ranking priority: exact whole-word > word-prefix > number-inside-a-number > compact substring.

## Notes / follow-ups
- **Two note types, saved separately to the sheet:** (1) whole-PO to-do notes `p.notes[]` (via PO Meta,
  editable text + due date + done, deletable); (2) **per-line note** `l.note` (via PO Tracking Line Note
  column). Both persist across devices.

## Fund planning (mgmt)
- Value of **open** POs. Columns: PO/Transit/Received/Pending qty, each with its own ₹ amount toggle.
- **Supplier and rate/value toggles** apply to screen, PDF and Excel (turn off to share without pricing).
- Hierarchy sort (supplier→status→date→product) with asc/desc; per-PO headers + footers; red pending;
  PDF uses "Rs" (jsPDF core font has no ₹ glyph).
