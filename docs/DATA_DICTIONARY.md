# DATA_DICTIONARY

Read directly from the live Supabase database on **11 September 2026**. Row
counts are as of that date and will have moved. Column lists are exact.

Every object also carries a `COMMENT` in the database itself — visible on
hover in the Supabase Table Editor. This file is the readable copy.

---

## PRIMARY IDENTIFIERS (the join keys)

| id | lives in | is | joins to |
|---|---|---|---|
| `voucher_no` | sales_data, sales_history, sales_ftp_gap | the sales document number | across the three sales tables; the unit of "one source per voucher" |
| `sales_id` | sales_invoice | the invoice **db id** (9-digit) | `cash/bank_receipt_data.db_invoiceno` |
| `db_invoiceno` | cash/bank_receipt_data | the invoice a receipt names | `sales_invoice.sales_id` |
| `contact_id` | customer_master | the customer db id | `sales_invoice.contact_id`, `sales_data.customer_id_db_id` |
| `item_code` | most product tables | the SKU code (trailing `/` = non-GST) | `item_code_base` (slash stripped) merges the two lanes |
| `party_key` | customer_master | a normalised customer stem | merges a customer's GST and non-GST ledgers |

---

## TABLES

### Sales

**`sales_data`** — RAW FTP. ~13,070 rows. A rolling ~14-day window plus any
older document that was edited. **Not the full history.** Only the FTP
pipeline writes here.
Columns: `id, created_at, date, voucher_no, sale_type, voucher_type,
order_type, branch_id_db_id, customer_id_db_id, customer_name, mobile_no,
gstin, department_name, category_name, sub_category_name, brand_name,
sub_brand_name, hsn, product_type, product_id_db_id, varient_id_db_id,
item_code, product_name, batch_no, purchase_price, landing_cost, mrp,
unit_price, selling_price, qty, uom, taxable_amount, discount,
tax_inclusive_discount, other_discount, tax_rate, tax_amount, cgst, sgst,
igst, cess_rate, cess_amount, net_amount, sales_man, total_bill_amount,
receipt_data, created_by, address, state_name, total_mrp, total_cart_discount,
coupon_discount_tax_inclusive, invoice_id_db_id, invoice_no, source, loaded_at`
- `date` is text `DD/MM/YYYY`.
- **`invoice_id_db_id` and `invoice_no` are `'0'` on every row** — the FTP
  sales feed does NOT carry the invoice link. Receipts do. (See BUSINESS_RULES.)
- `receipt_data` is free text like `Cash : 122000 | bank : 2268`.

**`sales_history`** — ~257,400 rows. The one-time backfill from the year
workbooks and the API. Never written by the FTP pipeline.
Columns include the sales fields plus `sale_month, fy, source, src_row`.
- `source` is `SHEET-2526`, `SHEET-2627`, `API-2425`, `API-AUGGAP2`, etc.
- `src_row` is the unique key within a source (sheet row number or offset).

**`sales_ftp_gap`** — ~3,566 rows. Sales the API pulled while FTP was down.
**Separate so it can be TRUNCATEd once FTP re-sends those days.** Read below
FTP in `v_sales_all`.
Columns: `id, voucher_no, sales_date, sale_month, item_code, product_name,
category_name, sub_category_name, brand_name, department_name, qty, mrp,
unit_price, selling_price, purchase_price, landing_cost, net_amount, tax_rate,
tax_amount, customer_name, contact_id, sale_type, sales_man, pulled_for_day,
source, loaded_at`

**`sales_invoice`** — ~35,572 rows. The invoice register, pulled by API.
Columns: `sales_id, prefix, sales_no, order_no, sales_date, due_date,
inv_type, channel_name, status, payment_type, contact_id, customer_name,
total, paid_amount, balance, fy, source, loaded_at`
- `sales_id` is the join key receipts point at.
- **`balance` is the receivables truth.** The API does not return balance
  directly for API-pulled rows — it is computed as `total - paid_amount`.
- `order_no` is the POS document number; GST invoices use `prefix + sales_no`.
- `contact_id = 0` means walk-in (stored as null where possible).

### Money in

**`cash_receipt_data`** / **`bank_receipt_data`** — RAW FTP. ~1,308 / ~538
rows, **17 Aug 2026 onward only**.
Columns: `id, created_at, date, location, branch_id, particulars_id_db,
particulars, voucher_type, db_invoiceno, voucher_id_db, voucher_no,
description, currency, debit, credit, closing, voucher_created_on, source,
loaded_at`
- `db_invoiceno` is the invoice(s) the receipt settles — the **only reliable
  receipt→invoice link**. Can name several invoices separated by `|`.
- `debit` is the receipt amount.

**`receipt_register`** — ~10,658 rows. The Vasy receipt **export**. Has the
receipt number but **NOT the invoice db id**, so it answers "how much came in"
but cannot be joined to invoices.
Columns: `receipt_no, party_name, mode, receipt_type, receipt_date, amount,
status, created_by, fy, source, loaded_at`
- `receipt_type` includes "Against Bill", "On Account", "Advance Payment".

**`cash_payment_data`** — RAW FTP. ~38 rows. Payments OUT. Sparse.

### Customers and reconciliation

**`customer_master`** — ~1,784 rows. Vasy contacts by API. COMPLETE.
Columns: `contact_id, first_name, last_name, company_name, display_name,
lane, party_key, mobile_no, whatsapp_no, telephone, email, gst_type, gstin,
pan, city_name, state_name, country_name, contact_type, branch_id,
branch_name, account_custom_id, is_active, last_modified_on, last_modified_by,
source, loaded_at`

**`customer_ledger_snapshot`** — ~673 rows. The Vasy Customer Outstanding
report, uploaded per `as_at` date. `opening_balance + debit - credit =
closing`, and it balances on every row.
Columns: `party_name, as_at, contact_no, opening_balance, debit, credit,
closing, source, loaded_at`

**`customer_invoice_outstanding`** — ~468 rows. The Vasy Customer Invoice
Outstanding report. 2,383 unpaid bills.
Columns: `customer_name, as_at, outstanding, d30, d45, d60, d90, d120,
d120plus, unpaid_bills, source, loaded_at`

**`customer_opening_balance`** — the sign-off table. Where a human records
that an opening balance has been checked with a customer. ~2 rows so far
(work in progress).
Columns: `customer_name, as_at, opening_agreed, opening_per_vasy, status,
verified_by, verified_on, method, note, updated_at`
- `status`: `NOT CHECKED` / `CONFIRMED WITH CUSTOMER` / `DISPUTED` /
  `WRITTEN OFF`.

### Stock and products

**`stock_live`** — ~7,046 rows. Current stock, pushed from the Stock_Live
sheet. W and WO combined into a total. COMPLETE.
Columns: `item_code, product_name, qty_w, qty_wo, qty_total, category, brand,
source, loaded_at`

**`erp_snapshot`** — ~13,748 rows. ERP product snapshot (cost/price/qty as
Vasy holds it), pushed by API. The **full product list** — use this, not
`product_data`. Full raw row kept in `data` (jsonb).
Columns: `item_code, product_name, selling_w, selling_wo, mrp_w, mrp_wo,
gst_rate, qty, data, source, loaded_at`

**`product_data`** — RAW FTP. ~117 rows against ~13,685 products. **BROKEN —
the FTP product export is a delta**, so it fills slowly and may never be
complete. Do not use as a product master; use `erp_snapshot`.

### Purchases / stock movement

**`purchase_bill_data`** — RAW FTP. ~10,353 rows. **This financial year only**
— proper entry began Apr 2026, so earlier years are sparse by nature.
(Full column list in the live DB; includes rate, qty, discounts, taxes,
`item_code`, `party_name`, `bill_date`, `bill_no`.)

**`material_inward_data`** — RAW FTP. ~10,305 rows. Goods received.

**`stock_adjustment_data`** — RAW FTP. ~24,749 rows. Replaced by transaction
DATE (it has no document number).

**`vendor_data`** — RAW FTP. ~716 suppliers.

**`credit_note_data`** (~11), **`purchase_return_data`** (~3),
**`product_consumption_data`** (0) — RAW FTP, small/empty.

**`ops_pipeline_snapshots`** — ~10 rows. **Dead scaffolding** from early work.
Nothing reads it. Safe to drop.

---

## VIEWS (computed — read these, not raw tables)

### The central sales view
**`v_sales_all`** — every sales line, **one source per voucher**, ranked
FTP (1) > API-gap (2) > sheet-history (3). Carries derived columns:
`item_code_base` (slash stripped), `sku_lane` (W/WO), `sale_month`,
`net_amount_num` and other `_num` typed numerics, `customer_name_final`
(resolved), `voucher_lane` (GST/NON_GST), `gst_registration`. **This is the
sales view everything else should read.**

**`v_sales`** — DELIBERATELY reads `sales_data` only (FTP, ~13,070 lines). It
answers "what did the FTP actually send". **Do not use it for analysis** — it
is the object most likely to be used by mistake.

**`v_sales_data_all`** — `sales_data`'s exact shape (text columns) but every
source's data. A drop-in replacement for `FROM sales_data` in older views
that must see history (e.g. `v_customer_360`).

### Aggregates (all read v_sales_all)
- `v_agg_sales_daily` — per day per lane. **Was reading v_sales until 5 Sep,
  which made daily figures look tiny — now fixed.**
- `v_agg_sales_month_item` — per month per base product per lane.
- `v_agg_sales_month_customer` — per month per customer per lane.
- `v_sales_month` — monthly rollup (lines, invoices, units, revenue, margin).
- `v_sales_monthly_rollup` — 15 columns matching the Sales_Monthly sheet;
  read by `buildSalesMonthly`.

### Receivables / reconciliation
- `v_receipts` — receipts split per invoice named; `split_receipt` flag.
  **17 Aug 2026 onward only.**
- `v_receipt_allocation` — for multi-invoice receipts, whether the amount can
  be attributed and on what basis.
- `v_invoice_settlement` — per invoice: Vasy's open balance + any receipt.
- `v_receivables_summary` — one-line position with ageing.
- `v_receivable_exceptions` — the working list; `issue` says why each is here.
- `v_exception_summary` — the above, counted.
- `v_customer_open` — what each customer owes, with ageing.
- `v_customer_invoices` — every invoice per customer, open or closed, with
  receipts.
- `v_customer_receipts` — every receipt per customer and what it was applied
  to; `UNAPPLIED` = on account.
- `v_unapplied_receipts` — On Account / Advance receipts (no invoice named).
- `v_reconciliation` — **THE reconciliation screen.** Ledger vs invoice detail
  vs our copy, per customer, with `next_step` and `to_write_off`. **Customers
  in credit are separated from those who owe.**
- `v_reconciliation_summary` — counted by `next_step`.
- `v_writeoff_candidates` — open invoices per customer, with a verdict.

### Customer master
- `v_customer_360` — one row per business, GST+WO ledgers merged on
  `party_key`, best phone resolved, sales activity attached. Phones scraped
  from address text are UNVERIFIED. "No orders in feed" ≠ never bought.
- `v_customer_master_sheet` — flat Sheets-safe export of the above.
- `v_customer_recovery_queue` — missing customers with identifying detail.
- `v_customer_lane_anomalies` — customers whose channel contradicts their lane.

### Inventory
- `v_inventory` — one row per product: live stock + 12-month velocity +
  ABC/XYZ + days of cover + a flag (NEGATIVE/STOCKOUT/DEAD/LOW/EXCESS/OK).
  Powers the inventory dashboard. Needs `stock_live` populated.
- `v_inventory_summary` — the counts.

### Purchase / stock
- `v_purchase` — `purchase_bill_data` typed; supplier_lane from leading dot.
- `v_inward` — `material_inward_data` typed.
- `v_stock_moves` — `stock_adjustment_data` typed; `net_move_num = in - out`.
- `v_item_latest_cost` — most recent purchase rate per base product. **Use
  this for margin, NOT Vasy landing cost.**
- `v_agg_purchase_month_item`, `v_agg_stock_position` — purchase/stock rollups.
- `v_lane_violations` — line-level SKU-lane vs voucher-lane check.

---

## KNOWN DATA-QUALITY PROBLEMS

1. **`sales_data.invoice_id_db_id` is `'0'` on every row.** The FTP sales feed
   has no invoice link. Use receipts (`db_invoiceno`) → `sales_invoice`.
2. **Landing cost is unreliable in old sales rows.** "Below cost" lines run
   FTP 0.5%, this-year 1.7%, FY24-25 9.2% — the older the data, the more
   false losses. Pre-2026 margin is not real.
3. **`landing_cost` is a LINE total, not per-unit.** Margin = `net_amount -
   landing_cost`, never `net - landing_cost * qty`. (This caused a
   −₹609-crore bug once.)
4. **Receipts only exist from 17 Aug 2026.** Anything about earlier settlement
   is a statement about missing data. Historical settlement needs the Vasy
   receipt export WITH invoice ids (an open Vasy request).
5. **`product_data` is broken** (delta export, ~117 of ~13,685). Use
   `erp_snapshot`.
6. **`sales_data` dates are text `DD/MM/YYYY`.** A past bug wrote JS Date
   objects into a text column, producing "Fri Aug 07 2026…" which sorted
   wrongly. Date parsing must handle multiple shapes.
7. **Purchase history before Apr 2026 is sparse** because entry started then —
   a fact about the records, not a fault.
