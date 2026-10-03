# FILES_TO_COLLECT

The knowledge base describes the system. To make the GitHub repository the
**complete source of truth** — able to rebuild or recover Version 1 — the
actual source files still need to be collected into it. This is the checklist.

**Why this matters:** right now, the only complete copy of much of the code
(especially the Supabase view SQL) is the live system itself. If a Google
account, a Supabase project, or a Hostinger account were lost, parts of the
system could not be rebuilt. Collecting these closes that gap.

The owner is a non-coder, so each item says **where to get it** and **how**,
in plain steps.

---

## 1. Apps Script code — ALL `.gs` files  ✅ captured

The single Apps Script project ("product database") contains ~60+ `.gs` files.
The repository needs **every one, exactly as it is live** (not the working
copies from chat — the live editor is the truth, and some files were edited by
hand there).

**How to get them:**
- Easiest for a non-coder: open the Apps Script editor, open each file, select
  all, copy, and paste into a text file named the same way. Tedious but safe.
- Better (ask a developer once): install **`clasp`** (Google's command-line
  tool) and run `clasp clone <script id>` — it downloads every `.gs` and the
  manifest in one go. Do this once and future pulls are one command.

**Also capture:**
- ⬜ `appsscript.json` (the project manifest — shows scopes, time zone,
  web-app config).
- ⬜ The **Script Properties names** (not values) — a screenshot of Project
  Settings → Script Properties, with values blanked.
- ⬜ The **list of installed triggers** — run `whatIsLive()` and save its
  output; it lists them.
- ⬜ A note of the **web-app deployment URL(s)** and their access setting
  (Execute as / Who has access). Not the URL as a secret — just recorded.

Cross-check the live file list against `APPS_SCRIPT.md`; note any file that
exists live but is not described, and any described file that is not live.

---

## 2. HTML dashboards  ✅ captured

Each dashboard, the live version:
- ⬜ `VT_Floor.html`
- ⬜ `VT_Office.html`
- ⬜ `VT_Recon.html`
- ⬜ `VT_Inventory.html`
- ⬜ `VT_Dashboard_11.html` (pricing/verify — parked but part of V1)
- ⬜ `VT_Receivables.html` (older, superseded — keep for history)

**How:** if they are files inside the Apps Script project, they come with the
`clasp clone` above (as `.html`). If any is opened as a local file or hosted
somewhere, collect that exact copy and **note where it is hosted**.

---

## 3. Supabase — schema and logic  ✅ captured as freeze snapshots

The main V1 pg_dump is in `supabase/schema.sql`. A later live delta found
during the 2026-10-03 freeze is preserved under
`supabase/pre-v2-scaffolding/`. A future fresh full dump can consolidate both.

- ⬜ **Every table's DDL** (`CREATE TABLE ...`). From the Supabase dashboard,
  or `supabase db dump --schema public`.
- ⬜ **Every view's definition.** In the SQL editor, run for each view:
  `select pg_get_viewdef('public.<view_name>', true);` — or capture them all
  at once with `supabase db dump`. There are ~34 views; `v_sales_all` and
  `v_reconciliation` are the most important.
- ⬜ **Every function** (e.g. `vt_num`, `vt_date`, `vt_month`,
  `vt_party_name`, `vt_doc_no`) — `pg_get_functiondef`.
- ⬜ **Indexes and constraints** (included in a full `db dump`).
- ⬜ **RLS state** — a note that RLS is on with zero policies (already in
  SECURITY.md; capture the actual policy list to confirm it is still empty).
- ⬜ Confirm whether any **pg_cron jobs or Edge Functions** exist (assumed
  none) — `select * from cron.job;` and the Functions tab.

**Best single method:** ask a developer to run `supabase db dump` once and
commit the resulting SQL. That captures tables, views, functions, indexes and
policies together.

---

## 4. Hostinger FTP pipeline  ✅ core recovery files captured

- ⬜ `supabase.php` — the live version from Hostinger
  (`/home/u631621082/` or the web directory). **Commit a sanitised copy**
  (`supabase.php.example`) with the key line blanked; never the real key.
- ⬜ The **cron schedule** — a screenshot of the Hostinger cron settings
  (what runs, when).
- ⬜ A note of the **FTP details' location** (which account, which folder the
  Vasy CSVs land in) — not the password.
- ⬜ One **sample of each CSV** Vasy drops (headers + a few rows, with any
  sensitive values removed) so the column mapping is documented by example.

---

## 5. Google Sheets structure  ⬜

Not the data (that is huge and lives in Supabase), but the **structure**:
- ⬜ A list of the **workbooks** and their IDs (from Script Properties), with
  what each holds (cross-check `ARCHITECTURE.md`).
- ⬜ For the key workbooks, a list of **tab names** and, for the important
  tabs (Sales_Monthly, Product_Analytics, Stock_Live, the read models, the
  Receipts / outstanding tabs), the **header row** — so the shape is
  documented even if the workbook is lost.
- ⬜ Any **manual/config tabs** (e.g. the stock calibration offset, any
  settings tab) captured in full — these hold values that are not reproducible
  from Vasy.

---

## 6. Configuration reference (no secrets)  ⬜

A single `CONFIG.md` (or a section in the repo README) listing:
- ⬜ Every Script Property name and what it is for (values blank).
- ⬜ The Supabase project ref.
- ⬜ The Vasy branch id.
- ⬜ Endpoint paths and their proven constants (from `ERP_INTEGRATION.md`).
- ⬜ The deployment URLs (recorded, not as secrets).

---

## Suggested repository layout

```
/docs/            <- this knowledge base (the .md files)
/apps-script/     <- every .gs file + appsscript.json
/dashboards/      <- the HTML files
/supabase/        <- schema.sql, views.sql, functions.sql (from db dump)
/hostinger/       <- supabase.php.example, cron note, sample CSVs
/sheets/          <- workbook + tab structure notes
CONFIG.md         <- config reference (no secrets)
.gitignore        <- excludes anything that could hold a secret
README.md         <- points at /docs/README.md
```

---

## Priority order

1. **Google Sheets structure/manual-config recovery** — still the weakest area.
2. **Consolidated fresh Supabase pg_dump** — useful maintenance; immediate
   missing-DDL risk is already covered by schema.sql + the 2026-10-03 delta.
3. **CONFIG.md / recovery map** — useful cleanup; Script Property names are
   already captured.
4. Everything else.

Once 1–3 are in the repo, Version 1 is genuinely recoverable, and the system
no longer depends on any chat conversation — which was the goal.
