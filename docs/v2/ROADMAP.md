# Purchase Intelligence V2 — ROADMAP

Status: DONE / ACTIVE / PENDING / DEFERRED / DROPPED

## V2-00 — Freeze V1 and establish Git memory
Status: DONE

V1 source, frontends, operational backups, deployment mapping and verification were preserved. Active V2 memory is now being established.

## V2-01 — Data model + server
Status: PENDING
Depends on: V2-00

Define first-class Shipment, Shipment Line, Shipment-to-PO Allocation, Bill, Bill Line, Bill-to-Shipment Allocation and Receipt structures. Add server read/write support while preserving V1 compatibility.

Resolve the persistence choice in PROJECT_STATE before implementation.

## V2-02 — Migration / backward compatibility
Status: PENDING
Depends on: V2-01

Map existing V1 lots into the new model without destroying V1 history. Keep old behaviour available during transition.

## V2-03 — Shipment Entry
Status: PENDING
Depends on: V2-01

Product-first shipment entry. Supplier -> products -> shipment quantities -> open PO matches. FIFO suggestion remains editable. Support explicit Excess and Off-PO.

## V2-04 — PO quantities and status from allocations
Status: PENDING
Depends on: V2-02, V2-03

Derive Ordered, In Transit, Received and Pending from the new allocation/receipt model and update operational views.

## V2-05 — Bill / Material Inward
Status: PENDING
Depends on: V2-03

Separate bill from shipment. Support many shipments per bill and a shipment across bills while preserving W/WO split, rates, GST, charges, round-off, Vasy mapping and bill-before-arrival.

## V2-06 — Goods Check / Receipt
Status: PENDING
Depends on: V2-03

Verify physical arrival separately from shipment and billing. Normal path is simple confirmation; rejection/short/damage are exceptions.

## V2-07 — Vasy upload validation + generation
Status: PENDING
Depends on: V2-05, V2-06

Generate upload from Bill rather than V1 Lot. Validate duplicate invoice, item code, totals, W/WO split, GST, quantity discrepancies, unresolved excess/off-PO, accounting data and rate issues.

## V2-08 — Central Exceptions
Status: PENDING
Depends on: V2-04 through V2-07

Surface unallocated quantities, Excess, Off-PO, received-not-billed, billed-not-received, shipment/bill/receipt mismatches, rejection, received-not-uploaded, stale transit, PO remainder to cancel, duplicate invoice and failed upload.

## V2-09 — Terminology sweep
Status: PENDING
Depends on: V2-03+

Change user-facing Lot terminology to Shipment after the new model is stable. Legacy internal names may remain where compatibility requires them.

## Build order
V2-01 -> V2-02 -> V2-03 -> V2-04 -> V2-05 -> V2-06 -> V2-07 -> V2-08 -> V2-09.

Each stage must be specified, tested and documented before the next is treated as complete.
