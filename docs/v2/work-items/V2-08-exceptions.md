# V2-08 — Central Exceptions

Status: PENDING
Depends on: V2-04 through V2-07

## Goal
Create one operational place for mismatches and unfinished states.

## Initial exception set
- unallocated shipment qty
- Excess
- Off-PO
- received-not-billed
- billed-not-received
- Bill vs Shipment mismatch
- Receipt vs Shipment mismatch
- rejected/short/damaged
- received-not-uploaded
- stale In Transit
- PO remainder to cancel
- duplicate invoice
- failed Vasy upload

## Acceptance
Every exception links to underlying business objects and is explainable from stored/derived quantities rather than opaque flags where possible.
