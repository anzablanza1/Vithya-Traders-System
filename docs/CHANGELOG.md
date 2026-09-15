# CHANGELOG

Reconstructed from the build history across many sessions. Dates are
approximate where not tied to a logged event; the **order** is reliable, exact
calendar dates are marked VERIFY where uncertain. This is a narrative of what
changed and — more importantly — what was *corrected*, so the same mistakes
are not repeated.

The `VT-###` codes are the internal work-item numbers used during the build.

---

## Phase 1 — Apps Script + Sheets foundation
- Built the Vasy API pulls (products, sales, stock) into Google Sheets.
- Built the first floor and office dashboards reading Sheets directly.
- **Problem:** Sheets grew toward the ~10M-cell limit; dashboards slowed badly.
- **Fix:** introduced **read models** — small pre-computed blobs — so
  dashboards read tens of cells, not hundreds of thousands.

## Phase 2 — hardening after data loss
- **Incident:** a sales refresh deleted large ranges. Root cause: a trigger
  passes an **event object** as the first argument, which was treated as the
  date window, yielding `1970-01-01` and a huge delete window.
- **Fix:** the **purge guard** — refuse to delete >~25% of a tab in one
  window; refuse if <90% of sampled dates parse. Arguments are coerced so a
  trigger event can never become the window.
- **Incident:** a derived-table rebuild collapsed a table.
- **Fix:** the **rebuild guard** (`vtGuardRebuild_`).
- Added `whatIsLive()` after repeated confusion over whether a pasted fix was
  actually running (Apps Script silently shadows duplicate function names).

## Phase 3 — per-year sales workbooks
- Sales split into `VT_Sales_2526` and `VT_Sales_2627` to keep each workbook
  manageable. `sautTargets_` resolves the right year tab; the year-tab fix in
  `refreshSalesRecent`/`refreshInvoicesRecent` handles the split.

## Phase 4 — Supabase data warehouse + FTP pipeline
- Stood up Supabase (`kssydapdfmkfufrqhwzp`).
- Built `supabase.php` on Hostinger to load the nightly FTP CSVs into raw
  `*_data` tables (upsert per `voucher_no`, `.processed` on success).
- **Correction:** the first pipeline inserted with no key and **duplicated**
  every overlapping document on every run (the FTP file is a rolling window).
  Rewrote to **replace per document**. ~299 duplicate pairs (~₹4.7 lakh of
  phantom sales) had accumulated and were cleaned.
- **Correction:** service key had been shared → **rotated**; moved to a file
  outside the web root; `RUN_TOKEN` set to a non-default value.

## Phase 5 — sales history backfill
- `sales_history` table created; backfilled from the year workbooks
  (`SHEET-2526`, `SHEET-2627`) and the API (`API-2425`).
- **Correction:** the unique key was `(voucher, item, qty, net, source)`, but
  two invoices genuinely carry the same item twice at the same qty and amount,
  so a batch hit "ON CONFLICT cannot affect row a second time". Re-keyed on
  `(source, src_row)`.
- **Correction (recurring):** every Vasy API constant was initially wrong and
  then fixed against the working caller — page size (500 vs the 100 invoice
  cap), ISO-8601 UTC dates (plain dates → HTTP 400), the response list key
  (`salesItemRegisterData` vs `salesDataListDTOList`), the endpoint path
  (`/api/v1/report/...`), and the discount field (`totalDiscount`). Lesson:
  read the working caller first. (See DECISIONS D15.)
- Found and filled an **August gap** (1–7 Aug) where the sheet pull had died
  and the FTP window did not reach — pulled from the API.

## Phase 6 — invoices and receipts
- `sales_invoice` populated from the API; `balance` computed as
  `total − paid_amount` (the API does not return it directly).
- Discovered the **FTP sales feed carries no invoice link**
  (`invoice_id_db_id` = `'0'`), but the **receipt feeds carry `db_invoiceno`**
  from 17 Aug 2026. Built `v_receipts` linking receipt → `sales_invoice`.
- Receipt match rate rose from ~61% to **100%** of receipts that name an
  invoice, once the August invoice gap was filled.
- Built split-receipt allocation (attribute only when amounts add up; flag the
  rest).

## Phase 7 — the "views saw only FTP" correction (important)
- **Incident:** the owner noticed 30 July showed far too little. Root cause:
  every `v_agg_*` view read `v_sales` (FTP only, ~13k rows), not `v_sales_all`
  (~266k). The aggregates were blind to 95% of the data.
- **Fix:** repointed all aggregates to `v_sales_all`; created
  `v_sales_data_all` so large legacy views (`v_customer_360`) could see full
  history with a one-line change. `v_customer_360` customer value jumped from
  ₹96 lakh to ₹5.47 crore once corrected.
- **Correction:** a `CASCADE` while rebuilding `v_invoice_settlement` had
  silently dropped three receivables views; restored them.

## Phase 8 — margin bug
- **Incident:** the monthly rollup showed **−₹609 crore** profit.
- Root cause: `landing_cost` is a **LINE total**, multiplied by qty. Proved
  against the sheet's own profit column (5,001/5,001 rows). Fixed to
  `net − landing_cost`; margin came back to a sane **25.3%**.

## Phase 9 — reconciliation
- Loaded the two Vasy outstanding reports (`customer_ledger_snapshot`,
  `customer_invoice_outstanding`).
- Built the reconciliation model: agree one opening balance per customer,
  run forward on this year's clean data. The gap between ledger closing and
  invoice-detail outstanding is the write-off list.
- **Correction:** the first version subtracted for everyone, producing "₹17
  lakh to write off" against customers who were actually **in credit**.
  Separated customers who owe from those in credit; never net them.
- Built `VT_Recon.html`; rebuilt its panel into a full ledger (open + closed
  invoices, all receipts, colour-matched, on-account flagged).
- **Correction:** "Bad token" on the recon screen — the main `doGet` did not
  route `recon`/`inventory` before the token check. Fixed the ordering.
- **Correction:** the header would not freeze — `overflow:hidden` on the table
  disables `position:sticky`. Removed it. (Took two attempts to find.)
- **Correction:** the invoices call passed the customer name as a bare
  argument; the JSONP router reads `customer=`. Fixed.

## Phase 10 — dashboards on Supabase
- `buildSalesMonthly` repointed from a 285-second in-sheet grind to reading
  `v_sales_monthly_rollup` from Supabase (seconds).
- Confirmed office/floor read `Sales_Monthly`, which now comes from Supabase —
  so fixing the source flows through to every screen.

## Phase 11 — FTP header + empty-file fixes
- **Incident:** `product_data` and `vendor_data` loads failed for days.
- Root cause 1: the header cleaner left brackets/pipes, so
  `Ingredients [Seprated by pipe sign]` became a column that did not exist.
  Fixed to strip everything non-alphanumeric.
- Root cause 2: a header-only file (a normal quiet day) was treated as a
  failure and kept, so every run retried it. Fixed to mark `.processed`.

## Phase 12 — inventory + failover + stock/ERP push (most recent)
- Pushed live stock → `stock_live` and the ERP snapshot → `erp_snapshot`.
- Built `v_inventory` (ABC/XYZ, cover, flags) and `VT_Inventory.html`.
- Built the **FTP failover**: a 3 AM check; if FTP is stale, pull the missing
  days from the API into `sales_ftp_gap`, always push stock + ERP;
  `clearFtpGap()` empties it once FTP catches up.
- **Correction:** the first failover copied the sheets, which stop the day the
  pull died — rewrote to pull from the API.

## Phase 13 — this knowledge base
- Documented Version 1 in full and produced `FILES_TO_COLLECT.md` so the
  system can be made recoverable in GitHub before any redesign.

---

**VERIFY:** exact calendar dates for phases 1–5. The sequence and the
corrections are accurate; the wall-clock dates were not all logged.
