# Platform V2 — PRINCIPLES

## P1 — Clean redesign
Platform V2 is a **clean redesign, not a refactor of V1**.

V2 may change:
- UI;
- architecture;
- database schema;
- table/view names;
- Google Sheets usage;
- Apps Script usage;
- API ingestion;
- analytical formulas;
- workflow implementation;
- dashboard layout;
- hosting/runtime technology.

V1 constrains V2 only where something is explicitly:
- an approved business requirement;
- an external ERP/Vasy constraint;
- a migration/backward-compatibility requirement;
- an accounting, legal or data-integrity requirement.

Otherwise V1 is evidence/reference, not specification.

## P2 — Business meaning before implementation
Define business objects, states, ownership and integrity rules before choosing technical implementation.

## P3 — One owner per calculation
- Inventory owns demand/replenishment intelligence.
- Purchase owns supplier/commercial/procurement intelligence.
- Inventory provides the pre-commercial replenishment need/recommendation.
- Purchase applies supplier, MOQ, pack and commercial constraints to make the final procurement decision.

## P4 — Preserve facts and interpretations separately
Raw facts, reviewed exceptions, normalized demand, workflow states and recommendations remain distinguishable.

## P5 — Reliability is explicit
Current stock is **not reliable for stock-dependent replenishment calculations**. It stays gated until the owner explicitly approves a future verification system and reliable scope.

## P6 — Open means open
Never resolve an OPEN_DECISION through convenience, prototype inheritance or assumption.

## P7 — Design candidates are disposable
Objects under `supabase/pre-v2-scaffolding/`, prototype formulas and V1 technical patterns may be reused, changed or discarded.

## P8 — Frozen V1 stays frozen
V1 archives are immutable recovery/reference material.
