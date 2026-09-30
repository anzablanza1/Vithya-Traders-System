# CURRENT_FEATURES.md — V1 (frozen)

Classification: **WORKING · PARTIAL · BROKEN · EXPERIMENTAL · PLANNED**.

## Register / data
- Purchase register pull from **Supabase** (server proxy) — **WORKING**. Status shown in Settings.
- **Sheet fallback** (`Purchase_Register`) + **.xlsx/.csv upload** — **WORKING**.
- IndexedDB register cache (survives reload/lock) — **WORKING**.

## Search & Full Data
- Dimension-aware strict/fuzzy search, product insights, charge history — **WORKING**.
- Full Data filterable table — **WORKING**.

## Dashboard / intelligence
- Management dashboard KPIs, top items/suppliers, data-quality flags — **WORKING**.
- **MOQ · EOQ · Levels** (confirmable) — **PARTIAL** (uses purchase outflow as a **sales proxy**; no live sales).

## Requests
- Live request funnel from PO-Request app; progress bars — **WORKING**.

## PO Builder
- Cart, unified search (register+master+ordered), per supplier×lane 7-column upload files, GST/Non-GST
  always separate, editable price/MRP/code, lane switch regenerates code — **WORKING**.

## PO Tracking (operational core)
- Overview, Daily brief, Board, Follow-up, By PO, By bill — **WORKING**.
- **By product**: Summary layout (bars + actions) — **WORKING**; **List-by-PO** compact Excel-like
  (product→PO lines, Detailed auto-expands) — **WORKING**.
- Status multi-select + Scope (Open/All) — **WORKING**.
- PO detail: Products & lots, Actions — **WORKING**.
- Split GST/Non-GST at lot level (SPLIT_CTX/SPLIT_FRESH guards) — **WORKING**.
- **Lots (shipments)**: create, ship, receive, upload flags; 2-digit server-authoritative `lotNo`
  (unsynced shows `NN*`) — **WORKING**.
- **Move items** to a new/existing PO (wrong-supplier fix; shipped lines protected) — **WORKING**.
- Close / Reopen / Cancel (reason) / Delete (tombstoned) — **WORKING**.
- Meta sync (closed/cancel/approved/billed/promised/notes) cross-device — **WORKING**.
- Durable outbox retry; sheet-as-source-of-truth reconcile — **WORKING**.

## Bill / Material Inward
- Per-lot bill creation: w/wo split, rates, GST%, additional charges (70/30 allocation), round-off per
  lane, Vasy bill no, totals, "same rate w↔wo" copy — **WORKING** *for single-PO lots*.
- **Multi-PO shipment billing — BROKEN by design** (one lot = one PO; cross-PO consignments can't be
  billed as one MI; tallies don't reconcile). **This is the V2 target. Do not fix in V1.**

## Goods Check
- Purchase dashboard: read-only status (qty + 4 dates), multi-select, download (combined PDF / one A5
  per PO / Excel), supplier/rate visible to Management — **WORKING**.
- PO-Request app: Goods check tab, group **by PO / by product** (expandable), per-date show/hide, sort
  by PO/product/category, expand-all, edge alignment fixed, **quantity/status only (no supplier/rate)** — **WORKING**.

## Fund planning (Management)
- Value of open POs; qty + ₹ toggles; supplier & rate/value toggles (screen+PDF+Excel); hierarchy sort
  asc/desc; preview; PDF ("Rs") + Excel; in-dropdown filter search; push to sheet — **WORKING**.

## Analytics (Management)
- SKU summary + SKU×supplier: lead time (P50/75/90), fill rate, OTIF, MOQ inference, weighted rate;
  4-table Excel; push to sheet — **WORKING** (fills once enough completed cycles exist — **PARTIAL** early on).

## PO History (Follow-up + Management)
- Closed POs, editable, ready-to-close hint, reopen — **WORKING**.

## Notes / follow-ups
- Whole-PO to-do notes (editable text+due+done, deletable) — **WORKING**.
- Per-line notes (persist to sheet) — **WORKING**.

## Access / security
- Ops / Follow-up / Management tiers, PIN-gated (hashed), supplier/rate hidden outside mgmt — **WORKING**.

## Vasy upload
- Generates 7-column upload files (PO Builder) and material-inward file from a lot — **WORKING** as
  file output; **no direct API push** to Vasy (user uploads). **NEEDS LIVE VERIFICATION** of any auto path.

## Two-date model
- Promised ship / shipped / expected delivery / received; follow-up phase switch — **WORKING** (display +
  helpers). Full follow-up chase-logic wiring to phase — **PARTIAL** (pairs with V2/D-04 remainder).

## Known reverted/removed (not features)
- PO-Request supplier+rate columns — **removed** (policy: never there).
- Top-level nav for History/Fund/Analytics/Goods — **reverted** to tabs inside PO Tracking.
