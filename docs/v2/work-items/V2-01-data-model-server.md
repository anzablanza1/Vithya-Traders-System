# V2-01 — Data model + server

Status: PENDING DESIGN REVIEW
Depends on: V2-00
Implementation started: NO

## Goal
Introduce first-class structures and server operations for Shipment, Shipment Line, Shipment-to-PO Allocation, Bill, Bill Line, Bill-to-Shipment Allocation and Receipt without breaking V1.

## Archived proposal
The original V2 register proposed new Google Sheet tabs:
- Shipments
- Shipment Lines
- Shipment-PO Allocations
- Bills
- Bill Lines
- Bill-Shipment Allocations
- Receipts

and new LiveApi read/write endpoints while keeping V1 Lots/Lot Lines intact.

## Architecture decision required before coding
Resolve PROJECT_STATE O1:
- Sheet-first persistence as archived proposal; or
- Supabase-first durable persistence with Sheets only as operational layer.

Also resolve any product-master dependency required by this model (O2).

## Invariants
- Shipment has no single `po_id`.
- Bill has no single `shipment_id`.
- Allocation rows carry many-to-many relations.
- Shipment, Bill and Receipt quantities remain independent.
- Excess and Off-PO are distinct.
- Existing V1 structures remain available during migration.

## Acceptance
- Schema/columns/IDs documented before writes.
- One shipment can reference multiple PO lines.
- One PO line can receive multiple shipment allocations.
- One bill can reference multiple shipment quantities.
- One shipment can be billed across multiple bills.
- Receipt can differ without overwriting shipment/bill.
- No V1 sheet column reordered.
- No archive file changed.
- TEST_PLAN B and C pass.
