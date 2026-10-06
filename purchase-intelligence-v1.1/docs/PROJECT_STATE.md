# Purchase Intelligence V1.1 — Project State

Status: LIVE — release "Vaigai" V1.1.4 (server 2.7), confirmed by the owner 7 Oct 2026
Branch: `purchase-v1.1-transition`

## Baseline

V1.1 starts from the frozen Purchase Intelligence V1 v8.6 / Noyyal baseline.

The V1 archive remains immutable.

## Purpose

Deliver the operational Shipment → Bill → Goods Check improvements immediately while the clean V2 platform is designed and built separately.

## Development rule

For V1.1, prefer the smallest safe implementation that works with the existing live Apps Script / Google Sheets / HTML architecture.

Do **not** redesign the whole platform inside V1.1.

If a requirement would force a risky deep rewrite, record it and defer that part to V2 unless the owner explicitly approves the risk.

## Relationship to V2

The business behaviours validated in V1.1 may later become V2 requirements.

The V1.1 physical implementation is only a reference/design candidate for V2 unless separately approved in active V2 docs.

## What is live

- LIVE sheet `1SuQsKP9JwE4DGk8RELGdqMpfQjquVhK_vWC6pmIcJfE`, Apps Script `1R3cGa6vgyOkdwF3qFsZ38Tmu48YXBe0qLnyg3ArmEM2TeGWSbfczRNT9` (a new copy of the old live sheet; the old V1 is frozen — token changed, access owner-only).
- Server: ping label `V1.1 "Vaigai" · server 2.7`. Files: Code, LiveApi 7.2, goodscheckapi, ShipmentApi, BillApi, ProductsApi, ShipmentTools, RegisterApi, Untitled.
- Dashboard: `VT_Purchase_Intelligence_V1_1.html` (chip "V1.1.4 · Vaigai"), distributed as a file to each PC.
- Script Properties: `V11_LOT_LOCK = on` (no new V1 lots), `V11_PRODUCTS_SB = on` (products from Supabase, master sheet as fallback), counters `V11_SEQ_…`, `V11_CONV_CODEFIX` (record of PO code corrections made by the lot conversion).
- Tabs added: Shipments, Shipment Allocations, Bills, Bill Lines, V1.1 Product Sync Report, V1.1 Conversion Report (and V1.1 Speed Check when run) — see `DATA_MODEL_V1_1.md`.
- Owner requests and bugs are numbered in `OWNER_REQUEST_REGISTER_V1_1.md` (R01–R47).

## Test environment

V1.1.1 onwards were tested in simulation first, then on a separate trial deployment of the LIVE project before the staff deployment was updated. A separate TEST copy of the live workbook ("po request live v1.1") with its own Apps Script deployment and its own API token. Every change is built and tested there first, then copied to LIVE. Dashboard testing uses a separate Chrome profile.

## Current next items

1. R41 — product charge insight should also read V1.1 bill charges.
2. V1.1-06 — line-level Goods Check / receipt with rejections (replaces the interim "Mark arrived").
3. V1.1-07 — Vasy validation before upload.
4. V1.1-08 / 09 — exceptions view, Lot → Shipment wording.
