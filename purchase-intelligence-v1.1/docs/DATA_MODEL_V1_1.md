# Purchase Intelligence V1.1 — Data Model additions ("Vaigai")

All four tabs live in the **po request live** workbook. Existing V1 tabs are unchanged.
Columns marked (text) are forced to plain text so codes / IDs / dates are not converted by Sheets.

## Shipments — one row per physical shipment
| Col | Header | Notes |
|---|---|---|
| A | Shipment ID (text) | created by the dashboard; retry-safe upsert key |
| B | Shipment No (text) | `SH-YYYYMMDD-NN`, server-assigned, never reused |
| C | Supplier | |
| D | Ship Date (text) | |
| E | Transport | optional |
| F | LR No | optional |
| G | Expected Delivery (text) | |
| H | Status | In Transit · Arrived · Cancelled |
| I | Note | |
| J–L | Created At · Updated At · By | |
| M–N | Arrived At · Arrived By | set by "Mark arrived" (interim V1.1-06) |

## Shipment Allocations — one row per shipment × product × destination
| Col | Header | Notes |
|---|---|---|
| A | Allocation ID (text) | `<shipmentId>-<n>` |
| B | Shipment ID (text) | |
| C | Type | PO · EXCESS · OFFPO |
| D | PO Number (text) | required for PO, optional for EXCESS, blank for OFFPO; same PO numbers as PO Tracking (incl. …w / …wo split children) |
| E | Canonical Code (text) | code without trailing "/" |
| F | Item Code (text) | |
| G | Item Name | |
| H | Qty | |
| I | Suggested Qty | what the oldest-PO-first suggestion proposed |
| J–L | Note · Updated At · By | |
| M | UOM | per product on this shipment |

## Bills — one row per supplier bill (w + wo)
A Bill ID · B Bill No (`BL-YYYYMMDD-NN`) · C Supplier · D Bill Date · E Supplier Bill No (w) · F Supplier Bill No (wo) · G Round Off (w) · H Round Off (wo) · I Charges JSON `[{name,amount,gst,lane}]` · J Totals JSON · K Status · L Ready At · M MI No (w) · N MI No (wo) · O MI At · P MI By · Q MI Override · R Vasy Bill No (w) · S Vasy Bill No (wo) · T Vasy Bill At · U Vasy Bill By · V Note · W Created At · X Updated At · Y By

Status (derived): Draft → Ready (file downloaded) → MI Uploaded → Bill Generated. Any MI / Vasy number = locked.
The dashboard shows "billed" only when every side the bill has (w / wo) carries a Vasy bill number.

## Bill Lines — one row per bill × shipment × product
A Line ID · B Bill ID · C Shipment ID · D Canonical Code · E Item Code · F Item Name · G PO Ref · H Qty (w) · I Rate (w) · J Qty (wo) · K Rate (wo) · L Tax % · M Upload as / · N Upload Code · O MRP (w) · P Selling (w) · Q MRP (wo) · R Selling (wo) · S Note · T Updated At · U By

## Script Properties (new)
- `V11_LOT_LOCK` — `on` refuses NEW V1 lots on the server (edits to existing lots still work).
- `V11_SEQ_SH-YYYYMMDD-`, `V11_SEQ_BL-YYYYMMDD-` — permanent per-day counters (automatic).

## How quantities are derived (`shpQtyByPoCode_`, key = PO Number | canonical code)
- shippedPO = V1 lot lines + V1.1 PO allocations (live shipments) → drives **pending**
- excess = V1.1 EXCESS allocations naming the PO
- shipped = shippedPO + excess → drives **in transit**
- received = V1 lots marked received (qty − return) + V1.1 arrived shipments (PO + EXCESS)
- The Receipts tab is NOT used for quantities (it repeats rows on every lot save and logged shipped qty as received).
