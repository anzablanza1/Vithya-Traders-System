# Platform V2 — OPEN DECISIONS

Do not choose any item here silently.

## O1 — V2 persistence architecture
Durable store, operational editing layer, Sheets/Supabase roles, sync/failure handling, auditability and migration coexistence.

## O2 — Product Master authority
Authoritative product source and governance for Parent SKU, aliases, attributes and new-product creation.

## O3 — Stock-state authority and mutation timing
Define physical on-hand, accepted/usable stock, rejected/returned treatment, analytical inventory position, Vasy/ERP stock timing and temporary physical-vs-ERP disagreement.

Current fact: stock is **not reliable** for stock-dependent replenishment. The owner will explicitly approve reliability later.

## O4 — Material Inward lifecycle terminology
Define supplier bill, Bill/MI preparation, physical Receipt, Goods Check/acceptance, Vasy MI posting and upload completion distinctly.

## O5 — Inventory planning lead time
Choose the lifecycle duration/combination used for planning.

## O6 — Fill-rate definition
Numerator, denominator, cancellation/acceptance treatment, aggregation level and horizon.

## O7 — OTIF definition
Line vs PO basis, original vs revised promise, first vs final delivery, partial/cancellation treatment and eligible samples.

## O8 — Stock reliability gate and verification system
Define how reliability is tested, represented and approved, including global/per-SKU/per-lane scope, tolerance, staleness and how unreliable stock is blocked.

## O9 — ABC methodology
Scope approved; basis/boundaries open.

## O10 — XYZ methodology
Scope approved; formula/thresholds open.

## O11 — FSN methodology
Scope approved; formula/thresholds open.

## O12 — Demand-pattern methodology
Scope approved; model/formulas/thresholds open.

## O13 — Customer-concentration methodology
Measures, quantity/value basis, anonymous/cash treatment and thresholds.

## O14 — Exceptional-demand detection algorithm
Human review/raw-vs-normalized preservation are approved; candidate detection remains open.

## O15 — Safety-stock methodology
No fixed formula/default service level approved.

## O16 — Reorder-point methodology
Open.

## O17 — Coverage / target-stock methodology
Open. No generic fixed-day policy is approved.

## O18 — Inventory policy-field ownership
Ownership/governance of criticality, service level, target coverage, do-not-stock, discontinue, substitutes and min/max overrides.

## O19 — Permanent Purchase↔Inventory technical interface
Business contract approved; tables/views/APIs/services/events remain architecture work.
