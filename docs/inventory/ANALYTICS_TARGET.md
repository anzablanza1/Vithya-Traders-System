# Inventory — ANALYTICS TARGET

Status: APPROVED SCOPE / OPEN METHODOLOGY

This defines what Inventory analytics must eventually answer, not the formulas or implementation.

## Approved analytical scope
- 6-month demand;
- 12-month demand;
- 24-month demand;
- ABC analysis;
- XYZ analysis;
- FSN analysis;
- demand-pattern analysis;
- customer concentration;
- exceptional-demand analysis;
- raw demand vs normalized/baseline demand;
- demand trend;
- demand confidence.

## Demand source
Demand planning is sales-derived. Purchase quantities describe procurement history and must not substitute for demand.

## Exceptional demand
Required:
- candidates can be surfaced;
- human review is possible;
- review outcome is retained;
- raw demand is never deleted;
- normalized/baseline demand remains separate and auditable.

The detection algorithm and thresholds remain open.

## Current stock reliability
Current stock is **not reliable for stock-dependent replenishment calculations**.

The owner will explicitly state when stock becomes reliable. A later verification system must represent which stock is reliable and which is not.

Until then:
- demand analytics may proceed without stock;
- stock-dependent safety/reorder/coverage recommendations are not authoritative;
- observed stock must not silently unlock replenishment logic.

## Open methodology
Still unresolved:
- ABC basis/boundaries;
- XYZ formula/thresholds;
- FSN formula/thresholds;
- demand-pattern formula/thresholds;
- customer-concentration methodology/thresholds;
- exceptional-demand detection;
- safety stock;
- reorder point;
- coverage/target stock;
- service-level policy;
- exact Inventory policy-field ownership.

## DESIGN_CANDIDATE examples only
CV 0.5/1.0, ADI 1.32/CV² 0.49, prototype FSN thresholds, Top1 concentration bands, HHI, IQR/median-multiple outlier rules and fixed service/coverage defaults are not approved.

See `docs/platform-v2/DESIGN_CANDIDATES.md`.

## Cross-system boundary
Use `docs/shared/PURCHASE_INVENTORY_CONTRACT.md`. Inventory must not build a parallel supplier-commercial system.
