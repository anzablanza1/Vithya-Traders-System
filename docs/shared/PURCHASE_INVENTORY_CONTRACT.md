# Purchase ↔ Inventory Shared Contract

Status: ACTIVE BUSINESS CONTRACT
Technical interface: OPEN

This document defines business semantics and calculation ownership. It does not prescribe SQL, tables, APIs, Sheets or hosting.

## Data roles

### Sales
Customer-demand facts. New demand/replenishment planning is sales-derived.

### Purchase Register
Actual procurement/billing history: how we bought. It is not PO lifecycle and not demand.

### PO lifecycle
Operational ordering, shipment, receipt and cancellation. PO Count belongs here.

### Stock
Observed inventory state. **Current stock is not reliable for stock-dependent replenishment.** The owner will explicitly approve reliability later after a verification system establishes which stock is reliable.

## Shared product identity
GST/non-GST ERP variants are one physical product for consolidated analysis while exact ERP code/lane remains preserved for billing/upload.

Parent SKU is the shared analytical identity. Product Master authority remains O2.

## Ownership

### Inventory owns
- demand intelligence;
- approved Inventory classifications;
- raw vs normalized/baseline demand;
- trend and demand confidence;
- pre-commercial replenishment need/recommendation once methodology and stock reliability allow it.

Purchase consumes these outputs rather than recomputing a competing version.

### Purchase owns
- procurement history;
- supplier/commercial intelligence;
- supplier commitments;
- PO execution/follow-up;
- supplier selection;
- final procurement decision.

### Final quantity boundary
Inventory determines the replenishment need before supplier/commercial constraints.

Purchase may apply confirmed MOQ, pack/order multiple and commercial/procurement considerations to reach the final quantity actually purchased.

The future system should keep the difference explainable/auditable.

## Core quantities/states
- **Ordered** — quantity represented by the PO model.
- **In Transit** — shipped but not received.
- **Received** — physically recorded as arrived.
- **Pending** — outstanding PO quantity still to progress.
- **Accepted** — receipt/Goods Check outcome after applicable receipt exceptions.
- **Cancelled** — ordered quantity that will no longer be fulfilled.
- **Rejected** — physically received quantity not accepted.

Cancellation is not Rejection. Shipment is not Receipt.

Exact derivation under the final V2 allocation model and exact stock mutation consequence remain open where stated.

## Shipment, Bill/MI and Receipt
Shipment, Bill and Receipt are independently auditable.

Bill/MI preparation may occur before physical arrival and does not by itself mean Receipt or stock availability.

Material Inward terminology remains OPEN: V2 must distinguish supplier bill, Bill/MI preparation, physical Receipt, Goods Check/acceptance, Vasy MI posting and upload completion.

## Inventory → Purchase information
Conceptually includes:
- 6/12/24-month demand;
- approved ABC/XYZ/FSN/demand-pattern results;
- trend and demand confidence;
- raw and normalized demand;
- exceptional-demand review context;
- stock state and reliability status;
- incoming/open supply context;
- replenishment need/recommendation when allowed.

Exact interface/fields are future design.

## Purchase → Inventory information
May include supplier-neutral planning context such as:
- purchase-history quantities/cadence;
- open/incoming PO state;
- future-approved planning lead time/fill/OTIF/reliability;
- confirmed MOQ/pack where planning needs it;
- viable supply-source count / single-source risk.

Where commercial identity is unnecessary, Inventory must not require supplier name/contact, supplier-specific cost/rate, negotiation notes or supplier commercial comparisons.

## Exceptional demand
Exceptional/project demand must be reviewable. Raw history remains preserved. Normalized/baseline demand is a separate auditable interpretation. Detection algorithm remains open.

## MOQ/pack/commitments
Confirmed/manual values override inferred values. Inferred values must remain identifiable as inferred.

## Historical completeness
Sparse historical purchase data must never be interpreted as zero purchasing.

## Open decisions
See `docs/platform-v2/OPEN_DECISIONS.md`.

## Prototype warning
Pre-V2 Supabase exchange views/tables are design candidates only. Their names/shapes are not part of this contract.
