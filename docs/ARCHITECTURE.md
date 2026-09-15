# ARCHITECTURE

## The whole picture

```
                            ┌─────────────┐
                            │    VASY      │   cloud ERP — the source of truth
                            │  (vasyerp)   │   counter sales, invoices, stock,
                            └──────┬──────┘   receipts, purchases, customers
                                   │
                  ┌────────────────┴────────────────┐
                  │                                  │
            NIGHTLY FTP                         VASY REST API
          (CSV files, 2 AM)                  (api.vasyerp.com,
                  │                            header: api-token,
                  │                            branch_id 21024)
                  ▼                                  │
        ┌──────────────────┐                        │
        │  Hostinger PHP    │                        │
        │  supabase.php     │                        │
        │  (cron ~2 AM)     │                        │
        └────────┬─────────┘                         │
                 │ upserts raw CSV                    │
                 ▼                                    ▼
        ┌───────────────────────┐        ┌──────────────────────────┐
        │      SUPABASE         │◄────────│   GOOGLE APPS SCRIPT      │
        │  (Postgres)          │  pushes  │  "product database"      │
        │                      │  API data│  project                  │
        │  raw *_data tables   │          │  - pulls Vasy API         │
        │  sales_history       │          │  - writes Google Sheets   │
        │  sales_invoice       │          │  - pushes to Supabase     │
        │  stock_live          │          │  - builds read models     │
        │  erp_snapshot        │          │  - serves dashboards      │
        │  ~34 views           │          └───────────┬──────────────┘
        └──────────┬───────────┘                      │
                   │                                   │ writes
                   │ read by                           ▼
                   │                        ┌──────────────────────────┐
                   │                        │     GOOGLE SHEETS         │
                   │                        │  VT_Transactions          │
                   │                        │  VT_Sales_2526 / _2627    │
                   │                        │  VT_Analytics             │
                   │                        │  product database system  │
                   │                        │  Stock_Live, read models  │
                   │                        └───────────┬──────────────┘
                   │                                    │ read models
                   ▼                                    ▼
        ┌──────────────────────────────────────────────────────────┐
        │                     HTML DASHBOARDS                        │
        │  VT_Floor.html      (via Apps Script web app, JSONP)      │
        │  VT_Office.html     (via Apps Script web app, JSONP)      │
        │  VT_Recon.html      (via Apps Script proxy -> Supabase)   │
        │  VT_Inventory.html  (via Apps Script proxy -> Supabase)   │
        │  VT_Dashboard_11    (pricing/verify, JSONP)               │
        └──────────────────────────────────────────────────────────┘
```

---

## Components, one by one

### 1. Vasy ERP
The system of record. Everything downstream is a copy or a computation over
Vasy data. Two ways out of Vasy:

- **REST API** — `https://api.vasyerp.com`, header `api-token`, branch_id
  `21024`. Rate-limited (roughly 5 requests/minute on the report endpoints).
- **Nightly FTP** — Vasy drops CSV exports; free; no rate limit; the intended
  bulk feed.

### 2. Hostinger PHP pipeline (`supabase.php`)
Runs on a Hostinger cron (~2 AM). Reads the FTP CSV files, cleans headers,
and **upserts** them into the Supabase raw `*_data` tables. Key properties:
- Replaces per document (per `voucher_no`) so re-sent/edited documents update
  cleanly.
- Has a shrink guard and aborts on malformed files.
- Renames a file to `.processed` only on success.
- Guarded by a `RUN_TOKEN` so a stray request cannot trigger a sync.
- Reads the Supabase service key from a file **outside the web root**
  (`/home/u631621082/supabase_key.txt`).

### 3. Supabase (Postgres)
The durable warehouse. Holds:
- **Raw FTP tables** (`sales_data`, `purchase_bill_data`, `cash_receipt_data`,
  etc.) — never written by anything but the PHP pipeline.
- **API/backfill tables** (`sales_history`, `sales_invoice`, `stock_live`,
  `erp_snapshot`, `sales_ftp_gap`, `customer_master`, the two outstanding
  reports).
- **~34 views** that compute the business answers. `v_sales_all` is the
  central one: it unions every sales source, one row per voucher, FTP winning.
Full list in `DATA_DICTIONARY.md` and `SUPABASE.md`.

### 4. Google Apps Script — "product database" project
One Apps Script project bound to a Google Sheet. It:
- Pulls the Vasy API (products, invoices, customers, cost, stock).
- Writes to several Google Sheets workbooks.
- Pushes selected data to Supabase.
- Builds nightly **read models** (small JSON blobs) for dashboard speed.
- **Serves the dashboards** as web apps and answers their data calls.
See `APPS_SCRIPT.md` for the file list and triggers.

### 5. Google Sheets workbooks
- **product database system** (a.k.a. master) — ERP snapshot, pricing,
  product analytics, dashboard read models, config.
- **VT_Transactions** — stock history, counts, invoices, receipts, Stock_Live.
- **VT_Sales_2526 / VT_Sales_2627** — per-financial-year sales items and
  invoices.
- **VT_Analytics** — sales monthly rollup, product analytics, customer
  outstanding, customer prices, read models.
- **VT_Stock** — live stock (its own file).
- Others for receivables, reconciliation staging, customer outstanding.
Exact IDs are held in Apps Script Script Properties (see `SECURITY.md`).

### 6. HTML dashboards
Single self-contained HTML files. Two connection patterns:
- **JSONP to an Apps Script web app** (floor, office, pricing) — the web app
  reads Google Sheets read models and returns JSON.
- **JSONP to an Apps Script proxy that reads Supabase** (reconciliation,
  inventory) — the service key stays server-side in Apps Script; the browser
  never holds it.

---

## Data flow, by dataset

**Sales lines**
```
Vasy ──FTP──> sales_data (raw, ~14-day rolling window)
Vasy ──API──> year workbooks ──backfill──> sales_history (full history)
Vasy ──API──> sales_ftp_gap  (only when FTP is down)
                    │
                    ▼
              v_sales_all  (unions all three; FTP > API-gap > sheet-history,
                            one row per voucher)
                    │
                    ▼
   v_sales_monthly_rollup ──> buildSalesMonthly ──> Sales_Monthly sheet
                    │                                      │
                    ▼                                      ▼
          v_agg_* aggregates                       office read model ──> office/inventory
```

**Invoices and receipts**
```
Vasy ──API──> sales_invoice  (sales_id = the invoice db id)
Vasy ──FTP──> cash_receipt_data / bank_receipt_data  (db_invoiceno, 17 Aug on)
                    │
                    ▼
              v_receipts (receipt ─ db_invoiceno ─> sales_invoice.sales_id)
                    │
                    ▼
   v_invoice_settlement ──> v_reconciliation ──> VT_Recon.html
```

**Stock**
```
Vasy ──API──> Stock_Live sheet ──push──> stock_live table
                    │                         │
                    ▼                         ▼
             floor dashboard          v_inventory ──> VT_Inventory.html
```

---

## Dependencies (what breaks what)

- **If FTP stops:** raw `*_data` tables freeze. Sales are covered by the API
  failover into `sales_ftp_gap`; receipts and purchases are not, so they go
  stale until FTP resumes.
- **If the Vasy API rate-limits:** cost sweep (`Cost_Current`) and invoice
  pulls slow or pause; they resume next run.
- **If a `.gs` file is duplicated:** one function silently overrides another.
  `whatIsLive()` is the diagnostic.
- **If read models are not rebuilt:** dashboards fall back to reading the whole
  analytics table and become very slow.
- **If `v_sales_all` is repointed or a source double-counts:** the health
  check (`v_agg_sales_daily` total == `v_sales_all` total) diverges.
