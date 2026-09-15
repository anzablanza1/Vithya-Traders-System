# SUPABASE

**Project ref:** `kssydapdfmkfufrqhwzp` (name: Vithya Traders, plan: Free at
snapshot). Postgres. Region/other details: VERIFY in the Supabase dashboard.

Supabase is the durable warehouse: the complete multi-year history plus the
views that compute every business answer. Google Sheets is the computation
layer for the Apps Script side; Supabase is where the real, queryable data
lives.

---

## Table classes

- **RAW FTP** — written only by the Hostinger PHP pipeline: `sales_data`,
  `purchase_bill_data`, `material_inward_data`, `stock_adjustment_data`,
  `cash_receipt_data`, `bank_receipt_data`, `cash_payment_data`,
  `credit_note_data`, `purchase_return_data`, `product_consumption_data`,
  `vendor_data`, `product_data`. Each carries `source` + `loaded_at`.
- **API / backfill** — written by Apps Script: `sales_history`,
  `sales_invoice`, `sales_ftp_gap`, `stock_live`, `erp_snapshot`,
  `customer_master`.
- **Uploaded reports** — `customer_ledger_snapshot`,
  `customer_invoice_outstanding` (from Vasy exports, per `as_at`).
- **Human sign-off** — `customer_opening_balance`.
- **Dead** — `ops_pipeline_snapshots` (drop when sure).

Full column lists and row counts: `DATA_DICTIONARY.md`.

---

## Views

~34 views. The organising ideas:

- **`v_sales_all`** is the spine — unions all sales sources, one row per
  voucher, FTP > API-gap > sheet-history. Every sales aggregate reads it.
- **`v_sales_data_all`** re-presents that in `sales_data`'s text shape so
  older views (e.g. `v_customer_360`) see full history with a one-line change
  (`FROM sales_data` → `FROM v_sales_data_all`).
- Aggregates, receivables, reconciliation, customer, inventory, purchase — see
  `DATA_DICTIONARY.md` for each.

**Naming convention:** many views/comments carry a `VT-DW-###` tag from the
data-warehouse build sequence. These are historical build references, not
runtime identifiers.

---

## Ingestion flows

1. **FTP → raw tables** (PHP, ~2 AM): upsert per `voucher_no`, `.processed`
   rename on success.
2. **API → sheets → Supabase** (Apps Script, nightly): invoices, customers,
   stock, ERP snapshot pushed via the PostgREST REST API using the service
   key, in chunks of ~500 with a short gap, upsert on the conflict key.
3. **API failover → `sales_ftp_gap`** (Apps Script, 3 AM if FTP stale).
4. **Uploaded reports → tables** (Apps Script reads a Google Sheet the owner
   saved from a Vasy export).

All writes are **upserts** on a conflict key, so re-running is safe.

---

## Scheduled processes inside Supabase

At snapshot there are **no pg_cron / Supabase Edge Function schedules** — all
scheduling is in Apps Script and the Hostinger cron. VERIFY: check
`cron.job` and Edge Functions in the dashboard before assuming none exist.

---

## Security considerations

- **Two keys:** the `service_role` key (full access, bypasses RLS — used
  server-side only, in Apps Script Script Properties and in the Hostinger key
  file) and the `anon`/publishable key (**not currently used** — no dashboard
  holds it).
- **RLS is ON for every table but has zero policies**, which means: with the
  service key, full access; for `anon`, nothing. This is safe as long as no
  browser ever holds the service key. Every dashboard reaches Supabase through
  an Apps Script proxy, so the key stays server-side.
- **Supabase's linter flags every view as "Security Definer — CRITICAL".**
  This only matters if the `anon` key is ever exposed; since it is not, the
  door described is not reachable. To clear it later: recreate views with
  `security_invoker = true` and add RLS SELECT policies — only worth doing if
  the anon key is ever put in a browser.
- **The service key was rotated** after an earlier one was shared; the
  Hostinger key file and the Apps Script property were updated. See
  `SECURITY.md`.

See `SECURITY.md` for the full credential map.

---

## Recreating the database

To rebuild Supabase from scratch you need the **SQL definitions of every
table and every view**. These have been created incrementally via migrations
during the build. **They are NOT yet all collected into this repo** — see
`FILES_TO_COLLECT.md`. Until they are, the live database is the only complete
copy of the view logic.

The fastest way to export them: from the Supabase SQL editor,
`pg_get_viewdef()` for each view and the table DDL from the dashboard, or use
`supabase db dump`. This is a priority collection task.
