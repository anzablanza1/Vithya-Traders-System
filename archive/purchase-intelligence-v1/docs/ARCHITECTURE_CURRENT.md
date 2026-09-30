# ARCHITECTURE_CURRENT.md — V1 (frozen)

Exact current architecture and data flow. Marks the path **actually used** for each concern.

## Components
- **Vasy (ERP)** — source of purchase bills; also the upload target for material inward.
- **Supabase** project `kssydapdfmkfufrqhwzp.supabase.co`, table **`purchase_bill_data`** — the live
  purchase register (bill-line history). How Vasy → Supabase is populated is external to these files
  (FTP/API/ETL) — **NEEDS LIVE VERIFICATION** for the exact pipeline.
- **Google Sheets** — operational store (see GOOGLE_SHEETS.md). Two workbooks matter:
  - **PO-Request workbook** (bound to the Apps Script project): tabs `PO Requests, Products, Drafts,
    Settings, Names, Statuses` + LiveApi-managed tabs `PO Tracking, Lots, Lot Lines, Receipts, PO Meta,
    Suppliers, Audit Log, Closed, Archive` + analytics/fund push tabs.
  - **Register workbook** `1uBS4vD24jihfjrHH2OFoBerRASpytmqjQK-_H-Y0XdU`, tab **`Purchase_Register`**
    (read-only fallback source for the register).
  - **Supplier workbook** `1Uc2ba4AjU_0ojhoyhkHtfvAK0tJtgmWbI7xOGBpV3VY` (suppliers list; SUP_SHEET_ID).
  - **Product master workbook** `1fVUY4JinmlovVLfQO6fkDL8ghElDeslCr_pZDHYpq7s` (MASTER_ID) — referenced by Code.gs.
- **Apps Script web app** — ONE project (bound to the PO-Request workbook) containing `Code.gs`
  (PORequest_Thamirabarani_v9), `LiveApi_v7.2.gs`, `RegisterApi.gs`, `GoodsCheckApi.gs`. One `/exec`
  deployment serves all of them (routing by `?api=` / `action`).
- **Purchase Intelligence dashboard** — static HTML, talks to the web app via `fetch` (GET/POST).
- **PO-Request app** — HTML served by the same Apps Script `doGet`; talks to server via `google.script.run`.

## Data flow — by concern (● = path actually used)

### Purchase register (history for analytics/search/Full Data)
● **Supabase `purchase_bill_data`** → LiveApi `api=register` (server holds `VT_SB_KEY` service-role key,
  paged REST read) → dashboard ingests via `SB_COLMAP` → cached in browser **IndexedDB** (`REG_DB`).
○ **Fallback:** RegisterApi `api=register`(sinceId) reads the `Purchase_Register` sheet tab if Supabase
  fails or the user chooses "upload a file instead". Also supports direct `.xlsx/.csv` upload.

### PO workflow (builder → tracking → lots → bills)
● Dashboard state in browser (`localStorage` `vt_session_v2`) **and** mirrored to Google Sheets via
  LiveApi POST actions (`record`, `lot`, `meta`, `receive`, `lotDelete`, `archive`). **The sheet is the
  source of truth** (v7.3+): on each sync, POs not on the sheet are dropped unless queued in the outbox.
  A durable **outbox** (`vt_outbox`) retries failed writes.

### Requests
● PO-Request app writes to `PO Requests` tab (Code.gs). Dashboard reads via LiveApi `api=data`
  (returns `requests`, `products`(master), `statuses`, `tracking`, `receipts`, `suppliers`, `poMeta`,
  `lots`, `lotLines`, `security`, `closedLineIds`).

### Analytics / Fund planning
● Computed **in the browser** from register + PODOCS. Optional **push to sheet** via LiveApi
  `api=writeSheet` (tabs `Analytics · SKU Summary`, `Analytics · SKU Supplier`, `Fund Planning`) so an
  external inventory dashboard can fetch them.

### Stock
○ **Not a live feed.** Stock lives in Vasy; the dashboard does **not** read live stock. "Received, not
  uploaded" is tracked operationally so users know what isn't yet live in Vasy. **NEEDS LIVE VERIFICATION**
  if any stock figure is surfaced anywhere.

### Goods Check
● Dashboard: computed from PODOCS/lots; A5 PDF client-side.
● PO-Request app: `GoodsCheckApi.getGoodsCheck()` reads PO Tracking + Receipts + Lots + PO Meta and
  returns qty+dates only (no supplier/rate).

### Lots / shipments
● V1 models a **lot = one shipment inside one PO**. Stored in `Lots` + `Lot Lines` tabs; mirrored in
  PODOCS. (V2 will replace this with cross-PO Shipments — not in V1.)

### Bills / material inward
● Created **per lot** in the dashboard (split GST/Non-GST, charges, round-off, Vasy bill no). Stored on
  the lot (Charges JSON / Totals JSON columns in `Lots`). **Weakness:** one-lot-one-PO only (V2 target).

### Vasy upload
● The dashboard generates the **7-column upload file** per supplier×lane (PO Builder) and the
  material-inward/upload file from a lot. Actual upload into Vasy is done by the user with that file.
  **No direct API write to Vasy from these files** — **NEEDS LIVE VERIFICATION** of any auto-upload.

## Auth / security
- LiveApi/RegisterApi/GoodsCheckApi share `VT_API_TOKEN` (Script Property). Dashboard stores exec URL +
  token in `localStorage` `vt_live_cfg` (Management mode).
- Access tiers (Ops / Follow-up / Management) gated by PINs hashed with `VT_PIN_SALT` + `VT_PIN_FOLLOW`
  / `VT_PIN_MGMT` (Script Properties). Supplier names/rates/values hidden outside Management/Follow-up.
