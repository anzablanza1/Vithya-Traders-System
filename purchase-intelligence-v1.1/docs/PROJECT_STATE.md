# Purchase Intelligence V1.1 — Project State

Status: LIVE — release "Vaigai" (V1.1-01 · 02 · 03 · 04 · 04a · 05 + interim 06), <<LIVE_DATE>>
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

- Server: LIVE Apps Script version <<NEW_VERSION>>, ping label `V1.1 "Vaigai" · server 2.4`. Files: Code, LiveApi 7.2, goodscheckapi, ShipmentApi (new), BillApi (new), RegisterApi, Untitled.
- Dashboard: `VT_Purchase_Intelligence_V1_1.html` (chip "V1.1 · Vaigai"), distributed as a file to each PC.
- Script Property `V11_LOT_LOCK = on` (no new V1 lots).
- New tabs: Shipments, Shipment Allocations, Bills, Bill Lines — see `DATA_MODEL_V1_1.md`.

## Test environment

A separate TEST copy of the live workbook ("po request live v1.1") with its own Apps Script deployment and its own API token. Every change is built and tested there first, then copied to LIVE. Dashboard testing uses a separate Chrome profile.

## Current next items

1. V1.1-02b — convert unfinished V1 lots into shipments (owner to decide timing; dry run first).
2. V1.1-06 — line-level Goods Check / receipt with rejections (replaces the interim "Mark arrived").
3. V1.1-07 — Vasy validation before upload.
4. V1.1-08 / 09 — exceptions view, Lot → Shipment wording.
