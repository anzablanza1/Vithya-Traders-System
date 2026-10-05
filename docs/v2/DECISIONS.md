# Purchase Intelligence V2 — DECISIONS

This is the active decision log. Add an entry whenever a choice would matter to a future chat.

## D-V2-001 — V1 is immutable
`archive/purchase-intelligence-v1/` is frozen reference material and must not be modified.

## D-V2-002 — Git is persistent memory
Chats are temporary. Current state, decisions, work items, tests and important implementation changes must be recorded in the repo.

## D-V2-003 — Shipment and PO are many-to-many
Use Shipment -> Shipment Line -> Shipment-to-PO Allocation -> PO Line. Never model this as `shipment.po_id`.

## D-V2-004 — Bill and Shipment are many-to-many
Use Bill -> Bill Line -> Bill-to-Shipment Allocation. Never model this as `bill.shipment_id`.

## D-V2-005 — FIFO is suggestion only
Suggest oldest eligible open PO first, but let staff edit quantities and choose other PO lines. LIFO is rejected.

## D-V2-006 — Shipment entry is product-first
Select supplier, enter products/qty, then find and suggest open PO allocations.

## D-V2-007 — Shipment creation means In Transit
Recording a shipment does not mean the goods were received.

## D-V2-008 — Shipment, Bill and Receipt quantities are independent
Never overwrite one with another. Differences are meaningful exceptions.

## D-V2-009 — Excess and Off-PO are distinct
Excess means beyond applicable ordered/pending quantity. Off-PO means not allocated to an applicable existing PO.

## D-V2-010 — Bill may be prepared before arrival
Material inward/bill prep does not wait for physical receipt if supplier bill is available.

## D-V2-011 — Goods Check is exception-oriented
Normal receipt is simple confirmation. Rejected/short/damaged are exceptions. Accepted is derived.

## D-V2-012 — Core quantities are derived
Operational summary uses Ordered, In Transit, Received and Pending. Accepted = Received - Rejected.

## D-V2-013 — Preserve GST/Non-GST semantics
Trailing slash item code = Non-GST; no trailing slash = GST. Supplier leading dot = Non-GST party in V1 convention. Treat lanes as same physical product except where upload/split-bill requires separation.

## D-V2-014 — Preserve established bill logic unless explicitly changed
Carry forward W/WO split, lane rates/tax, charges, round-off, Vasy mapping/number and upload prep. V1 70%-qty / 30%-value additional-charge allocation is frozen behaviour unless deliberately changed later.

## D-V2-015 — PO-Request Goods Check stays price-free
Never show supplier, rate or amount there.

## D-V2-016 — Freeze verification supersedes unresolved freeze notes
When frozen docs say NEEDS LIVE VERIFICATION and the later freeze-verification doc resolves it, use the newer verification doc. Do not edit the archive.

## D-V2-017 — Product-master authority is OPEN
The legacy external master is not automatically V2 truth. Choose and document the authoritative product source before implementation depends on it.

## D-V2-018 — V2 persistence architecture is OPEN
The archived plan starts with new Google Sheet tabs + LiveApi endpoints, while broader direction favours Supabase as durable DB with Sheets as operational layer. Resolve before V2-01 coding.

## D-V2-019 — Secrets stay out of Git
Record secret names/locations only, never secret values.

## D-V2-020 — Purchase Register history and PO lifecycle are separate
Purchase Register data records procurement/billing history. PO lifecycle records operational ordering, shipment, receipt and cancellation. Purchase Event count is not PO count.

## D-V2-021 — New demand planning is sales-derived
Purchase quantities describe procurement history, not customer demand. New V2 demand/replenishment planning must use sales-derived demand.

## D-V2-022 — Inventory and Purchase have distinct analytical ownership
Inventory owns demand/replenishment intelligence. Purchase owns supplier/commercial/procurement intelligence. Purchase consumes Inventory demand/replenishment context rather than calculating a competing version.

Inventory-facing Purchase information should remain supplier-neutral and cost-free where commercial identity is unnecessary.

## D-V2-023 — Parent SKU is the shared analytical identity
GST and Non-GST variants represent one physical product for consolidated Purchase/Inventory analysis while exact ERP code/lane remains preserved for billing/upload. Product Master authority remains OPEN under D-V2-017/O2.

## D-V2-024 — Exceptional demand preserves raw history
Exceptional/project demand must be reviewable. Raw demand remains visible; normalized/baseline demand is a separate auditable interpretation.

## D-V2-025 — Confirmed supplier constraints override inferred values
Confirmed/manual MOQ, pack size and supplier commitments take precedence over statistical inference.

## D-V2-026 — Sparse purchase history is not zero purchasing
Missing history outside a known-complete period must not be interpreted as proof of zero purchasing.

## D-V2-027 — Purchase Register fallback remains during migration
Existing Purchase Register fallback capability remains available until the replacement path is explicitly validated. This is a migration requirement, not a permanent architecture decision.
