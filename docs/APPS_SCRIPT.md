# APPS_SCRIPT

There is **one Apps Script project** ("product database", bound to a Google
Sheet). Apps Script **concatenates every `.gs` file** in a project into one
namespace, so **two files defining the same function name → one silently
wins, no warning.** This has caused real, hard-to-see bugs. Always diagnose
with `whatIsLive()`.

> **Filenames below are the working names used during the build.** The exact
> names in the live editor may differ slightly (the owner has pasted files by
> hand and named some differently — e.g. `Whatislive.gs`, `sales automation.gs`).
> Treat this as the intended set; VERIFY against the live editor's file list.

---

## The diagnostic that matters: `WhatIsLive.gs`

`whatIsLive()` reads the **live** function bodies (via `String(fn)`) and
reports, for each key function, whether the running version contains a marker
only the fixed version has — so a stale paste or a shadowing duplicate shows
as OLD. It also lists installed triggers and key sheet/row counts.
`findDuplicate()` prints the live source of a suspected shadowed function so
you can find which file defines it. **Run this before trusting any fix.**

---

## Files by purpose

### Core plumbing
- `Registry.gs` — `vtSheet(name)` finds a tab in whichever workbook holds it;
  `anaBook_()`, `txnBook_()`, book-id resolution; `vtHeader_` shared header
  guard; `vtGuardRebuild_` rebuild guard; `vtInvalidate()` cache clear.
- `WhatIsLive.gs` — the diagnostic above.
- `DataCatalog.gs`, `DataAudit.gs`, `ConnectionCheck.gs` — inventory/audit.

### Vasy API pulls
- `VasyApiPull_v3.gs` — product/inventory pull (the canonical, working pull).
- `SalesItems.gs`, `SalesAutomation.gs` — sales-line pull + the nightly chain
  (`refreshSalesRecent`, `refreshInvoicesRecent`, `nightlyRollup`,
  `nightlyCustomers`, `nightlyStock`, `nightlyModels`, `installSalesTriggers`,
  `sautWindow_`, `sautPurge_` guard, `sautTargets_` year-tab resolver,
  `buildSalesMonthly`, `diagnoseSalesDates`, `fixSalesDateColumns`).
- `SalesOrderList.gs`, `SaleDetail.gs`, `SalesPullFinish.gs`, `SalesSplit.gs` —
  invoice list, per-sale detail, finishing/splitting sales into year tabs.
- `CustomerMaster.gs` — `pullCustomers()` (page-size negotiation, resumable).
- `LiveStock.gs` — `pullStock`/`pullStockNow` (whole-list, resumable),
  `Stock_Live` writer.
- `StockCalibrate.gs` — the stock calibration (`api − offset` vs Stock
  Register); `StockHistory.gs`, `StockCount.gs`, `StockRecon.gs`.
- `PurchaseRegister_v2.gs`, `VasyCostEnrichment_v2.gs`, `PhaseB_CurrentCost.gs`
  — purchase register and cost sweeps.

### Analytics / read models
- `ProductAnalytics.gs` — `buildProductAnalytics` (the 63-column analytics with
  W/WO split, CHECK COST flag, category-relative margin, cost lanes).
- `ReadModels.gs` — builds the floor/office/pricing/office_raw read models;
  `rmRawText` for the pre-serialised office payload.
- `Automation.gs` — `refreshErpSnapshot` (note: incremental is right for the
  product master; **stock comes from Stock_Live, not this**),
  `refreshPurchaseRegister`, `refreshCostCurrent`, `rebuildBatchCost`,
  `rebuildDashData`.

### Supabase push / sync
- `SalesInvoiceSync.gs` — invoice register → `sales_invoice`; nightly invoice
  trigger; gap-fill wrappers.
- `SalesBackfill.gs` — one-time sheet → `sales_history` backfill (keyed on
  `source, src_row`; skips vouchers already in `sales_data`).
- `SalesApiBackfill.gs` — API → `sales_history` for FY24-25 and the August gap.
- `FtpFailover.gs` — `ftpFailoverCheck`, `pushStockToSupabase`,
  `pushErpToSupabase`, `fovPullGap_` → `sales_ftp_gap`, `clearFtpGap`.
- `ReconciliationLoad.gs` — loads the two Vasy outstanding reports.
- `ReceiptRegisterSync.gs` — pushes the Receipts sheet → `receipt_register`.
- `CustomerMaster.gs` also pushes customers (a Supabase-push variant existed,
  edited by the owner).

### Dashboard web apps (`doGet` routing)
- `DashboardAPI_v2.gs` — the main `doGet`. Routes by `?app=`:
  `office` → `doGetOffice`, `floor` → `doGetFloor`, `recon` → `doGetRecon`,
  `inventory` → `doGetInventory`; otherwise the pricing dashboard (token-
  checked). **Recon and inventory are routed BEFORE the token check** — a
  past "Bad token" bug was exactly this ordering.
- `FloorAPI.gs` — `doGetFloor` + the floor read model API (search, quote,
  alerts, counts). **Contains the no-cost guard.**
- `OfficeAPI.gs` — `doGetOffice` + office API (`ofcActions_`, `ofcTable_`,
  `ofcProduct_`, `ofcSales_`, `ofcInventory_`, cost gaps, count search).
- `ReconAPI.gs` — `doGetRecon`; serves VT_Recon and answers JSONP
  (`rows`, `invoices`, `summary`, `save`); writes only
  `customer_opening_balance`.
- `InventoryAPI.gs` — `doGetInventory`; serves VT_Inventory and answers
  `summary`/`rows`/`product` from Supabase.
- `QuoteEngine.gs` — customer prices, quote history (paired W/WO), quote build.
- `POBridge.gs` — `buildPoStatus` reads the PO request sheet read-only.

### Verified-pricing / product-master (PARKED work)
- `VerifiedPricing.gs`, `VerifiedAPI.gs`, `VerifyQueue.gs`, `PricingImport.gs`,
  `PriceModel*.gs`, `MakePricingReadable.gs`, `PriceMismatch.gs`,
  `DashboardAPI_v2` pricing path, `VT_Dashboard_11.html`. Parked per owner.

### Receivables (server)
- `Receivables.gs`, `ReceivablesModel.gs`, `ReceivablesToSheets.gs`,
  `ReceiptLinks.gs`.

### Probes / one-offs / superseded (safe to remove after `whatIsLive` check)
`CustomerProbe.gs`, `SalesProbe.gs`, `SaleEndpointProbe.gs`,
`ReceiptEndpointProbe.gs`, `PurchaseRegisterProbe.gs`, `Recovery.gs`,
`Undo.gs`, `PropertyCleanup.gs`, `SpeedUpSheet.gs`, `FormulaFix.gs`,
`BuyLane.gs`, `BuyLaneFix.gs`, `PassB_Server.gs`, `PhaseA_MasterTabs.gs`,
`DataBuilder_v2.gs`, `ReviewFeed.gs`, `TxnSetup.gs`, `ChangeQueue.gs`.
**Do not delete blind** — several old files may still hold the only definition
of something live (this is exactly why `ofcActions_` reads OLD). Delete in
small batches, running `whatIsLive()` after each.

---

## Triggers (time-based)

Installed by `installSalesTriggers` (and legacy `installAllTriggers`). The
live set as of the last `whatIsLive()`: `nightlyRollup`, `nightlyCustomers`,
`nightlyStock`, `nightlyModels`, `nightlyDetectCounts`,
`refreshErpSnapshot`, `refreshPurchaseRegister`, `refreshCostCurrent`,
`rebuildBatchCost`, `rebuildDashData`, `refreshSalesRecent`,
`refreshInvoicesRecent`, `nightlyInvoiceSync`, `pullStock`. Add
`ftpFailoverTrigger` (03:00) and the invoice trigger. **VERIFY the live set
via `whatIsLive()` — trigger lists drift.**

Note the six-minute execution limit: the analytics chain was **split into four
jobs** to fit it. A single combined `nightlyAnalytics` will die part-way.

---

## Web apps and `/exec`

- The project is deployed as a **web app**. Each dashboard opens the same
  `/exec` URL with `?app=<name>` and, for data calls, `&action=<x>&callback=<cb>`
  (JSONP).
- **Deploy: Execute as ME, Access: Anyone.** An `/a/macros/...` URL requires a
  Google login the HTML file cannot provide — always use the `Anyone` URL
  without `/a/macros/`.
- **Editing code alone does not change what `/exec` serves** — you must
  **Deploy → Manage deployments → New version** (or a new deployment). This
  has caught the owner out more than once.
- Triggers, however, run the project code directly and need **no** redeploy.

## The token mechanism
The pricing dashboard path in `DashboardAPI_v2.gs` checks a token before
serving data. Floor/office/recon/inventory are routed **before** that check
and do not require the token. The Hostinger PHP has its own separate
`RUN_TOKEN`. See `SECURITY.md`.

## Dependencies
- Everything depends on `Registry.gs` for sheet resolution.
- Supabase pushes depend on `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` Script
  Properties.
- API pulls depend on `VASY_BASE_URL`, `VASY_API_TOKEN`, `VASY_BRANCH_ID`.
- Read models must be rebuilt (`buildReadModels`) or dashboards are slow.
