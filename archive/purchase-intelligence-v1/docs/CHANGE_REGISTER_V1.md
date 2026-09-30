# VT Purchase Intelligence — Change Register

## Batch v8.6 (this session)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-53 | Request Goods Check: fixed edge alignment — table cells now have proper left/right padding, content no longer touches the card edge | Me | ✅ Done |
| C-54 | Request Goods Check: added **Group by PO / by product** — the by-product mode is an expandable product→PO list (like the purchase By-product "List by PO"); removed the confusing "PO then sort" behaviour | Me | ✅ Done |
| C-55 | Request Goods Check: **sort by category** now works (also fixed category filter in product grouping) | Me | ✅ Done |
| C-56 | Purchase "List by PO": the **Detailed** density now auto-expands product rows to expose the PO numbers; Compact stays collapsed until clicked | Me | ✅ Done |

**Deploy:** replace **PORequest_index.html** (request app) and the purchase dashboard HTML. GoodsCheckApi.gs unchanged this batch.

### Pending / awaiting you
- **Multi-PO Bill / Shipment redesign** — full plan in the v8.4 section below; you haven't read it yet. No code until you approve.

## Batch v8.5 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-52 | Removed supplier name, rate and value entirely from the **PO-request** Goods Check (index toggles + server output). The request app is quantity/status only. Purchase-dashboard Goods Check keeps supplier/rate. | Me | ✅ Done |

**Deploy:** replace **PORequest_index.html** and **GoodsCheckApi.gs**, deploy → New version.

### Pending for NEXT batch (agreed)
- Request Goods Check: fix edge alignment (content near the edge).
- Request Goods Check sort: show product + PO number as an expandable list (like By-product "List by PO"), not "by PO then by sort"; fix **sort by category** not working.
- Purchase "List by PO": the Detailed toggle should auto-expand to expose the PO numbers.
- Multi-PO Bill / Shipment redesign — plan already in register; you haven't read it yet.

## Batch v8.4 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-46 | Request-app Goods Check: **Expand-all** button | Me | ✅ Done |
| C-47 | Request-app Goods Check: dates show **date only** (timestamps stripped) | Me | ✅ Done |
| C-48 | Request-app Goods Check: **per-date show/hide** toggles (promised/shipped/expected/received) | Me | ✅ Done |
| C-49 | Request-app Goods Check: **sort by PO / product / category / most-pending** | Me | ✅ Done |
| C-50 | ~~Request-app supplier+rate columns~~ — **REVERTED**: supplier, rate & value must NEVER appear in the PO-request sheet. Removed from index + server. | Me | ✅ Reverted (v8.5) |
| C-51 | Purchase By-product **List** layout rebuilt as a **compact Excel-like table** (product header + one line per PO, clickable, expandable to progress bar) | Me | ✅ Done |

**Deploy for C-46..C-50 (PO-Request app):** replace **index.html** with the new PORequest_index.html AND replace **GoodsCheckApi.gs** (now returns supplier+rate). Deploy → New version.

## NEXT VERSION — Multi-PO Bill / Shipment redesign  (PLAN — awaiting approval)

### The problem
Bill/split-bill creation is currently locked to **one lot inside one PO**. But suppliers ship **one physical lot containing items from several POs** (and sometimes extra/unlisted items). We must produce **one material-inward bill** (with w/wo split, charges, round-off) **ready to upload to Vasy the moment goods arrive** — the calculations can't wait until receipt or stock goes stale. Today, splitting per-lot-per-PO can't represent a cross-PO shipment, so tallies don't match.

### My proposed model (recommended)
Separate the workflow into **three independent objects**, each its own step:
1. **Shipment** (the physical lot the supplier sent) — one shipment can draw quantities from **many PO lines** across many POs, LIFO-suggested, and may include **excess** or **off-PO** items.
2. **Bill (material inward, upload-ready)** — built from **one or more shipments**; carries the w/wo split, additional charges, round-off, Vasy bill no. Can add items beyond the shipment. This is the artifact staged for Vasy.
3. **Receipt** — marking a shipment/bill actually arrived → triggers the upload.

Key idea: a **shipment is not tied to a PO**; it *allocates* against PO lines. The PO's pending/received are derived from allocations, so cross-PO shipments tally automatically. The bill references shipments, so one bill = one Vasy upload regardless of how many POs it touches.

### Critique of your two ideas
- **Idea 1** (separate bill-creation module that selects already-entered lots): Good — decouples billing from the PO. Weakness: it still enters shipment **per PO first** (A-10 in PO1, D-30 in PO2/PO3+excess), so the person must know the PO split *before* billing, and a single physical lot is still fragmented across PO-lots. Tally risk remains at the lot level.
- **Idea 2** (shipment-entry module: type product → shows POs with pending, LIFO, select PO(s), add excess/off-PO; bill from one or many shipments): **Stronger.** Product-first entry with live PO suggestions matches how goods physically arrive (you see items, not POs). Allocation-at-entry is exactly what makes cross-PO tally work. This is essentially my model with a great entry UX.

### Recommended plan (mine + your Idea 2)
- **Adopt Idea 2's product-first Shipment entry**, backed by **my allocation model** (shipment allocates to PO lines; PO status derived).
- Keep **bill creation as a second module** that groups one/many shipments into an upload-ready material inward, with the full existing w/wo split + charges + round-off + Vasy bill no.
- Support **excess** and **off-PO items** at both shipment and bill stages.
- Redesign PO handling as **status-driven workflows**: Created → Sent → (Shipment allocations) → Bill staged → Received/Uploaded, each a clean step with its own screen.

### Rollout (each a change-register line once approved)
- N-01 data model: `shipments[]` + `allocations[]` (shipment↔PO-line), sheet tabs + server writers
- N-02 Shipment entry module (product-first, LIFO PO suggestions, excess/off-PO)
- N-03 derive PO pending/received/transit from allocations (replaces per-lot mirror)
- N-04 Bill module: group shipments → one upload-ready MI (w/wo split, charges, round-off, Vasy no)
- N-05 migrate existing lots → shipments+allocations (back-compat)
- N-06 update Goods Check / Fund / Analytics to read the new model
- N-07 Vasy upload-file generation from a Bill (not a lot)

**Status: awaiting your approval before any code. On approval I'll add N-01…N-07 to the register and build incrementally.**

## Batch v8.3 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| D-03b | Goods Check tab for the **PO-Request app** — server fn (GoodsCheckApi.gs) + paste-in index snippets (nav button, view, JS). Read-only, no supplier/rate; select-all/deselect + download (PDF-all / A5-per-PO print / Excel) | Me | ✅ Delivered (paste + deploy) |
| C-44 | Goods Check (purchase dashboard): per-PO **multi-select + Select all/Deselect**, and one **Download** control → PDF all-together · one A5 per PO · Excel-together | Me | ✅ Done |
| C-45 | By-product: new **List by PO** layout — product → clickable PO/lot nos with ordered/recd/transit/pending, each line expandable to its own progress bar (Summary layout kept, toggle between them) | Me | ✅ Done |

**Deploy for D-03b (PO-Request app):**
1. In the PO-Request Apps Script project, add a new file and paste **GoodsCheckApi.gs**.
2. In **index.html**: paste the 3 snippet blocks from **REQ_GoodsCheck_index_snippets.html** (nav button in .topnav; the #goodsView container after #subsView; the <script> block before </script>).
3. In `switchView(v)` add: `document.getElementById('navGoods').classList.toggle('on', v==='goods'); document.getElementById('goodsView').style.display=v==='goods'?'block':'none'; if(v==='goods') loadGoods();`
4. Save & deploy → New version. Uses the same sheet tabs; no other change.

## Batch v8.2 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| Q-01b | Nav duplication resolved cleanly — History/Fund/Analytics/Goods are **tabs inside PO Tracking** (removed from top nav); PO Tracking now switches correctly, no duplicates | Me | ✅ Done |
| B-01 | Per-line note: added an editable note field per product line; now **saves to the sheet** (was save-session only). Whole-PO to-do notes already synced | Me | ✅ Done |
| B-02 | Follow-up notes & to-dos now fully **editable** (text + due date) and **deletable** inline | Me | ✅ Done |
| D-03b | Goods Check tab in the PO-Request dashboard (Apps Script) — files received; build next | Me | ⏳ Next |

## Batch v8.1 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| D-03 | Goods Check module — read-only open-PO status (item · UOM · PO/transit/recd/pending · 4 dates), top-nav, all modes, A5 PDF per PO. Supplier facet/toggle only in mgmt/follow-up | Me | ✅ Done (purchase dashboard) |
| D-03b | Same module in the PO-Request dashboard (Apps Script side) | Me | ⏳ Next (needs request-app edit) |
| Q-01 | Removed History/Fund/Analytics duplicate tabs from PO-Tracking view row (kept in top nav) | Me | ✅ Done |
| B-01 | Notes (PO-level + per-line) not saving to sheet / not visible | Me | ⏳ Next batch |
| B-02 | Follow-up notes & to-dos not editable | Me | ⏳ Next batch |

## Batch v8.0 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| D-04 | Two-date model: PO promised-ship vs lot expected-delivery, actual ship & receive — labels + `poDates`/`poFollowDate` helpers, shown in PO detail header | Me | ✅ Done (core) |
| C-35b | Fund supplier & rate/amount toggles now also apply to Preview, PDF and Excel | Me | ✅ Fixed |
| C-42b | Fund filter label now sits beside the dropdown (was stacked with a big gap) | Me | ✅ Fixed |
| C-39b | Goods-check A5: rows fit one line (ellipsize), wider UOM, smaller font | Me | ✅ Fixed |
| C-43 | Supabase last-pull status shown in Settings (rows · source · when) | Me | ✅ Done |

## Batch v7.9 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-35 | Fund: supplier-name & rate/amount column toggles (share without prices) | Me | ✅ Done |
| C-36 | Move PO lines to a new/existing PO (wrong-supplier fix), from PO detail | Me | ✅ Done |
| C-37 | By-PO expand: added Transit qty column | Me | ✅ Done |
| C-38 | By-PO: goods-check sheet download button | Me | ✅ Done |
| C-39 | Goods-check PDF: A5, thin rows, no item code, no footer line, dates fetch (PO date/expected/promised/shipped/received) | Me | ✅ Done |
| C-40 | Supabase pull now diagnoses loudly (preflight + visible error + fallback) | Me | ✅ Done |
| C-41 | Analytics & PO History search boxes keep focus while typing | Me | ✅ Done |
| C-42 | Fund filters: in-dropdown search, product shows NAME not code, label beside box, All/Clear | Me | ✅ Done |
| D-03 | Front-facing **Goods Check module** (read-only status for sales/inventory) — PLAN proposed, build next batch | Me | 📋 Plan below |
| D-04 | Two-date model everywhere (promised vs actual; ship vs delivery) — partial (goods-check done); full rollout next | Me | ⏳ In progress |
| Q-01 | Keep History/Fund/Analytics in PO Tracking view tabs AND top nav? | You | ❓ Awaiting decision |

### D-03 — Goods Check module (proposed plan)

**Where:** a new front-facing tab in BOTH dashboards — the Purchase Intelligence dashboard and the PO-Request dashboard (alongside Submissions).

**Who / why:** read-only for sales & inventory teams to see PO status and make informed request decisions. No supplier names, no rates, no amounts (that stays in Fund Planning, which is management-with-values).

**What it shows (per open PO, expandable):**
- PO number, status, item, code, UOM
- PO qty · transit qty · received qty · pending qty
- Promised (follow-up) date, shipped date, expected delivery, received date
- PDF preview + download in the A5 goods-check format

**Filters/sort:** by PO, product, category (both dashboards); **+ supplier** only on the purchase-dashboard copy (never on the request-dashboard copy).

**Data source:** the same live sheet the request app already reads (tracking + lots + meta). The request dashboard fetches read-only; no new write path.

**Build steps (next batch):**
1. Add `goodsCheck` view (reuse fundBuild's row engine, strip supplier/rate).
2. Add the two-date columns (promised/shipped/expected/received) — needs D-04 first.
3. Add the tab to the PO-Request app (Apps Script side) reading the same endpoints.
4. PDF preview reuses checkSheetPDF.


Unique ID · Item · Owner · Status. Owner = **You** (Anu) or **Me** (build side).
Status: ✅ Done · 🔧 In progress · ⏳ Pending · 🧊 Deferred (agreed)

## Batch v7.8 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-31 | Fund filter dropdowns (status/supplier/category/product) realigned; label↔select match | Me | ✅ Done |
| C-32 | Category filter now fetches (falls back to register when master has no cat) + All/Clear per facet | Me | ✅ Done |
| C-33 | Fund search box no longer loses focus after each character (partial re-render) | Me | ✅ Done |
| C-34 | Fund PDF: overview banner no longer overlaps; per-PO header caption sits directly above its own table | Me | ✅ Done |

## Batch v7.7 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-30 | Settings unclickable (no-click cursor) — moved Settings out of the nav into the header hd-right zone (same as theme toggle), forced pointer-events | Me | ✅ Done |

## Batch v7.6 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-29 | Settings gear still unclickable — pinned it as a labelled, non-scrolling ⚙ Settings button with its own stacking context | Me | ✅ Done |

## Batch v7.5 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-28 | Settings gear was unclickable — nav delegate swallowed the click | Me | ✅ Done |

## Batch v7.4 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-18 | Supabase pull shows clear status; auto sheet-fallback if it fails | Me | ✅ Done |
| C-19 | PO History / Fund / Analytics in nav in mgmt regardless of register load | Me | ✅ Done |
| C-20 | Fund filter dropdowns made fully opaque (were overlapping data) | Me | ✅ Done |
| C-21 | Fund: one search bar (shared scope/status/search hidden in value modules) | Me | ✅ Done |
| C-22 | PDF: rate column no longer shows ₹ as "1" (Rs formatter) | Me | ✅ Done |
| C-23 | PDF: big bold totals banner (Transit/Received/Pending/PO) | Me | ✅ Done |
| C-24 | PDF: tight qty/₹ columns, wide Item + Notes, alignment fixed | Me | ✅ Done |
| C-25 | Follow-up / PO-tracking status filter row realigned | Me | ✅ Done |
| C-26 | Analytics lead time works when createdAt is blank (ship→receive fallback) | Me | ✅ Done |
| C-27 | Advice: Supabase vs Google Sheets long-term (in reply) | Me | ✅ Done |

## Batch v7.3 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-13 | Search: "10" and "10*" rank 10-starting items first (whole-word > prefix > number-substring) | Me | ✅ Done |
| C-14 | Fund Planning: working free-text search (PO / supplier / product) | Me | ✅ Done |
| C-15 | **Deleted POs no longer linger in localStorage — sheet is the source of truth** | Me | ✅ Done |
| C-16 | Reset local data also clears the outbox + tombstones | Me | ✅ Done |
| C-17 | Lot number 01 vs 001 fixed (2-digit everywhere); unsynced lots marked pending | Me | ✅ Done |

## Batch v7.2 (previous)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| C-01 | Supabase key → Script Properties; register always-live; auto-pull on load | Me | ✅ Done (server + client) |
| C-01a | Provide **service_role** key in Script Properties `VT_SB_KEY` | You | ✅ Done & working |
| C-01b | Redeploy LiveApi with Supabase proxy endpoint | You | ✅ Done & working |
| C-02 | Remove "upload purchase register" as primary; keep as fallback when Supabase fails | Me | ✅ Done |
| C-03 | Remove "pull register from sheet" | Me | ✅ Done |
| C-04 | Search: show related dimension products (16*24*30 LG/DM/GODAVARI BUSH) | Me | ✅ Done |
| C-05 | Fund columns order: PO qty · Transit qty · Received qty · Pending qty (+ amounts) | Me | ✅ Done |
| C-06 | PDF/Excel: order-by hierarchy actually applied + ascending/descending | Me | ✅ Done |
| C-07 | PDF: ₹ symbol renders (was "1"); arrows (was "!") | Me | ✅ Done |
| C-08 | PDF: overview line bold; wider Notes; narrower other columns | Me | ✅ Done |
| C-09 | PDF/Excel: add UOM column | Me | ✅ Done |
| C-10 | PDF: header/footer distinct colour; fix data overlap | Me | ✅ Done |
| C-11 | Excel: highlight header + footer; fix "full flat data not downloading" | Me | ✅ Done |
| C-12 | Register of changes (this file) with unique IDs + ownership | Me | ✅ Done |

## Deferred (agreed) — still open

| ID | Item | Owner | Status |
|----|------|-------|--------|
| D-01 | PO History / Fund / Analytics as top-level nav entries (mode-gated) | Me | ✅ Done (v7.3) |
| D-02 | Earlier "more changes" batch | — | ❌ Dropped (not needed) |

## Verified live earlier

| ID | Item | Status |
|----|------|--------|
| V-01 | LiveApi v6.6 meta sync (closed/cancel cross-device) | ✅ Deployed by you |
| V-02 | LiveApi v7.0 writeSheet (analytics/fund → sheet) | ✅ Redeployed by you |
