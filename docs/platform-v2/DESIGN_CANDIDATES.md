# Platform V2 — DESIGN CANDIDATES

These ideas are preserved for future evaluation. None is approved merely because it exists.

## Pre-V2 schemas/models
- `sku_master`;
- `sku_alias_map`;
- `inventory_sku_analytics`;
- `purchase_sku_analytics`;
- `purchase_sku_supplier_analytics`;
- prototype Inventory/Purchase policy tables;
- prototype buyer-override model;
- old/pre-V2 `po_*` schema.

The old `po_*` prototype is non-authoritative where it conflicts with approved Purchase V2 many-to-many Shipment↔PO or Bill↔Shipment allocations.

## Cross-domain interface candidates
- `v_inventory_to_purchase`;
- `v_purchase_to_inventory`;
- `v_purchase_action_queue`;
- prototype readiness/data-quality views.

The business need for exchange is approved; these SQL names/shapes are not.

## Methodology candidates
- CV XYZ thresholds 0.5 / 1.0;
- ADI 1.32 / CV² 0.49;
- prototype FSN thresholds;
- customer-concentration threshold bands;
- HHI;
- IQR/median-multiple/percentile exceptional-demand detection;
- P90 first receipt as planning lead time;
- prototype fill-rate/OTIF/partial-delivery formulas;
- fixed service-level or coverage defaults;
- statistical MOQ/pack inference.

## Architecture candidates
- Supabase durable store + Google Sheets operational/debug layer;
- server-side analytical read models;
- combined buyer action queue;
- durable audit/event logging.

All may be reused, modified or discarded.
