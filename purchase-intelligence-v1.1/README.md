# Purchase Intelligence V1.1 — Transitional Live Release

V1.1 is a controlled live-maintenance branch built from the frozen Purchase Intelligence V1 baseline.

It exists because the business needs the Shipment/Bill/Goods-Check improvements before the clean Platform/Purchase V2 rebuild is finished.

## What V1.1 is

V1.1 is a **transitional production upgrade** to the existing V1 system.

It may change the live V1 code and workflow, but it must:
- preserve the frozen V1 archive unchanged;
- remain recoverable;
- use the smallest safe changes compatible with the existing live system;
- document every production change in Git;
- preserve working V1 integrations unless the V1.1 work item explicitly replaces them.

## What V1.1 is not

V1.1 is **not** the final V2 architecture.

Do not assume a V1.1 implementation choice must be copied into V2.

V1.1 is valuable to V2 as:
- validated business behaviour;
- real employee feedback;
- migration evidence;
- proof of edge cases;
- evidence of what did or did not work.

The final V2 may use a different database model, runtime, UI, API layer, hosting model or implementation.

## Frozen V1

The immutable V1 reference remains:

`archive/purchase-intelligence-v1/`

Tag:

`purchase-v1-v8.6`

Never modify that archive or move the frozen tag.

## Active V1.1 source

- Apps Script: `purchase-intelligence-v1.1/apps-script/`
- Frontend: `purchase-intelligence-v1.1/frontend/`
- V1.1 docs: `purchase-intelligence-v1.1/docs/`

The source here was seeded from the frozen V1 Git copy. Future live V1.1 changes must be copied/pulled back into this directory and committed.

## Branch

Active branch:

`purchase-v1.1-transition`

Do not develop V1.1 directly on `v2-development`.
