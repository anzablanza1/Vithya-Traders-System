# ERP_INTEGRATION

Vasy (vasyerp.com) is the source of truth. Data leaves Vasy two ways: the
**REST API** and the **nightly FTP export**.

---

## Vasy REST API

- **Base:** `https://api.vasyerp.com`
- **Auth:** HTTP header `api-token: <token>` (the token is a Script Property,
  not in any file — see `SECURITY.md`)
- **Branch:** `branch_id` / `branch_list` = `21024`
- **Rate limit:** roughly **5 requests per minute** on the report endpoints.
  Exceeding it returns HTTP 429 "Too many request, please try after 60
  seconds". Respect ~13–20s between calls.

### Confirmed endpoints (VERIFY exact query params against the live code)

| endpoint | method | returns | notes |
|---|---|---|---|
| `/product/products-inventory` | GET | stock per SKU | takes `branchId`, `fromDate`, `toDate` (ISO 8601 UTC). fromDate/toDate are the PERIOD (financial year), not a modified filter. |
| `/product/details` | GET | product cost/price detail | used by Cost_Current sweep; the slow one |
| `/api/v1/report/sales-item-register/invoice` | POST | sales lines | body: `branch_list, from_date, to_date` (ISO 8601 UTC), `limit` (**max 500**), `offset`. List key in response: **`salesItemRegisterData`** |
| `/api/v1/sales/get-all-sales-orders` (invoice register) | POST | invoices | `limit` **max 100**. List key: `salesDataListDTOList` |
| `/api/v1/customers?branch_id=&limit=&offset=` | GET | contacts | `limit` cap negotiated (~50); returns contactId, mobNo, whatsAppNo, gstin |
| `/api/v1/sales/{id}` | GET | one invoice incl. `receipt[]` | per-invoice; rate-limited ~4/min; the only API path to receipt links |

### Hard-won API facts (each cost a debugging cycle — see CHANGELOG)
- **Dates must be ISO 8601 UTC** (`2026-04-01T00:00:00Z`). Plain `yyyy-MM-dd`
  returns HTTP 400.
- **`fromDate`/`toDate` are the reporting PERIOD**, not an incremental filter.
  A window also returns older documents that were *edited* in it (useful for
  catching back-dated edits).
- **Page-size caps differ per endpoint:** item register 500, invoice register
  100, customers ~50. Read the working caller; do not guess.
- **Stock cannot be pulled incrementally** — a sale does not "edit" the
  product record. Pull whole.
- **The list key differs per endpoint** — `salesItemRegisterData` vs
  `salesDataListDTOList`. Do not assume.
- **Receipt endpoints `/api/v1/receipt/...` return 403** — path exists, token
  not scoped. An open ask to Vasy.

---

## Nightly FTP feed

- Vasy drops **CSV files** onto FTP (filenames like
  `SalesItemRegister_21024_<date>.csv`, `VendorData_...`, `ProductData_...`).
- Free, no rate limit — the intended bulk feed.
- **Hostinger cron (~2 AM)** runs `supabase.php`, which loads them into the
  Supabase raw `*_data` tables.
- Files carry a **`source` column and a load timestamp**, added so raw data is
  identifiable by origin.
- **Header quirk:** Vasy headers contain brackets and pipes, e.g.
  `Ingredients [Seprated by pipe sign]`, `Type (Manufacturer || Stockiest ||
  ...)`. The cleaner must strip **everything non-alphanumeric** (a fix — the
  old cleaner left brackets/pipes and the load failed).
- **Empty files are normal** (a day with no vendors added) — mark them
  `.processed`, do not treat as failure.
- **What the FTP carries:** sales items, purchases, receipts (cash & bank,
  from 17 Aug 2026), material inward, stock adjustments, vendors, credit
  notes, cash payments. **Sales invoices are NOT on FTP** — they come by API.
- **`product_data` FTP export is a delta** (changed products only) — broken as
  a master; use the API/ERP snapshot.

---

## Apps Script jobs and schedule (the nightly chain)

The chain was **split into four jobs** because the whole thing is ~16 minutes
of work and a single triggered execution only gets ~6 minutes (it used to die
part-way, silently). Approximate schedule (VERIFY against the live trigger
list via `whatIsLive()`):

```
01:10  refreshErpSnapshot        product master edits (stock comes from Stock_Live)
02:00  refreshPurchaseRegister   purchase register (cursor-based, long)
02:00  Hostinger FTP cron        (external) loads CSVs to Supabase
03:00  ftpFailoverCheck          if FTP stale, pull API gap + push stock/ERP
03:57  rebuildBatchCost          batch cost
05:00  refreshCostCurrent        cost sweep (rate-limited, ~20/run, resumes)
04:30  nightlyInvoiceSync        pull last 7 days of invoices -> Supabase
05:30  refreshInvoicesRecent     invoice year tabs (7-day window)
05:47  rebuildDashData           legacy dash data
06:00  refreshSalesRecent        sales lines (7-day window)
22:00  nightlyRollup             Sales_Monthly (from Supabase), Product_Analytics
22:20  nightlyCustomers          outstanding, customer master, customer prices
22:40  nightlyStock              live stock, PO status
23:00  nightlyModels             digest snapshot, read models
23:30  nightlyDetectCounts       confirm stock counts from Vasy
```

- Only the **last 7 days** are re-pulled for sales/invoices; older rows are
  treated as settled. For a deeper edit, run `refreshSalesRecent(60)` by hand.
- The refresh functions coerce their `days` argument because **Apps Script
  passes a trigger an event object** as the first argument — a past bug let
  that object become the date window and produced `1970-01-01` (deleting
  nothing only because the purge guard caught it).

---

## Failure handling

- **Purge guard:** the sales refresh refuses to delete more than ~25% of a tab
  in one window, and refuses if fewer than 90% of sampled dates parse. This
  has prevented at least two data-loss events.
- **Rebuild guard:** derived-table rebuilds that would collapse a table are
  refused.
- **FTP failover (`FtpFailover.gs`):** a 3 AM check; if the newest FTP sales
  row is stale, it pulls the missing days from the API into `sales_ftp_gap`
  (ranked below FTP in `v_sales_all`) and always pushes stock + ERP. Run
  `clearFtpGap()` once FTP catches up.
- **Resumable pulls:** long pulls (customers, cost, backfills) save a cursor
  and continue next run rather than restarting.

---

## Known issues (see KNOWN_ISSUES.md for the full list)
- Receipt endpoints 403 (token scope) — historical receipt-to-invoice links
  cannot be pulled at scale.
- `Cost_Current` crawls (~20/hour) against the rate limit; a productId
  validation error can pause it (`Please validate productId ...`).
- FTP has been intermittently down; complaint raised with Vasy.
