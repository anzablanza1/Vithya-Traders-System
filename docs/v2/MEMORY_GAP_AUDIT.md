# Purchase Intelligence — MEMORY GAP AUDIT

Audit date: 2026-10-03
Source: one-time comparison by the original Purchase Dashboard build chat against Git branch `v2-development`.
No code changes were made during the audit.

## Verdict
The substantive Purchase Intelligence V1 knowledge and agreed V2 redesign survived in Git.

The main deficiency was organisational: Purchase-specific truth and the V2 plan were discoverable mainly inside `archive/purchase-intelligence-v1/`, while top-level system docs still looked like the broader September V1 handover.

## Key findings
- No active top-level route pointed a new AI to Purchase V2.
- Broader TODO did not show Purchase V2 as active work.
- Archived V1 docs still contain some unresolved statements later clarified by the freeze-verification document.
- Purchase-specific business rules were preserved but buried in frozen docs.
- The V2 plan was accurate but lived under the frozen archive, making it look historical.
- A new AI could confuse the main Product Database Apps Script project with the separate Purchase Apps Script project.
- V2 product-master authority remains an explicit open decision.
- Point-in-time live runtime facts should be rechecked before consequential deployment.

## Resolution
This active `docs/v2/` memory layer and root `AGENTS.md` were created so a new chat is routed correctly.

The V1 archive remains immutable. Where freeze-era docs say NEEDS LIVE VERIFICATION but `docs/PURCHASE_V1_FREEZE_VERIFICATION.md` later resolves the fact, the newer verification doc governs.

A cold-start test is required before V2 implementation begins.
