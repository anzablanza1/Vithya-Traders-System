# Purchase Intelligence V1.1 — Project State

Status: READY FOR IMPLEMENTATION
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

## Current next item

V1.1-01 — Data structures/server support required for multi-PO shipment allocation while preserving V1 compatibility.

Before coding, the old Purchase Dashboard chat must inspect the actual V1 source and propose the minimum compatible implementation.
