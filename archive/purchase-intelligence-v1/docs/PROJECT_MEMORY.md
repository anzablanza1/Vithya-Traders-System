# PROJECT_MEMORY.md — Vithya Traders Purchase Intelligence (V1 FROZEN)

> **Read this first.** This is the master handoff describing the **exact current truth of V1**
> immediately before the V2 (multi-PO Shipment/Bill) redesign begins. V1 is now an **archive/reference**.
> Nothing here is a proposal — it is what exists and runs today. Rejected/old designs are marked as such.
> Anything not verifiable from the frozen files is marked **NEEDS LIVE VERIFICATION**.

App version at freeze: **v8.6 · "Noyyal"**. Frozen files: `VT_Purchase_Intelligence_V1.html`,
`PORequest_index_V1.html`, `GoodsCheckApi_V1.gs`, `LiveApi_v7.2.gs`, `RegisterApi.gs`,
`PORequest_Thamirabarani_v9.gs` (Code.gs). Change history: `CHANGE_REGISTER_V1.md`.

## 1. What the system is
A single-file, browser-based **Purchase Intelligence dashboard** (one large self-contained HTML file,
no build step) for Vithya Traders (submersible-pump spares wholesaler, Coimbatore) plus a companion
**PO-Request web app** (Google Apps Script + HTML) used by sales/inventory to raise purchase requests.

The dashboard turns the **purchase register** (historical purchase bills) into analytics, and manages the
**PO lifecycle**: request → PO builder → PO tracking (split GST/Non-GST, send to supplier, record
shipments as "lots", receive, bill/material-inward for Vasy upload) → history/analytics/fund planning.

Vasy = the ERP (separate). Tally also used for accounts. GST convention baked in everywhere:
**item code with a trailing `/` = Non-GST; without `/` = GST.** Supplier with a leading `.` = Non-GST party.

## 2. What is LIVE and operationally used
- **Purchase Intelligence dashboard** (the big HTML) — used daily in Management/Follow-up/Ops modes.
- **PO-Request app** — used by requesters; submissions flow into the shared Google Sheet.
- **Google Apps Script web app** (one project, bound to the PO-Request sheet) exposing `LiveApi`,
  `RegisterApi`, `GoodsCheckApi`, and the PO-Request `Code.gs`.
- **Supabase** table `purchase_bill_data` — the live purchase register source (pulled via the server).
- **Google Sheets** — operational store for PO tracking, lots, meta, receipts, suppliers, requests,
  product master, and the analytics/fund pushes.

## 3. Major modules (dashboard) — what each does
- **Dashboard** — management KPIs: spend, reorder signals, data quality, top items/suppliers, levels.
- **Search** — fuzzy/strict product search over the register; product insights + charge history.
- **Full Data** — filterable purchase register table.
- **MOQ · EOQ · Levels** — confirmable per-item quantities (uses purchase outflow as a sales proxy).
- **Requests** — live PO-request funnel (from the PO-Request app), progress bars.
- **PO Builder** — cart; unified search across register + master + previously-ordered; per supplier×lane
  downloadable 7-column upload files (GST and Non-GST always separate).
- **PO Tracking** — the operational core. Views (tabs): **Overview, Daily brief, Board, Follow-up,
  By PO, By product (Summary / List-by-PO), By bill, PO History, Analytics, Fund planning, Goods check.**
  Statuses combine (multi-select): Created/Sent/Shipped/Part shipped/Part received/Received/Billed/
  Split/Excess/Cancelled, plus Scope (Open only / All).
- **PO detail** — two tabs: **Products & lots** and **Actions**. Lots = shipments (V1 term "lot"),
  split GST/Non-GST per lot, bill/material-inward creation per lot, goods check, move-items, close/cancel.
- **Fund planning** (mgmt only) — value of open POs (transit/pending/received), PDF/Excel with preview.
- **Analytics** (mgmt only) — SKU × supplier: lead time, fill rate, OTIF, MOQ inference; push to sheet.
- **PO History** (followup+mgmt) — closed POs, editable, with closed-PO analytics.
- **Goods check** — read-only PO status (qty + dates), A5 PDF; also a copy in the PO-Request app
  (quantity/status only — **never** supplier/rate/amount there).

## 4. Stable vs unfinished vs known-wrong (summary; see CURRENT_FEATURES / KNOWN_ISSUES)
- **Stable/working:** register pull (Supabase + sheet fallback), search ranking (dimension-aware),
  PO builder, PO tracking board/views, split-bill, lots, meta sync (closed/approved/billed/promised),
  goods check (both dashboards), fund planning, analytics, notes (PO + per-line), follow-up notes/to-dos.
- **Partial / by-proxy:** sales data not connected — EOQ/reorder use purchase outflow as a proxy;
  live product database not integrated — master comes from the Products sheet tab.
- **Known-wrong / the reason for V2:** **bill/split-bill is locked to one lot inside one PO.** Real
  shipments span multiple POs; tallies don't reconcile. This is what V2 redesigns. (Do not "fix" in V1.)

## 5. Files that FORM the current system
| File | Role | Where it runs |
|------|------|---------------|
| `VT_Purchase_Intelligence_V1.html` | The whole dashboard (HTML+CSS+JS, one file) | Opened as a local file / hosted static |
| `PORequest_index_V1.html` | PO-Request app UI (served by Apps Script `doGet`) | Apps Script web app |
| `PORequest_Thamirabarani_v9.gs` (Code.gs) | PO-Request server: requests, products master, statuses, drafts | Apps Script project |
| `LiveApi_v7.2.gs` | PO tracking/meta/lots/receipts/suppliers read-write + Supabase register proxy + writeSheet | same Apps Script project |
| `RegisterApi.gs` | Read-only pull of the `Purchase_Register` sheet (fallback register source) | same Apps Script project |
| `GoodsCheckApi_V1.gs` | `getGoodsCheck()` for the PO-Request Goods Check tab (qty/status only) | same Apps Script project |

## 6. Historical / rejected (NOT current truth)
- Earlier "**LIFO**" allocation idea → **rejected**. V2-approved rule is **FIFO as a suggestion only,
  fully editable** (see BUSINESS_RULES_CURRENT.md).
- Earlier attempt to add **supplier + rate** columns to the PO-Request Goods Check → **reverted**;
  the request app is quantity/status only.
- "Separate nav buttons" for History/Fund/Analytics/Goods → tried, then **reverted** to tabs inside PO Tracking.
- Various superseded PDF/Excel layouts and the pre-v8 lot/status models — see `CHANGE_REGISTER_V1.md`.

## 7. The one-line mental model
**Register (Supabase) → analytics.  Requests → PO Builder → PO Tracking (lots = shipments, split
GST/Non-GST, bill for Vasy) → History/Fund/Analytics.  Operational state lives in Google Sheets;
register history lives in Supabase.**
