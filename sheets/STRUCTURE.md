# Google Sheets Recovery Notes

Google Sheets in V1 are staging, computation, manual-input, and dashboard
read-model layers. Platform V2 is expected to reduce this dependency, but the
V1 relationships are preserved here for recovery/context.

## Important rules

- Do not commit full operational business data to Git.
- Do not commit secret values.
- Workbook IDs are resolved from Apps Script Script Properties; property names
  are safe to record.
- Generated/read-model tabs are not authoritative historical databases unless a
  specific V1 document says otherwise.
- Vasy remains the ERP source; Supabase is the durable warehouse for the data
  already migrated there.

## Known workbook/property map

| Script Property / area | V1 role |
|---|---|
| `VT_ANALYTICS_BOOK_ID` | analytics workbook, including Product_Analytics/read-model outputs |
| `VT_TXN_BOOK_ID` | transaction/staging workbook |
| `VT_STOCK_BOOK_ID` | stock workbook / Stock_Live related operational data |
| `VT_STOCK_REGISTER_ID` | stock-register reference used in calibration/reconciliation |
| `VT_STOCK_EXPORT_ID` | stock export dependency |
| `VT_RECEIVABLES_BOOK_ID` | receivables workbook |
| `VT_INV_OUTSTANDING_ID` | invoice-outstanding staging/report dependency |
| `VT_LEDGER_SHEET_ID` | customer-ledger/outstanding report dependency |
| `VT_PO_BOOK_ID` | PO-related workbook reference used by the broader system |
| `VT_BOOKS` / `VT_TAB_MAP` | workbook/tab routing configuration |
| Product Database System workbook | main Apps Script/system workbook used by several V1 flows |

Known workbook names/areas from the V1 build include:
- Product Database System
- VT_Transactions
- VT_Sales_2526
- VT_Sales_2627
- VT_Analytics
- VT_Stock
- receivables / reconciliation staging and outstanding-report workbooks

Exact IDs are intentionally not repeated here when they are already stored in
Script Properties or private recovery notes.

## Important tabs / outputs

The V1 docs and Apps Script refer to these important areas:

- `Sales_Items_2526`, `Sales_Items_2627`
- `Sales_Invoices_2526`, `Sales_Invoices_2627`
- `Sales_Monthly`
- `Product_Analytics`
- `Stock_Live`
- floor read model
- office read model
- office_raw read model
- pricing read model
- Customers/customer staging
- Receipts / receipt-register staging
- customer ledger snapshot / outstanding staging
- invoice-outstanding staging
- stock count/reconciliation areas
- purchase-register staging/fallback paths used by V1

The exact generated tab names for read models are defined by the captured Apps
Script source and should be read from that source before reconstructing them.

## Generated vs manual

### Primarily generated / API-derived
- sales item and invoice year tabs
- Sales_Monthly
- Product_Analytics
- Stock_Live
- customer staging/master pulls
- purchase-register pulls
- floor/office/pricing read models
- other nightly analytics outputs

### Manual / configuration / review inputs
- stock calibration/offset inputs
- stock-count/reconciliation inputs
- customer reconciliation sign-off/working inputs before their final Supabase
  write where applicable
- any Settings/manual override tabs referenced by the captured Apps Script

These manual values are the least reproducible part of V1. If a bit-for-bit V1
restore is ever required, preserve the live workbooks privately in addition to
Git structure notes.

## Recovery precedence

For a rebuild:
1. Read the exact captured Apps Script callers/writers.
2. Use Script Property names to identify the relevant workbook.
3. Recreate generated tabs from source code/header guards.
4. Restore manual/config values from private workbook backups or the live sheet
   if available.
5. Do not invent a tab/column because an old doc mentions it; the captured
   working source wins.

## Known limitation

This document is a recovery map, not a full export of every workbook/tab/value.
The 2026-10-03 freeze audit identified Google Sheets manual/config values as the
weakest remaining V1 recovery area. This does not block the planned clean
Platform V2 rebuild, but it matters for exact V1 restoration.
