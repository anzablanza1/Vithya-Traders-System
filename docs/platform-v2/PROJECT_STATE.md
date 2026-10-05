# Platform V2 — PROJECT STATE

Last updated: 2026-10-05
Branch: `v2-development`

## Status
- Broader System V1 freeze: COMPLETE.
- Purchase Intelligence V1 freeze: COMPLETE.
- Platform V2 governance/design memory: ESTABLISHED.
- Final Platform V2 technical architecture: NOT DECIDED.
- This documentation change implements no application/database architecture.
- Pre-V2 Purchase/Inventory Supabase objects remain reference/design candidates only.

## Approved cross-domain boundaries
- Purchase Register history and PO lifecycle are separate domains.
- Purchase Event count is not PO count.
- New demand/replenishment planning uses sales-derived demand.
- Inventory owns demand/replenishment intelligence.
- Purchase owns supplier/commercial/procurement intelligence.
- Inventory→Purchase provides demand/replenishment context.
- Purchase→Inventory is supplier-neutral and cost-free where commercial identity is unnecessary.
- GST/non-GST variants consolidate to one physical product for analysis while exact ERP lane/code remains traceable.
- Parent SKU is the shared analytical identity; Product Master authority remains open.
- Ordered, In Transit, Received and Pending are distinct.
- Cancellation and rejection are distinct.
- Bill/MI preparation is not physical receipt.
- Exceptional demand remains reviewable; raw and normalized demand remain separate.
- Confirmed/manual MOQ, pack size and supplier commitments override inferred values.
- Sparse historical purchase data is not zero purchasing.
- Purchase Register fallback capability remains during migration until the replacement path is validated.

## Current stock status
Current stock is **not reliable** for stock-dependent replenishment.

The owner will explicitly decide when some or all stock becomes reliable. A later system must verify which stock is reliable and which is not.

Until then, stock-dependent reorder output must not be treated as authoritative.

## Open decisions
See `OPEN_DECISIONS.md`, especially O1 persistence, O2 Product Master, O3 stock-state authority/mutation timing and O8 stock reliability verification.
