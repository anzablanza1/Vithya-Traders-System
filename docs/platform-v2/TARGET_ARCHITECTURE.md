# Platform V2 — TARGET ARCHITECTURE BOUNDARIES

This document describes business/system boundaries only. It deliberately does not choose final database, schema, API, Sheets, runtime, hosting or synchronization technology.

## Source roles
### Sales
Customer-demand facts. New demand/replenishment planning is sales-derived.

### Purchase Register
Actual procurement/billing history: how the business bought. It is neither PO lifecycle nor customer demand.

### PO lifecycle
Operational ordering, shipment, receipt and cancellation. PO Count belongs here.

### Stock
Observed inventory state. Current stock is not reliable for stock-dependent replenishment until a future verification system and reliable scope are approved.

### Vasy/ERP
External accounting/ERP behaviour, identifiers and integration constraints. Proven V1 behaviour is evidence of an external constraint; V1's implementation pattern is not automatically V2 architecture.

## Domain ownership
### Inventory owns
Demand intelligence, approved classifications, raw/normalized demand and the replenishment need/recommendation once methodology is approved.

### Purchase owns
Procurement history, supplier/commercial intelligence, supplier commitments, PO execution, supplier selection and final procurement decision.

## Shared identity
Parent SKU is the shared analytical identity of one physical product across GST/non-GST ERP variants. O2 still decides Product Master authority.

## Shared lifecycle
Ordered, In Transit, Received, Pending, Cancelled, Rejected and Bill/MI preparation are distinct concepts.

Shipment is not Receipt. Bill/MI preparation is not Receipt. Cancellation is not Rejection.

Exact stock mutation timing remains open.

## Cross-domain contract
See `docs/shared/PURCHASE_INVENTORY_CONTRACT.md`.

## Explicit non-decisions
This document does not approve any current prototype schema, view name, API, persistence pattern, analytics table, formula, threshold or stock mutation event.
