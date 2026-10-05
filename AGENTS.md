# AGENTS.md — Vithya Traders repository operating instructions

## Purchase Intelligence V1.1 transitional release

Branch: `purchase-v1.1-transition`.

For V1.1 live-maintenance work, read first:
1. `purchase-intelligence-v1.1/README.md`
2. `purchase-intelligence-v1.1/docs/PROJECT_STATE.md`
3. `purchase-intelligence-v1.1/docs/CHANGE_REGISTER_V1_1.md`
4. `purchase-intelligence-v1.1/docs/TEST_PLAN.md`
5. `purchase-intelligence-v1.1/docs/GIT_WORKFLOW.md`
6. `docs/PURCHASE_V1_FREEZE_VERIFICATION.md`
7. relevant frozen V1 source for comparison only.

V1.1 is a transitional production upgrade. Prefer the smallest safe,
backward-compatible implementation that delivers the required business
behaviour. Do not force clean-V2 architecture into V1.1.

The frozen archive `archive/purchase-intelligence-v1/` and tag
`purchase-v1-v8.6` are immutable.

When a V1.1 change is proven live, copy/pull the exact tested source back into
`purchase-intelligence-v1.1/`, update the V1.1 change register, then commit
code and documentation together.

Do not merge V1.1 wholesale into clean V2. Promote validated behaviour and
lessons deliberately through V2 documentation.

This repository is the persistent project memory. Do not depend on any previous chat conversation to understand or change the system.

## Platform V2 governance
For Platform V2 work, first read `docs/platform-v2/START_HERE.md` and `docs/platform-v2/PRINCIPLES.md`.

For any work touching both Purchase Intelligence and Inventory, also read `docs/shared/PURCHASE_INVENTORY_CONTRACT.md`. For Inventory analytical work, also read `docs/inventory/ANALYTICS_TARGET.md`.

Pre-V2 Supabase objects under `supabase/pre-v2-scaffolding/` are reference/design candidates only unless an active V2 decision explicitly approves their concept.

## Active Purchase Intelligence project
Purchase Intelligence V2 is developed on branch `v2-development`.

Before any Purchase Intelligence work, read:
1. `docs/v2/START_HERE.md`
2. `docs/v2/PROJECT_STATE.md`
3. `docs/v2/CURRENT_WORK.md`
4. `docs/v2/DECISIONS.md`
5. `docs/v2/ROADMAP.md`
6. the active file under `docs/v2/work-items/`
7. `docs/v2/TEST_PLAN.md`
8. `docs/PURCHASE_V1_FREEZE_VERIFICATION.md`
9. then relevant V1 archive/source files.

## Precedence
1. Verified live behaviour and actual source/deployment.
2. `docs/PURCHASE_V1_FREEZE_VERIFICATION.md` for post-freeze verified V1 facts.
3. Active `docs/v2/` docs for V2 current state and decisions.
4. Frozen V1 source under `archive/purchase-intelligence-v1/`.
5. Frozen V1 documentation.
6. Older system-wide docs/history.

Never silently resolve a conflict; record the resolution in active V2 docs.

## Frozen V1
`archive/purchase-intelligence-v1/` is immutable. Do not edit, rename, reformat or clean it up. The tag `purchase-v1-v8.6` marks the frozen baseline.

## Standard change loop
1. Read memory docs and relevant source.
2. Restate the requested business behaviour plainly.
3. Verify assumptions against source/live system.
4. Update/create the work-item spec when behaviour is new.
5. Make the smallest safe change.
6. Test against `TEST_PLAN.md`.
7. Update state/current-work/decisions/roadmap as needed.
8. Commit code and memory together.
9. Push and record deployment verification if deployed.

A feature is not complete until Git explains what changed, why, how it was tested and what remains.

## Owner communication
The owner is a non-coder. Explain what changes, why, affected files/data, whether deployment is needed, how to verify success, and the next manual action. Give manual steps one at a time.

## Security
Never commit keys, passwords, PIN hashes or trigger tokens. Never expose the Supabase service-role key to browser code.

## Purchase V2 invariants
- FIFO is a suggestion only; allocations remain editable.
- Shipment, Bill and Receipt quantities are independent.
- Excess and Off-PO are distinct.
- Creating a shipment means In Transit, not Received.
- Bills may be prepared before arrival.
- Accepted = Received - Rejected; rejection is normally an exception.
- Shipment↔PO and Bill↔Shipment are many-to-many through allocations.
- Preserve GST/Non-GST rules and existing bill/upload behaviour unless explicitly changed.
- Never expose supplier/rate/amount in PO-Request Goods Check.

When uncertain, verify rather than inventing fields, rules, IDs or live behaviour.
