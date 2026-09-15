# DASHBOARDS

Every dashboard is a single self-contained HTML file. Two connection
patterns: **JSONP to an Apps Script web app** that reads Google Sheets read
models (floor, office, pricing), or **JSONP to an Apps Script proxy that reads
Supabase** (reconciliation, inventory). See `DEPLOYMENT.md`.

---

## VT_Floor.html — the counter app

**Purpose:** counter staff answer "can we supply this, how many, at what
price, what's on the way" and raise PO requests, log counts, build quotes.

**Data source:** Apps Script web app `?app=floor` → the **floor read model**
in Google Sheets (rebuilt nightly). Live stock overlaid from `stock_live` /
Stock_Live.

**Tabs:** Home (landing page with big search + tiles), Search, All items,
Price list (quote), To do (alerts), My notes, Counting.

**KPIs / features:** live stock (W incl-GST, W ex-GST, WO colour-coded), days
of cover, movement badge, incoming PO with due date, demand summary, quote
builder (their rate vs Vasy rate, discount, additional charges, W/WO), count
search with filters, PO request deep-link.

**Critical rule:** **shows no cost, supplier, margin, or GMROI** — by design,
enforced and tested.

**Current limitations:** first load fetches the whole catalogue once (then
local); the quote is cached locally and refreshes in the background.

---

## VT_Office.html — the analytics app

**Purpose:** office staff analyse sales, inventory, movement, reorder, dead
stock, purchase progress, and drill into product detail.

**Data source:** Apps Script web app `?app=office` → the **office read model**
(rebuilt nightly from `Product_Analytics` / `Sales_Monthly`, which now come
from Supabase).

**Tabs:** Today, Products, Inventory, Sales, Purchase, Counts, Cost gaps.

**KPIs / features:** ABC×XYZ grid with actions, negative/dead/excess stock,
reorder list, sales bars (18 months, margin, W/WO, YoY, month-by-month
year-on-year with price-vs-volume), product detail with **both cost lanes**
(vasy-batch and vasy-master, incl/excl GST) and a disagreement flag, cost-gap
worklist (`price_gap`), segmented PO progress bar, count search.

**Drill-down:** every card/row/cell opens the products behind it, with a back
stack and CSV download.

**Current limitations / open item:** `ofcActions_` is running an OLD version in
the live project (an old file shadows it), so the "below cost" action grouping
is wrong until fixed. See `KNOWN_ISSUES.md`.

---

## VT_Recon.html — reconciliation

**Purpose:** per customer, agree the outstanding balance and decide safe
write-offs, by seeing the ledger, the full invoice detail, and the receipts.

**Data source:** Apps Script proxy `?app=recon` → Supabase `v_reconciliation`,
`v_customer_invoices`, `v_customer_receipts`. Writes only
`customer_opening_balance`.

**Layout:** a summary bar (owed / in credit / to write off / signed off), six
`next_step` cards, a filterable/sortable customer table, and a per-customer
panel.

**The panel (VT-052, rebuilt):** shows EVERY receipt with what it was applied
to (colour-coded), OPEN invoices and CLOSED invoices in separate sections with
each invoice's dot matching the receipt that closed it, on-account money
flagged, a "do NOT write these off" warning on closed invoices, and the
negative-gap explanation. A sign-off form records status / who / when /
method / note.

**Filters:** customer search, status, sort by gap.

**Current limitations:** receipt matching only covers 17 Aug 2026 onward;
older settlement relies on the ledger, not traced receipts.

---

## VT_Inventory.html — inventory intelligence (newest)

**Purpose:** ABC/XYZ, days of cover, dead/excess/low/stockout flags, velocity.

**Data source:** Apps Script proxy `?app=inventory` → Supabase `v_inventory` /
`v_inventory_summary`.

**Features:** six clickable filter cards (All, Dead, Excess, Low, Stocked out,
Negative), punctuation-blind search, category/brand/ABC filters, every column
sortable, per-product panel with plain-English advice.

**Calculations:** ABC by revenue share, XYZ by active months, days of cover
from 90-day rate, flags per BUSINESS_RULES §7.

**Current limitations:** depends on `stock_live` being current (nightly push)
and on `v_sales_all` velocity being fresh.

---

## VT_Dashboard_11.html — pricing / verify (older)

**Purpose:** verified-pricing programme — a solver for margin/price/transport/
cost/discount, and marking a cost "verified" against a bill number.
**Status:** part of the pricing/product-master work the owner has **parked**.
Kept in V1 but not an active priority. VERIFY current state before relying on
it.

---

## VT_Receivables.html (earlier version)

An earlier receivables screen. Good ideas carried into VT_Recon: "untagged
money", cover, allocation, On Account / Advance handling. Superseded by
VT_Recon.html but referenced for features.

---

## Common conventions

- Theme: brand red `#CC3018`, stone/cream neutrals, tabular numerals.
- A **connect box** on the Supabase-backed screens accepts the `/exec` URL and
  stores it in `localStorage`; it rejects an `/a/macros/` URL (that needs a
  Google login the page cannot provide).
- Sticky headers: **do not put `overflow:hidden` on a table or any ancestor** —
  it silently disables `position:sticky` (this bit us twice).
- Stub-DOM render tests are run before shipping any dashboard change.
