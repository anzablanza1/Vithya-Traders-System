# Platform V2 — V1 COMPATIBILITY AND REFERENCE

V1 is evidence and migration reference, not automatically the Platform V2 technical specification.

## V1 may inform
- real business behaviour and edge cases;
- actual data availability/gaps;
- proven Vasy/ERP constraints;
- migration/backward compatibility;
- operational failure lessons;
- workflows that must be consciously preserved or replaced.

Frozen V1 archives remain immutable.

## Purchase Register migration
At freeze, Purchase history had Supabase, Google Sheet/RegisterApi and existing manual recovery/fallback paths.

**Approved migration requirement:** keep existing fallback capability until the new path is validated. This does not require those technologies permanently.

## Data-quality reference
- Purchase history before Apr 2026 is sparse; missing rows are not proof of zero purchasing.
- V1 stock has used calibration/workarounds. Current Platform V2 status is: stock is **not reliable for stock-dependent replenishment** until later verification and owner approval.
- V1 `erp_snapshot` is useful evidence for O2, not a decision that it is the V2 Product Master.

## V1 analytics
Current V1 ABC/XYZ/cover/flag formulas describe V1 only. V2 analytical scope is separate and methodology remains open.

## REJECTED_SUPERSEDED assumptions
Do not inherit:
- one Shipment/Lot = one PO;
- one Bill = one Shipment/Lot;
- LIFO allocation;
- Shipment creation = Received;
- Bill preparation = physical Receipt;
- one shared Shipment/Bill/Receipt quantity;
- Excess automatically increases ordered qty;
- Excess = Off-PO;
- purchase history substitutes for sales demand when sales exists;
- V1 purchase-derived EOQ/reorder is V2 truth;
- pre-V2 schemas are official because they exist;
- V1 UI/Apps Script/Sheets structure constrains V2 architecture.
