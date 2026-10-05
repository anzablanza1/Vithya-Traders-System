# Vithya Traders Platform V2 — START HERE

Platform V2 is the clean-redesign memory layer for the wider Vithya Traders system.

Git is persistent project memory. Chats, V1 implementations and pre-V2 prototypes are evidence only unless active V2 documentation explicitly classifies them otherwise.

## Required reading
For Platform V2 or cross-domain work:
1. `docs/platform-v2/PRINCIPLES.md`
2. `docs/platform-v2/PROJECT_STATE.md`
3. `docs/platform-v2/OPEN_DECISIONS.md`
4. the relevant shared contract, especially `docs/shared/PURCHASE_INVENTORY_CONTRACT.md`
5. relevant domain targets/specifications, including `docs/inventory/ANALYTICS_TARGET.md`
6. `docs/platform-v2/DESIGN_CANDIDATES.md`
7. `docs/platform-v2/V1_COMPATIBILITY.md`
8. relevant frozen V1 material only for evidence, migration and proven external behaviour

For Purchase Intelligence, continue with the reading order in `docs/v2/START_HERE.md`.

## Classification system
- **APPROVED_REQUIREMENT** — V2 must respect it.
- **OPEN_DECISION** — important and unresolved; never choose silently.
- **DESIGN_CANDIDATE** — potentially useful; may be reused, modified or discarded.
- **V1_REFERENCE** — evidence about V1 behaviour/data/lessons; not V2 specification.
- **REJECTED_SUPERSEDED** — must not return as an accidental V2 assumption.

Prototype implementation does not become approved because it exists in Git, Sheets, Apps Script or live Supabase.

## Current focus
Establish business boundaries and resolve open decisions before final technical architecture or implementation.
