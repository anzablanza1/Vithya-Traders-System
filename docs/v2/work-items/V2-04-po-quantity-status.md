# V2-04 — PO quantities and status from allocations

Status: PENDING
Depends on: V2-02, V2-03

## Goal
Make PO progress derive from V2 allocations and receipts rather than the V1 per-lot mirror.

## Summary quantities
- Ordered
- In Transit
- Received
- Pending

Accepted is derived from Received minus Rejected when needed.

## Requirements
- Allocation details in drilldown; summary stays simple.
- Pending quantity must not be confused with workflow status text.
- Excess must not increase PO ordered qty.
- Cancelled outstanding qty stays distinct from shipped/received.
- Board, By PO, By Product, Goods Check, Fund and Analytics migrate deliberately rather than reading mixed old/new logic.

## Acceptance
Known sample POs reconcile across V1-representable and new multi-PO cases. TEST_PLAN B, D and E pass.
