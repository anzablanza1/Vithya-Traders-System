# GOOGLE_SHEETS.md — V1 (frozen)

Every workbook/tab used, reader/writer, key columns, generated vs manual, regenerable?, backup?

## Workbooks
1. **PO-Request workbook** — bound to the Apps Script project. Holds request + tracking data.
2. **Register workbook** `1uBS4vD24jihfjrHH2OFoBerRASpytmqjQK-_H-Y0XdU` — tab `Purchase_Register` (fallback register).
3. **Supplier workbook** `1Uc2ba4AjU_0ojhoyhkHtfvAK0tJtgmWbI7xOGBpV3VY` (SUP_SHEET_ID).
4. **Product master workbook** `1fVUY4JinmlovVLfQO6fkDL8ghElDeslCr_pZDHYpq7s` (MASTER_ID).

## PO-Request workbook — tabs
| Tab | Written by | Read by | Key columns | Generated/Manual | Regenerable? | Back up? |
|-----|-----------|---------|-------------|------------------|--------------|----------|
| `PO Requests` | PO-Request app (Code.gs) | dashboard `api=data` | Line ID, PO Request No, Date&Time, User, Request Type, Urgency, New Product, Product Code, Product Name, Quantity, Line Comment, Submission Comment, Status | Manual (requesters) | No | **YES** |
| `Products` | Manual / master sync | Code.gs `getProducts`, dashboard | Canonical Code, Product Name, Brand, Category, Subcategory, GST Code, GST Price, NonGST Code, NonGST Price, GST MRP, NonGST MRP | Manual/master | Partially | **YES** |
| `Drafts` | PO-Request app | app | draft requests | Manual | No | Optional |
| `Settings`, `Names`, `Statuses` | Manual/app | app/`getStatuses` | config, requester names, status list | Manual | No | **YES** |
| `PO Tracking` | LiveApi (dashboard) | LiveApi/dashboard | poNumber, realNo, lineId, code, name, qty, poQty, lane, poStatus, supplier, expected, **Line Note** | Generated | From dashboard state only if not lost | **YES** |
| `Lots` | LiveApi | LiveApi/dashboard/GoodsCheckApi | lotId, poNumber, lotNo, date, transport, lr, billG, billN, miReadyAt, Received At(10), uploadedAt, note, Expected(15), Vasy Bill No, Round Off GST, Round Off NonGST, Charges JSON, Totals JSON | Generated | No (operational) | **YES** |
| `Lot Lines` | LiveApi | LiveApi/dashboard/GoodsCheckApi | lotId, poNumber, lineRef, code, name, qty, gstQty, nonQty, rate, tax, ret | Generated | No | **YES** |
| `Receipts` | LiveApi | LiveApi/dashboard/GoodsCheckApi | poNumber, code, recvQty, date | Generated | No | **YES** |
| `PO Meta` | LiveApi | LiveApi/dashboard/GoodsCheckApi | PO Number, Supplier, Approved At, Bill At, Promised, Snooze Until, Notes JSON, Updated At, By, Closed At, Closed By, Cancel Reason, Cancelled At, Real No | Generated | No | **YES** |
| `Suppliers` | (SUP workbook) | LiveApi `api=suppliers` | supplier names/flags | Manual | No | **YES** |
| `Audit Log` | LiveApi | (audit) | ts, action, entity, before, after, by | Generated | append-only | **YES** |
| `Closed`, `Archive` | LiveApi | LiveApi | closed/archived PO ids | Generated | No | Optional |
| `Analytics · SKU Summary`, `Analytics · SKU Supplier`, `Fund Planning` | dashboard `writeSheet` | external inventory dashboard | analytics snapshots | Generated (push) | **Yes** (re-push) | No |

## Register workbook
| Tab | Written by | Read by | Notes |
|-----|-----------|---------|-------|
| `Purchase_Register` | External (Vasy export/ETL) | RegisterApi `api=register` (read-only) | Column names match dashboard parser; auto-detects DD/MM vs MM/DD; sinceId incremental. Fallback register source. **YES back up** (source data). |

## Formulas / configuration
- No heavy in-sheet formulas noted; data is app-generated. Column **order matters** (readers use fixed
  indices, e.g. Lots Received At=col 10, Expected=col 15). **Do not reorder columns.**

## Must be privately backed up
- **Everything with "YES"** above — especially `Purchase_Register` (source history), `PO Requests`,
  `PO Tracking`, `Lots`, `Lot Lines`, `Receipts`, `PO Meta`, `Products`, `Suppliers`, `Audit Log`.
- Supabase `purchase_bill_data` (the primary register) — export separately.
