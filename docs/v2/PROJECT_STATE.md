# Purchase Intelligence V2 — PROJECT STATE

Last updated: 2026-10-03
Branch: `v2-development`

## Status
- Purchase Intelligence V1 freeze: COMPLETE.
- Frozen tag: `purchase-v1-v8.6`.
- V2 implementation code: NOT STARTED.
- Active phase: repository-memory bootstrap and cold-start validation.
- Next implementation item: V2-01 Data model + server.

## Verified V1 facts
- Exact live Purchase Apps Script source was cloned and privately preserved.
- Bound workbook is `po request live`; its ID is recorded in the freeze-verification doc.
- Production deployment at freeze was version 36, description `EDITS`.
- Primary purchase-history path: Vasy PurchaseBillData CSV -> Hostinger `supabase.php` -> Supabase `purchase_bill_data` -> LiveApi -> dashboard.
- Google Sheets fallback: Product Database System workbook -> `Purchase_Register` -> RegisterApi.
- `purchase_bill_data` ingestion replaces by `voucher_no`.
- Supplier dependency is the `supplier data` workbook.
- Legacy external product master feeds the local `Products` tab; runtime `getProducts()` reads the local tab.
- The legacy product master is stale/unreliable and must not automatically become V2 truth.
- Private backups and SHA-256 checks were completed.

## Approved V2 model
PO -> PO Line

Shipment -> Shipment Line -> Shipment-to-PO Allocation -> PO Line

Bill -> Bill Line -> Bill-to-Shipment Allocation

Receipt / Goods Check -> quantities + exceptions

Vasy upload -> generated from Bill after validation.

## Approved behaviour
- FIFO oldest-open-PO-first is suggestion only.
- Users may edit allocations.
- Shipment entry is product-first.
- Creating shipment means In Transit.
- Excess != Off-PO.
- Shipment Qty != Bill Qty != Receipt Qty.
- Bills may be prepared before arrival.
- Rejection/short/damage are exceptions; accepted is derived.
- Existing GST/Non-GST and MI logic carry forward unless deliberately changed.

## Open decision O1 — persistence architecture
The archived plan proposed new Google Sheet tabs + LiveApi endpoints. The broader system direction is Supabase as durable DB with Sheets as an operational layer.

Before V2-01 code, explicitly decide whether new Shipment/Bill/Allocation/Receipt objects are Sheet-first or Supabase-first. Do not silently choose.

## Open decision O2 — product master
The legacy external master is not trusted enough to be V2 authority. Choose and document the V2 product source of truth before implementation depends on it.

## Security follow-up
V1 had a hard-coded fallback dashboard token. Git is sanitized. Credential rotation remains a separate controlled maintenance task.
