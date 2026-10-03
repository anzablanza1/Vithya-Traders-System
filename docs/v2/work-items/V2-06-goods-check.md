# V2-06 — Goods Check / Receipt

Status: PENDING
Depends on: V2-03

## Goal
Verify physical arrival separately from shipment declaration and supplier billing.

## Rules
- Normal case is simple confirmation.
- Rejected, short and damaged quantities are exceptions.
- Accepted quantity is derived, not duplicated everywhere.
- Shipment, Bill and Receipt quantities remain independently auditable.
- PO-Request Goods Check remains quantity/status only and must never expose supplier, rate or amount.

## Acceptance
- Full normal receipt is quick.
- Partial/short/rejected/damaged cases are explicit.
- Receipt never overwrites shipment or bill.
- TEST_PLAN B and H pass.
