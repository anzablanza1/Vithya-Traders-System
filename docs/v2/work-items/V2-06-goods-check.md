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

## Stock effect is not decided here
Receipt/Goods Check establishes arrival and acceptance/rejection facts, but this work item does not decide the exact event that mutates usable stock or Vasy/ERP stock.

Current stock is not reliable for stock-dependent replenishment. Platform V2 O3/O8 must be resolved before Inventory treats these events as authoritative stock mutations.
