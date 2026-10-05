# V2-07 — Vasy upload validation + generation

Status: PENDING
Depends on: V2-05, V2-06

## Goal
Generate Vasy upload from Bill rather than from a V1 Lot.

## Validation before Ready for Vasy
Check duplicate invoice, missing item code, bill total mismatch, invalid W/WO split, GST error, quantity discrepancy, unresolved Excess/Off-PO where policy requires resolution, missing accounting data and rate error.

## Requirements
- Preserve exact Vasy upload mapping/format required by working integration.
- Do not guess constants/fields; read proven working source.
- Keep GST and Non-GST outputs separated as required.
- Record generation/upload status without destroying Bill data.

## Acceptance
Invalid cases are blocked with a clear reason; valid Bill reaches Ready for Vasy and produces expected format. TEST_PLAN B and I pass.

## Cross-system stock boundary
Generating or uploading a Bill/Material-Inward document is not automatically the same business event as physical Receipt/Goods Check.

The relationship between Vasy MI posting/upload and ERP stock mutation remains Platform V2 O3/O4 and must be verified before implementation assumes it.
