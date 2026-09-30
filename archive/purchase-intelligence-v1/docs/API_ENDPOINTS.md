# API_ENDPOINTS.md — V1 (frozen)

All endpoints served by the ONE Apps Script web app (`/exec`), routed by `?api=` (GET) or `body.api`
(POST). Exec URL + token live client-side in `vt_live_cfg`; token also in Script Property `VT_API_TOKEN`.
Client helpers: `vtApiGet(api, extra)` (GET, JSON), `vtApiPost(body)` (POST, JSON). All writes also
queue into the durable `vt_outbox` and retry.

## GET (read) — via `vtApiGet`
| api | Params | Returns | Caller | Source | R/W |
|-----|--------|---------|--------|--------|-----|
| `ping` | token | `{ok, hasRegisterApi, …}` | boot / sbPull preflight | — | R |
| `data` | token | `{products(master), statuses, requests, tracking, receipts, suppliers, poMeta, lots, lotLines, security, closedLineIds}` | `liveSync` | PO-Request workbook tabs | R |
| `register` | offset, limit / `meta:1` / sinceId | `{ok, rows[], offset, count, done}` | `sbPull` (Supabase proxy) / RegisterApi (sheet) | Supabase `purchase_bill_data` **or** `Purchase_Register` tab | R |
| `suppliers` | token | supplier list | supplier refresh | Suppliers workbook | R |
| `requests` | token | requests | (as part of data) | PO Requests tab | R |
| `audit` | token, filters | audit rows | audit view | Audit Log tab | R |
| `archive` | token | archived ids | history | Archive tab | R |
| `security` | token | `{salt, followHash, mgmtHash}` | access control | Script Properties | R |

## POST (write) — via `vtApiPost`
| api | Body (key fields) | Effect | Caller | Target | R/W |
|-----|-------------------|--------|--------|--------|-----|
| `record` | rows[], setStatus, upsert, removePoNumbers[], resetLineIds[] | upsert PO Tracking rows; set status; remove POs; reset lines to Pending | PO create/edit/split/uncreate | PO Tracking | W |
| `meta` | poNumber, supplier, approvedAt, billAt, promised, snoozeUntil, notes[], closed/cancel/realNo fields | upsert PO Meta (incl. closed/cancel/approved/billed/promised/notes) | `_podPersist`/`liveMetaPush` | PO Meta | W |
| `lot` | lot{lotId,poNumber,lotNo,localNo,date,expected,lines[],charges,totals,…} | upsert a lot (+ lot lines); server assigns `lotNo` when `localNo` | ship/split/bill | Lots + Lot Lines | W |
| `lotDelete` | lotId, poNumber | delete a lot (+ its lines) | delete lot / delete PO | Lots + Lot Lines | W |
| `receive` | rows[], poNumber, poStatus | record received quantities; set PO status | goods received | Receipts (+ PO Tracking status) | W |
| `writeSheet` | sheet, rows(aoa) | overwrite a named tab | Fund/Analytics push | `Fund Planning`, `Analytics · SKU Summary`, `Analytics · SKU Supplier` | W |
| `audit` | entries[] | append audit rows | `changeLog`/`liveAudit` | Audit Log | W |
| `security` | salt/hashes | set access P*Hash | settings | Script Properties | W |

## PO-Request app (separate call channel: `google.script.run`, same project)
| Function | Returns/Effect | Caller | Source | R/W |
|----------|----------------|--------|--------|-----|
| `getProducts()` | product master rows | app boot | Products tab | R |
| `getStatuses()` | status list | app | Statuses tab | R |
| `getSubmissions()` | submitted requests | Submissions tab | PO Requests | R |
| `submitRequest(...)` / draft fns | write a request/draft | New request | PO Requests / Drafts | W |
| `getGoodsCheck()` | open-PO status (qty + 4 dates, **no supplier/rate**) | Goods check tab | PO Tracking + Receipts + Lots + PO Meta | R |

## Notes
- Register pull is **paged** (limit ~1000) in a loop until `done`. Supabase key never leaves the server.
- `record` with `removePoNumbers` + empty rows is how "uncreate"/delete propagate.
- **NEEDS LIVE VERIFICATION:** exact response envelopes and any additional params drift; verify against
  the deployed `/exec` before relying on field names in new code.
