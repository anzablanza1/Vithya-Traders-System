# PROJECT_CONTEXT

## What Vithya Traders is

Vithya Traders is a **wholesale distributor of industrial and submersible
pump spares**, based in Coimbatore, Tamil Nadu. It sells pump parts —
bearings, seals, couplings, sleeves, studs, castings and similar — to
mechanics, rewinding works, pump service centres and other trade customers.

It is a **B2B counter and wholesale business**: customers buy across a
counter and on credit, and the catalogue is large and highly technical (part
descriptions are mostly sizes, e.g. `4 PEL 14*30/35*45 MM COUPLING AQA`).

Scale, as of this snapshot:
- ~6,900–7,000 distinct products (about 13,600 SKUs, see the lane rule below)
- ~270,000 sales lines across three financial years
- ~35,000 sales invoices
- ~700 active trade customers
- roughly ₹13–14 crore annual revenue, ~22–25% margin

The ERP is **Vasy** (vasyerp.com), a cloud ERP. Vithya Traders runs on Vasy;
everything this system does is built *around* Vasy, reading from it, never
replacing it.

**Related entities seen in the data:** "Vithya Solar" and "Vithya Traders"
are described by the owner as family businesses; this system is for **Vithya
Traders** (the pump-spares distributor). VERIFY any assumption that data
belongs to a different entity.

---

## Purpose of the system

The system exists to give the business **fast, trustworthy answers that Vasy
alone does not surface well**, specifically:

1. **A fast counter/floor view** — can we supply this part, how many are on
   the shelf, what did we last sell it for, what is on the way.
2. **An office analytics view** — sales, margin, movement, what to reorder,
   what is dead stock, what is selling below a trustworthy cost.
3. **Receivables and reconciliation** — who owes what, which receipts settled
   which invoices, and which old invoices can be safely written off.
4. **Inventory intelligence** — ABC/XYZ, days of cover, dead/excess stock.
5. **A durable data warehouse** in Supabase holding the full multi-year
   history that Vasy's own exports only cover partially.

The overarching goal the owner has stated: **Supabase should hold the real,
complete data; Google Sheets is the computation/analysis layer; dashboards
read fast, pre-computed results so there is no lag.**

---

## Current architecture (one paragraph)

Vasy is the source of truth. Data reaches the system two ways: a **nightly
FTP feed** drops CSV files that a **PHP script on Hostinger** loads into
**Supabase** raw tables; and **Google Apps Script** pulls other data from the
**Vasy API** into **Google Sheets** and, increasingly, pushes it to Supabase.
Supabase holds the durable multi-year history and a large set of **views**
that compute the business answers. Apps Script also builds nightly **read
models** (tiny pre-computed blobs) in Google Sheets so the **HTML
dashboards** load instantly. Dashboards are single HTML files that talk to
Apps Script **web apps** (`/exec` URLs) over JSONP, or — for reconciliation
and inventory — read Supabase through an Apps Script proxy. Full detail in
`ARCHITECTURE.md`.

---

## Major workflows

**Floor / counter (VT_Floor.html)** — staff search the catalogue, see live
stock combining GST and non-GST, quote a customer, log stock counts, raise PO
requests. Cost and supplier are deliberately never shown here.

**Office (VT_Office.html)** — sales analysis, inventory, ABC/XYZ, reorder,
product detail with both cost lanes, purchase progress. Reads nightly read
models for speed.

**Reconciliation (VT_Recon.html)** — per customer: the ledger balance vs the
open-invoice detail, every receipt and what it settled, and a sign-off to
agree an opening balance and mark write-offs.

**Inventory (VT_Inventory.html)** — live stock + velocity + ABC/XYZ + flags
(dead/excess/low/stockout/negative), reading Supabase directly.

**Nightly automation** — a chain of Apps Script triggers refreshes sales,
invoices, customers, stock, cost, analytics and read models overnight. See
`APPS_SCRIPT.md` and `ERP_INTEGRATION.md`.

---

## Important project history (short form; full timeline in CHANGELOG.md)

- The system began as Apps-Script-and-Sheets only, reading the Vasy API.
- Sheets grew to ~12 million cells and dashboards became slow; **read models**
  were introduced to fix load time.
- Several **data-loss incidents** occurred and led to hard guards (a purge
  that refuses to delete more than a quarter of a tab; a rebuild guard).
- Sales data was split into per-financial-year workbooks (2025-26, 2026-27).
- A **Supabase data warehouse** was added, fed by a **nightly FTP** pipeline
  (PHP on Hostinger), to hold the complete history and run fast queries.
- Historical sales were **backfilled** from the year workbooks and the API
  into Supabase.
- Receivables/reconciliation was built once the invoice register and receipt
  feeds made invoice-to-receipt linking possible.
- Inventory intelligence and the FTP-failover mechanism are the most recent
  additions.

---

## Current status (11 September 2026)

**Working and trusted:**
- Sales history in Supabase: 3 financial years, ~269,000 lines, ties across
  all views to the same total.
- Sales invoices, customer master, live stock, ERP snapshot: all populated.
- Reconciliation screen: working, with the full ledger and receipt matching.
- Inventory dashboard: built, data ready.
- Nightly automation: running (split into four jobs to fit execution limits).

**Known open items (see KNOWN_ISSUES.md):**
- `ofcActions_` is running an OLD version in the live project — an old file is
  shadowing it, so the office "below cost" grouping is wrong. **VERIFY / FIX.**
- FTP feed has been intermittently down; a failover pulls the gap from the API
  into a separate table (`sales_ftp_gap`).
- Receipt history before 17 Aug 2026 has no invoice link (a Vasy limitation).
- `product_data` FTP export is broken (delta only) — the ERP snapshot covers
  it instead.

---

## Things that MUST NOT be assumed or changed without checking

1. **`sales_data` is raw FTP and must never be written to by anything except
   the FTP pipeline.** All other sales sources live in separate tables. See
   `BUSINESS_RULES.md`.
2. **The lane rule** (trailing `/` on an item code = non-GST "WO"; leading `.`
   on a customer name = non-GST ledger). Never merge W and WO ledgers. See
   `BUSINESS_RULES.md`.
3. **Landing cost in old sales rows is unreliable.** Pre-2026 margin must not
   be treated as real.
4. **Vasy's invoice `balance` is the receivables truth**, not what receipts we
   can trace (tracing only covers 17 Aug 2026 onward).
5. **The floor dashboard must never show cost, supplier, or margin.** This is a
   deliberate business rule, enforced in code and repeatedly checked.
6. **Apps Script concatenates every `.gs` file; one duplicate function name
   silently overrides another.** Always run `whatIsLive()` before assuming a
   fix is live. See `APPS_SCRIPT.md`.
7. **The owner is a non-coder** and pastes code by hand. Every instruction must
   name the file to paste and whether a redeploy is needed.
