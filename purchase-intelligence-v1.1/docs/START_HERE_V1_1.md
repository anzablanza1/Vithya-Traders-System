# START HERE — continuing Purchase Intelligence V1.1 in a new chat

Read this page first, then `PROJECT_STATE.md`, `OWNER_REQUEST_REGISTER_V1_1.md` and the latest entries of `CHANGE_REGISTER_V1_1.md`.
This repository is the memory. Do not rely on any earlier chat.

## 1. Where things are

| What | Where |
|---|---|
| Branch | `purchase-v1.1-transition` (never `v2-development`, never edit `archive/`, never move tag `purchase-v1-v8.6`) |
| LIVE sheet ("po request live V1.1") | `1SuQsKP9JwE4DGk8RELGdqMpfQjquVhK_vWC6pmIcJfE` |
| LIVE Apps Script project | `1R3cGa6vgyOkdwF3qFsZ38Tmu48YXBe0qLnyg3ArmEM2TeGWSbfczRNT9` — staff deployment **version 6** = V1.1.4 |
| Old V1 (frozen) | old sheet + Apps Script deployment **version 36**; token changed, access owner-only; nothing talks to it |
| Old TEST copy (Phase 0–2 only) | sheet `1ojAFR5wv6tKt94CB0EwoEs14iCp7lPeRbnhBvjm6XX8`, script `1qpYtgC8qkJg9iPfFoqXTEebbdtdp4lMBP-sBYHFO9LfsT5Z62PBlL4Yv`; the self-tests run only here; its link no longer works with the new dashboard |
| Supabase | project `kssydapdfmkfufrqhwzp` — `sku_master`, `erp_snapshot` (Vasy prices; `data` is a JSON **string**), `purchase_bill_data` (register). Read-only from Apps Script with Script Property `VT_SB_KEY` |
| Dashboard | one HTML file `frontend/VT_Purchase_Intelligence_V1_1.html`, given to every PC; chip shows the version (e.g. "V1.1.4 · Vaigai") |

## 2. Apps Script files (LIVE project ↔ repo)

| LIVE file | Repo file | Notes |
|---|---|---|
| Code | `apps-script/Code.js` | request app + product sync switch (`V11_PRODUCTS_SB`) |
| LiveApi 7.2 | `apps-script/LiveApi 7.2.js` | all dashboard routes; `DEFAULT_TOKEN` is redacted in Git — real token lives in Script Property `VT_API_TOKEN` |
| goodscheckapi | `apps-script/goodscheckapi.js` | Goods Check for the request app |
| RegisterApi | `apps-script/RegisterApi.js` | register from the sheet (fallback to Supabase register) |
| ShipmentApi | `apps-script/ShipmentApi.js` | shipments, quantities, numbering, PO delete, self-test |
| BillApi | `apps-script/BillApi.js` | bills, stages, locking, self-test |
| ProductsApi | `apps-script/ProductsApi.js` | Products tab from Supabase, master fallback |
| ShipmentTools | `apps-script/ShipmentTools.js` | correct product, lot conversion + undo, speed check |

Script Properties (values never in Git): `VT_API_TOKEN`, `VT_SB_KEY`, `VT_PIN_SALT`, `VT_PIN_FOLLOW`, `VT_PIN_MGMT`, `V11_LOT_LOCK=on`, `V11_PRODUCTS_SB=on`, `V11_SEQ_*` counters, `V11_CONV_CODEFIX`.

## 3. How the owner works (must follow)

- Anu is a non-coder: plain English, numbered steps, **full copy-paste files** (never "change line 40").
- Plan before code for anything new or risky; small backward-compatible V1.1 changes only.
- Every request / bug gets an R-number in `OWNER_REQUEST_REGISTER_V1_1.md` (next free number is in that file).
- Deliver Apps Script files as `N_Name.gs.txt` + the dashboard HTML; say which files change and which stay.
- Release path: paste files → save → **trial deployment** (separate web-app deployment of the LIVE project, tested in a separate Chrome profile) → owner checks → update the **staff deployment to a new version** → give every PC the new dashboard file.
- Things that run on the sheet by hand (sync, conversion) are run from the Apps Script editor: pick the function → Run.
- **Git only after the owner confirms the change works in LIVE**: copy the exact delivered files into `purchase-intelligence-v1.1/`, update `CHANGE_REGISTER_V1_1.md` (requirement, files, data/API changes, compatibility, deployment version, tests, result, known issues, V2 learning) and the request register, commit, push.
- Never commit keys, tokens, PIN hashes. Never put the Supabase key in browser code.

## 4. How to test before delivering

`bash purchase-intelligence-v1.1/tests/run_all.sh` — fake workbook for the server, simulated browser for the dashboard, and a "press every button" audit. See `tests/README.md`. Add a test file for every new feature.

## 5. Current state (keep this short and current)

- LIVE: V1.1.4 · server 2.7 (deployment version 6).
- In progress: see the top of `PROJECT_STATE.md` → "Current next items".
- Proposal under discussion: `DASHBOARD_STRUCTURE_PROPOSAL.md` (R49).
