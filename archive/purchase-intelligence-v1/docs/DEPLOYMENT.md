# DEPLOYMENT.md — V1 (frozen)

How the current system is deployed and recovered. **No secret values here** — only names/locations.

## Pieces & where they live
| Artifact | Type | Home | How deployed |
|----------|------|------|--------------|
| `VT_Purchase_Intelligence_V1.html` | Dashboard (self-contained HTML) | Opened as a local file (`file://…Downloads/…`) or hosted static | Replace the file; open newest. Version chip reads **v8.6 · Noyyal**. |
| `PORequest_index_V1.html` | PO-Request UI | Served by Apps Script `doGet` (its `index.html`) | Paste as the project's HTML file; Deploy → New version. |
| `PORequest_Thamirabarani_v9.gs` (Code.gs) | Server: requests, products master, statuses, drafts, `doGet` | Apps Script project (bound to PO-Request workbook) | Paste; Deploy → New version. |
| `LiveApi_v7.2.gs` | Server: PO tracking/meta/lots/receipts/suppliers + Supabase register proxy + writeSheet | **same** Apps Script project | Paste; Deploy → New version. |
| `RegisterApi.gs` | Server: read-only `Purchase_Register` pull (fallback) | **same** project | Paste; Deploy → New version. |
| `GoodsCheckApi_V1.gs` | Server: `getGoodsCheck()` for PO-Request Goods Check | **same** project | Paste; Deploy → New version. |

**All four .gs files + index.html are ONE Apps Script project**, one `/exec` web-app deployment.

## Script Properties (names only — never commit values)
- `VT_API_TOKEN` — shared token for LiveApi/RegisterApi/GoodsCheckApi.
- `VT_SB_KEY` — Supabase **service_role** key (server-side register pull).
- `VT_PIN_SALT`, `VT_PIN_FOLLOW`, `VT_PIN_MGMT` — access-tier PIN salt + hashes.

## Sheets / workbooks the project depends on
- PO-Request workbook (bound): tabs `PO Requests, Products, Drafts, Settings, Names, Statuses` +
  LiveApi tabs `PO Tracking, Lots, Lot Lines, Receipts, PO Meta, Suppliers, Audit Log, Closed, Archive` +
  push tabs `Analytics · SKU Summary, Analytics · SKU Supplier, Fund Planning`.
- Register workbook `1uBS4vD24jihfjrHH2OFoBerRASpytmqjQK-_H-Y0XdU` → tab `Purchase_Register`.
- Supplier workbook `1Uc2ba4AjU_0ojhoyhkHtfvAK0tJtgmWbI7xOGBpV3VY` (SUP_SHEET_ID).
- Product master workbook `1fVUY4JinmlovVLfQO6fkDL8ghElDeslCr_pZDHYpq7s` (MASTER_ID).

## Supabase
- Project `kssydapdfmkfufrqhwzp`; table `purchase_bill_data`; server uses `VT_SB_KEY`.

## Dashboard connection
- In the dashboard: **Management mode → Settings** → set the web-app `/exec` URL + token
  (stored in `vt_live_cfg`). "Refresh register" pulls Supabase; status line shows last pull.

## What to redeploy after each change type
- **Dashboard HTML change** → just replace/redistribute the HTML file (open newest). No server redeploy.
- **Any `.gs` change** (LiveApi/RegisterApi/GoodsCheckApi/Code) → **Deploy → Manage deployments → Edit →
  New version → Deploy** (one deployment serves all four).
- **PO-Request `index.html` change** → paste + Deploy → New version.
- **New Script Property** (e.g. VT_SB_KEY) → add in Project Settings; then redeploy.

## Recovery / rollback
- Frozen baseline files are the recovery point. Google Sheet + Supabase are the data baseline (back up
  both). To roll back: restore the frozen HTML/.gs, redeploy, ensure Script Properties present.
