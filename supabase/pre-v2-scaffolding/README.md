# Pre-V2 Supabase scaffolding snapshot — 2026-10-03

This folder preserves live Supabase objects that existed on 2026-10-03 but were newer than the committed `supabase/schema.sql`.

## Status

These objects were created in a separate pre-freeze chat while preparing Purchase and Inventory data handover/analytics. They predate the currently approved Purchase V2 architecture and the repository rule that every database change must be committed with documentation.

They are **preserved history/reference**, not automatically approved V2 design. Official Purchase V2 implementation may still be described as not started if the current roadmap has not implemented its approved model.

## Main-system V1 objects to keep/document

- `expense_register_data` — real Vasy/FTP expense feed added after the earlier schema dump.
- `v_customer_360`
- `v_customer_fy2627`

## Pre-V2 PO prototype — preserve, likely redesign

- `po_headers`, `po_lines`, `po_shipments`, `po_shipment_lines`
- `po_receipts`, `po_receipt_lines`, `po_audit`, `po_sku_analytics`
- `purchase_request_lines`, `refresh_po_analytics`, `v_po_line_execution`

The prototype PO model contains direct PO links on shipment/receipt objects and therefore must **not** be assumed to satisfy the approved Purchase V2 many-to-many allocation model.

## Pre-V2 shared Purchase/Inventory analytics — preserve for evaluation

- `sku_master`, `sku_alias_map`, `supplier_master`
- `inventory_sku_analytics`, `inventory_sku_monthly_demand`, `inventory_sku_policy`
- `inventory_settings`, `inventory_demand_exception_review`
- `purchase_sku_analytics`, `purchase_sku_policy`
- `purchase_sku_supplier_analytics`, `purchase_sku_supplier_policy`
- `purchase_buyer_override`, `analytics_refresh_log`
- `analytics_data_quality_issue`, `data_sync_state`
- `v_inventory_exception_candidates`, `v_inventory_to_purchase`
- `v_purchase_action_queue`, `v_purchase_inventory_data_quality`
- `v_purchase_to_inventory`, `v_stock_parent_current`

These may inform Platform V2 but must be reviewed rather than inherited blindly.

## Edge Function found during freeze

A live Edge Function named `pp-planner-list` also existed and was not mentioned in the earlier gap audit. Its source is preserved here in sanitized form.

The live function had JWT verification disabled and contained a hard-coded access token. The token value is intentionally excluded from Git and should be treated as exposed legacy security debt. Do not copy this implementation into a new production design without security review.

## RLS

All 26 captured tables had RLS enabled at capture time. No policies were found for those tables, consistent with the V1 service-role-only posture.

## Files

- `schema_delta_2026-10-03.sql` — catalog-derived reconstruction SQL for the 26 tables, 9 views and `refresh_po_analytics`.
- `edge-functions/pp-planner-list/index.ts` — sanitized live source.

The older consolidated V1 dump remains `supabase/schema.sql`. This delta closes the immediate Git-memory gap; a future fresh full pg_dump can consolidate both snapshots.
