# Vithya Traders System V1 — Freeze Verification

Verified: 2026-10-03

This document records the final freeze status of the broader Vithya Traders
V1 system (main Product Database Apps Script + dashboards + Supabase + Hostinger
pipeline). Purchase Intelligence has its own separate frozen archive and tag.

## 1. Main-system source recovery

PASS.

Git contains:
- the full captured main Apps Script project under `apps-script/`;
- `appsscript.json`;
- deployment and version lists;
- Script Property names only (no secret values);
- `WHAT_IS_LIVE.txt`;
- all six dashboard HTML files under `dashboards/`;
- sanitized Hostinger ingestion code and cron notes.

The owner confirmed that the original main-dashboard chat made no post-freeze
code changes after this capture.

## 2. Main-system architecture and business-rule memory

PASS.

The system-wide `docs/` set records the major business rules, architecture,
data flows, Vasy/FTP/API behaviour, reconciliation model, inventory model,
dashboard purpose, deployment model, known issues and historical decisions.

A memory-gap audit on 2026-10-03 concluded that no unique main-system knowledge
would be lost if the original build chat disappeared.

## 3. Supabase recovery

PASS FOR FREEZE, with point-in-time snapshots.

The older main-system database snapshot is preserved in:
- `supabase/schema.sql`
- `supabase/roles.sql`
- `supabase/config.toml`

The 2026-10-03 live audit found newer objects not present in that older dump.
Those exact newer table/view/function definitions are now preserved in:
- `supabase/pre-v2-scaffolding/schema_delta_2026-10-03.sql`
- `supabase/pre-v2-scaffolding/README.md`

This closes the immediate risk that the newer DDL existed only in live
Supabase.

## 4. Classification of the newer Supabase objects

The newer live objects were created in a separate pre-freeze chat while
preparing Purchase/Inventory handover and analytics.

They are **not automatically approved Platform V2 architecture**.

### Main-system V1 additions
- `expense_register_data`
- newer `v_customer_360`
- `v_customer_fy2627`

### Pre-V2 Purchase/PO prototype
The `po_*` tables, PO execution view and `refresh_po_analytics` are preserved
for reference. They may be replaced because the approved Purchase V2 model
requires explicit many-to-many Shipment↔PO and Bill↔Shipment allocations.

### Pre-V2 shared Purchase/Inventory analytics
The SKU master, alias map, supplier master, purchase/inventory analytics,
policy, data-quality and refresh-state objects are preserved for later
evaluation. Their existence does not make them the approved V2 source of
truth.

## 5. Edge Function discovered during freeze

The live project contained one Edge Function:
- `pp-planner-list`

Its live source contained a hard-coded access token and JWT verification was
disabled.

The token value is intentionally excluded from Git. A sanitized source copy is
preserved under:
`supabase/pre-v2-scaffolding/edge-functions/pp-planner-list/index.ts`

Treat this as legacy/pre-V2 security debt. Do not reuse it in a new production
design without explicit security review.

## 6. RLS / scheduling snapshot

At the 2026-10-03 audit:
- all 26 newly captured tables had RLS enabled;
- no policies were found on those tables;
- no pg_cron jobs were present;
- the legacy/pre-V2 Edge Function above existed.

## 7. Google Sheets

PASS WITH KNOWN DOCUMENTATION LIMITATION.

Sheets remain V1 staging/computation/manual/read-model layers. Workbook
property names and important workbook/tab roles are documented under
`sheets/STRUCTURE.md` and the Apps Script/docs set.

The exact manual/config values (especially stock-calibration inputs) should be
preserved privately if V1 must be restored bit-for-bit. They are not a blocker
for the planned clean Platform V2 rebuild, but they remain part of V1 recovery
context.

## 8. Known frozen V1 issues intentionally preserved

The freeze records existing V1 issues instead of silently "fixing" them,
including:
- old/shadowed Apps Script definitions reported by `WHAT_IS_LIVE.txt`;
- unreliable historical landing cost;
- partial historical receipt-to-invoice linkage;
- broken/delta FTP product export;
- stock calibration requirement;
- intermittent FTP feed;
- legacy technical debt and probes.

A freeze is a recoverable record of what existed, not a claim that V1 was
perfect.

## 9. Purchase Intelligence relationship

Purchase Intelligence V1 remains separately frozen under:
`archive/purchase-intelligence-v1/`

Its tag remains:
`purchase-v1-v8.6`

The pre-V2 Supabase scaffolding captured during this System V1 freeze does not
modify that archive and does not change the official Purchase V2 work-item
status.

## 10. Final freeze conclusion

The broader Vithya Traders System V1 is recoverable and sufficiently
documented for the original main-system build chat to be retired.

Future architecture work should treat:
- this V1 freeze as reference/history;
- live Vasy as ERP source;
- Git as persistent project memory;
- any new database/schema change as incomplete until its migration/DDL and
  design decision are committed to Git.

No V1 code or database object was deleted as part of this freeze.
