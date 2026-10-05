# V2-02 — Migration / backward compatibility

Status: PENDING
Depends on: V2-01

## Goal
Represent existing V1 lots in the new V2 model without destroying or rewriting V1 history.

## Requirements
- Keep existing Purchase Register fallback capability during migration until the replacement path is explicitly validated; this does not require retaining V1 technology permanently.
- V1 Lots/Lot Lines remain readable during transition.
- Existing lot identity remains traceable to resulting Shipment records.
- Migration must not duplicate quantities if rerun.
- Existing per-lot bill/receipt information must be mapped or explicitly marked where no exact V2 equivalent exists.
- PO status moves to allocation-derived logic only after reconciliation proves parity for V1-representable cases.

## Acceptance
- Sample V1 POs reconcile before/after migration.
- No V1 historical record silently discarded.
- Duplicate-run guardrails exist.
- Recovery/rollback documented.
- TEST_PLAN B, C and E pass.
