# V2-03 — Shipment Entry

Status: PENDING
Depends on: V2-01

## Goal
Create a product-first shipment workflow matching real supplier behaviour.

## Flow
Supplier -> products and shipment qty -> find open eligible PO lines -> suggest FIFO oldest-first allocations -> employee reviews/edits -> save shipment.

## Rules
- FIFO is suggestion only.
- User may reduce suggested allocation. Example: PO pending 100 and shipment 200; suggestion can show 100, but user may allocate only 50 there.
- One shipment may allocate across many POs.
- Shipment may contain Excess and Off-PO; keep them distinct.
- Creating shipment means In Transit, not Received.
- Shipment qty never overwrites bill/receipt qty.

## Acceptance
- Multi-PO shipment works.
- Manual allocation editing works.
- Partial suggested allocation works.
- Excess and Off-PO remain visible/auditable.
- Allocation total reconciliation is explicit.
- TEST_PLAN B, C and F pass.
