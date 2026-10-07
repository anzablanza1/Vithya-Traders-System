# VT Purchase Intelligence — CHANGE REGISTER · V1.1

> V1 is frozen. V1.1 is the transitional live-maintenance release.
> Clean V2 continues separately and may use a different implementation.

Owner: Anu / build-side AI
Status: ✅ Done · 🔧 In progress · ⏳ Pending · 🧊 Deferred · ❌ Dropped

---

## V1.1 goal

Fix the V1 limitation that assumes one Lot belongs to one PO.

The required live behaviour is:

- one physical Shipment may contain quantities from multiple POs;
- one PO may be fulfilled by multiple Shipments;
- Shipment entry is product-first;
- FIFO oldest-open-PO-first is a suggestion only;
- allocations are manually editable;
- Excess and Off-PO remain distinct;
- Shipment creation means In Transit, not Received;
- Bill is separate from Shipment;
- one Bill may draw from multiple Shipments and one Shipment may be split across Bills where required;
- Bill may be prepared before physical arrival;
- Goods Check / Receipt remains a separate arrival-verification step;
- Shipment Qty, Bill Qty and Receipt Qty remain independent;
- Accepted = Received - Rejected;
- existing W/WO, GST, charges, round-off, Vasy mapping and upload behaviour must continue unless explicitly changed.

## Important V1.1 implementation rule

The behaviours above are the target.

The **implementation does not have to reproduce the clean V2 architecture** if doing so would create unnecessary risk inside the existing V1 codebase.

V1.1 should use the smallest backward-compatible changes that safely deliver the behaviour.

Any V1.1 technical shortcut must be documented so future V2 work can distinguish:
- validated business behaviour;
- temporary V1.1 implementation compromise.

---

## V1.1 build plan

| ID | Work item | Status |
|---|---|---|
| V1.1-00 | Freeze V1 and create V1.1 branch/source/docs | ✅ Done |
| V1.1-01 | Data structures + server support for multi-PO Shipment allocations; preserve V1 compatibility | ✅ Done (Vaigai) |
| V1.1-02 | Backward compatibility / mapping for existing V1 Lots | ✅ Done (read-time mapping) |
| V1.1-02b | Convert V1 lots into V1.1 shipments (owner: all lots) — dry run, apply, undo | ✅ Tool LIVE (R09/R44, V1.1.2–V1.1.3) |
| V1.1-03 | Shipment Entry: product-first, FIFO suggestion, editable PO allocation, Excess/Off-PO | ✅ Done (Vaigai) |
| V1.1-04 | Derive Ordered / In Transit / Received / Pending without breaking current views | ✅ Done (Vaigai) — incl. 04a received-qty fix |
| V1.1-05 | Bill / Material Inward separated from Shipment while preserving W/WO/Vasy logic | ✅ Done (Vaigai) |
| V1.1-06 | Goods Check / Receipt separation and exception handling | 🔧 Interim only: "Mark shipment arrived" (all received + accepted). Line-level receipt / rejection pending |
| V1.1-07 | Vasy validation/generation from the V1.1 Bill workflow | ⏳ |
| V1.1-08 | Central operational exceptions where practical in V1.1 | ⏳ |
| V1.1-09 | User-facing Lot → Shipment terminology where safe | ⏳ |

## Sequencing

Default order:

`V1.1-01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09`

**Recorded change of sequence (owner-approved, Oct 2026):** 01, 02, 03, 04 (+04a) and 05 were built and tested together in a separate TEST workbook and released to LIVE as ONE combined release ("Vaigai"), because releasing Shipment Entry without Bills would have left staff unable to bill multi-PO shipments. A minimal interim of 06 ("Mark arrived") was included so new shipments do not stay In Transit forever.

The old Purchase Dashboard chat may recommend combining or simplifying steps if that is safer in the existing V1 architecture. Any such change must be recorded here before implementation.

---

## V1.1 change log

For every live change add:

### YYYY-MM-DD — V1.1-x
- Requirement:
- Files changed:
- Data/Sheet/API changes:
- Backward-compatibility impact:
- Deployment version / deployment ID reference:
- Tests performed:
- Result:
- Known issues:
- V2 learning / reference value:

No production change is complete until this log is updated.

---

### 2026-10 (go-live on the new LIVE copy) — V1.1-01 · 02 · 03 · 04 · 04a · 05 (+ interim 06) — release "Vaigai"

**Requirement**
- 01: store one physical shipment carrying several POs; Excess and Off-PO kept separate; every new shipment saved as In Transit.
- 02: existing V1 lots must keep working and keep being counted — no copying, no double counting.
- 03: Shipment Entry — supplier, then products; oldest-open-PO-first suggestion (w before wo); every number editable; "add a whole PO" with pending qty filled in; Ship lot from a PO (all pending or only ticked lines) opens the same entry; Excess (over pending, linked to a PO) and Off-PO (on no open PO); transport / LR optional; UOM per product; PO ordered qty never changed.
- 04: Ordered / In Transit / Received / Pending everywhere count V1 lots + V1.1 shipments; Excess counts as shipped / in transit (owner decision D1) but never reduces pending.
- 04a: Goods Check and request-app progress must stop reading the Receipts tab for "received".
- 05: Bill separated from Shipment — shipments are ASSIGNED to bills (many → one, one → many); w/wo qty + rate, GST %, MRP / selling per lane, charges with GST %, round-off per lane; stages Draft → Ready → MI uploaded (Vasy MI no. w / wo) → Billed (Vasy bill no. w / wo); "Download for Supplier Bill" on the bill and "Download for Material Inward" on the arrived shipment, same 18-column Vasy file, charges never in the file (listed for manual entry in Vasy); bill qty independent of shipment qty with a "recheck" flag.
- 06 (interim): "Mark shipment arrived" = everything received and accepted; reversible until an MI number is recorded.
- Delete rules (owner): PO ← Shipment ← Bill, one direction only. A PO with a shipment cannot be deleted / cancelled / split. A shipment on any bill cannot be deleted / cancelled / have a billed product removed — unassign it first (unassigning never deletes the shipment). A bill can be deleted only when empty. Any MI / Vasy number locks the bill until cleared (audited).

**Files changed** (`purchase-intelligence-v1.1/`)
- `apps-script/ShipmentApi.js` — NEW. Shipments + Shipment Allocations tabs, save / delete / arrive, validation, read-time V1-lot mapping (`shpLegacyAllocs_`), combined quantities (`shpQtyByPoCode_`), shipment dates for Goods Check, permanent number counter (`v11NextNo_`), server PO delete (`apiPoDelete_`), old-lot lock switch (`v11LotLocked_`), self-test `v11SelfTest` (TEST workbook only).
- `apps-script/BillApi.js` — NEW. Bills + Bill Lines tabs, save / stage / unassign / delete, locking, recheck warnings, self-test `v11BillSelfTest` (TEST workbook only).
- `apps-script/LiveApi 7.2.js` — additive: routes `shipment`, `shipmentDelete`, `shipmentArrive`, `bill`, `billStage`, `billUnassign`, `billDelete`, `poDelete`, `v11data`; `ping` returns `v11`; `data` also returns `shipments`, `shipAllocs`, `bills`, `billLines`; `apiLot_` refuses NEW lots when `V11_LOT_LOCK=on`; `apiRecord_` refuses removing / splitting a PO carried by a shipment. Nothing removed.
- `apps-script/goodscheckapi.js` — received / shipped from `shpQtyByPoCode_`; in-transit from TRUE received (uncapped); closed POs (and split children of closed parents) hidden; ship / expected / arrival dates merged from V1.1 shipments. Falls back to V1 behaviour if ShipmentApi is missing.
- `apps-script/Code.js` — `getLineProgress()` received / shipped from `shpQtyByPoCode_`; V1 fallback kept. Nothing else changed.
- `frontend/VT_Purchase_Intelligence_V1_1.html` — version chip "V1.1 · Vaigai"; new **Shipments** tab (🚚 Shipments / 🧾 Bills views), Shipment Entry, Bill screen, Material Inward screen; V1.1 shipments shown read-only on their POs; PO delete / cancel / split protection; PO delete now also deletes on the server; old "Ship lot" opens a V1.1 shipment; whole-PO virtual lot switched off; one-save-at-a-time overlay; fast V1.1-only refresh after saves.
- Unchanged: `RegisterApi.js`, `Untitled.js`, `appsscript.json`, `PORequest_index_V1_1.html`, everything under `archive/`.

**Data / Sheet / API changes** — see `docs/DATA_MODEL_V1_1.md`
- New tabs in "po request live": `Shipments` (14 cols), `Shipment Allocations` (13 cols), `Bills` (25 cols), `Bill Lines` (21 cols).
- New Script Properties: `V11_LOT_LOCK` (= `on` in LIVE after go-live), `V11_SEQ_SH-YYYYMMDD-` / `V11_SEQ_BL-YYYYMMDD-` (number counters, written automatically).
- Audit Log gains actions SHIPMENT_UPSERT / DELETE / ARRIVED / ARRIVAL_REVERSED, BILL_UPSERT / STAGE / UNASSIGN / DELETE, PO_DELETE.
- PO Tracking: a dashboard PO delete now removes that PO's rows (and its PO Meta row) on the server — before, deleted POs came back on the next sync.
- No change to existing tab columns, Supabase, Hostinger, cron, register pull.

**Backward-compatibility impact**
- Existing V1 lots: still open / split / upload / receive exactly as before; counted through read-time mapping. Creating NEW V1 lots is switched off (dashboard + server lock).
- Older dashboard files on staff PCs: still sync and read; any attempt to create a new lot is refused by the server with a "use the new dashboard file" message. Edits to existing lots still work.
- Goods Check / request app: numbers change deliberately — goods still on the road now show as In Transit (not Received), deleted lots no longer count, closed POs are hidden.
- Rollback: redeploy the previous LIVE version (V1 version 36 on the old sheet) and set `V11_LOT_LOCK` to `off`; the four new tabs can stay (V1 never reads them). Staff go back to the v8.6 file.

**Deployment** — LIVE Apps Script version — first deployment of the new LIVE project ("V1.1 Vaigai — server 2.4"); previous: V1 deployment **version 36** on the old sheet (frozen — token changed, access owner-only). Server label in ping: `V1.1 "Vaigai" · server 2.4`. Dashboard file: `VT_Purchase_Intelligence_V1_1.html` (chip "V1.1 · Vaigai").

**Tests performed**
- Phase 0 (TEST copy): baseline row counts; Receipts diagnostic — 531 repeated rows, 146 rows for 16 in-transit lots, 292 PO lines over-stated; all 179 lot-less "L…" rows belong to deleted lots (Audit Log), no history exists only in Receipts.
- Automated, on the real TEST workbook: `v11SelfTest` 42/42, `v11BillSelfTest` 54/54 (multi-PO, edit without duplicates, numbering never reused, validation rejects, over-allocation warning, PO qty untouched, bill from 2 shipments, one shipment on 2 bills with recheck, MI refused before arrival / override recorded, lock rules, delete order, arrival = received, full reversal, all existing tabs unchanged).
- 04a before/after comparison: 0 shipped changes, 77 received and 46 in-transit corrections, closed POs dropped from Goods Check; owner verified PO-31072603 (lot deleted, PO should have been deleted) and VTPO-20260722-002 (closed).
- Speed: V1 lot save 4.4 s vs V1.1 shipment save 2.9 s on TEST.
- Dashboard: simulated-browser regression on every step + owner checks in a separate TEST Chrome profile (2.2 → 2.6b), old-lot lock checked with the old v8.6 file, staff trial on two PCs (feedback good).
- LIVE checks after deploy: go-live on a new copy of the live sheet (LIVE sheet `1SuQsKP9JwE4DGk8RELGdqMpfQjquVhK_vWC6pmIcJfE`, Apps Script `1R3cGa6vgyOkdwF3qFsZ38Tmu48YXBe0qLnyg3ArmEM2TeGWSbfczRNT9`); owner confirmed all connections working; old V1 frozen.

**Result** — LIVE and in daily use (owner, Oct 2026).

**Known issues / follow-ups**
- V1.1-06 is interim: "arrived" = all received and accepted; no partial receipt / rejection yet.
- The main PO dashboard still uses the V1 "capped received" rule for OLD lots (an over-shipped, received old lot can show the extra as in transit); Goods Check is correct.
- Receipts tab is still written by the old lot-receive flow and still contains repeated rows; it is no longer read for quantities. Not cleaned (history).
- V1 lot numbering gaps / "*" provisional numbers remain on old lots; V1.1 numbers are server-assigned and never reused.
- PO-31072603 in LIVE still needs to be deleted by the team (its lot was deleted, the PO was not).
- `apiRegister_` is defined in both LiveApi and RegisterApi (pre-existing); `Untitled.js` → `whereAmI()` references a missing `API_TOKEN` (pre-existing, harmless unless run).
- Dashboard is still a file on each PC; an old file can still be opened (server lock protects the data).
- V1.1-02b (convert unfinished lots) pending owner decision.

**V2 learning / reference value**
- The validated chain is PO ← Shipment ← Bill with one-direction deletes and Vasy-number locking; model shipment allocations as (shipment, PO, product, type PO|EXCESS|OFFPO) rows.
- Never derive "received" from an append-only receive log that is rewritten on every save; derive from the receipt event itself.
- Numbers must come from the server at save time from a permanent counter, never from the client.
- Separate w / wo MRP and selling per bill line; charges belong to the bill but not to the Vasy item file.
- "Whole PO with pending qty" is the dominant entry pattern; product-first search is the exception path.

---

### 2026-10-06 — V1.1.1 (server 2.5) — R23 (part) · R24 · R29 · R30 · R33 · R35 · R36 (part) · R38 · R39 (static)

**Requirement** — owner request list after go-live (numbers in `OWNER_REQUEST_REGISTER_V1_1.md`): multi-select products from a PO (R24); w/wo auto-split on bills (R29); charge dropdown + typing (R30); Supabase register pull broken (R33, old V1 bug); PO-builder unit stuck on "nos" (R35, old V1 bug); search unreliable (R36, old V1 bug); colour contrast in the Shipments module (R38); faster saves (R23); check all buttons (R39).

**Files changed** — `apps-script/LiveApi 7.2.js` (register function renamed `apiRegisterSb_`, `register` route chooses Supabase or sheet by its parameters, V1.1 write replies carry the fresh V1.1 data `v11data`), `apps-script/ShipmentApi.js` (version label 2.5), `frontend/VT_Purchase_Intelligence_V1_1.html` (chip "V1.1.1 · Vaigai").

**Data / Sheet / API changes** — none to tabs. API: every V1.1 write reply now includes `v11data` (additive).

**Backward-compatibility impact** — older dashboard files ignore `v11data` and still refresh the old way.

**Deployment** — an intermediate LIVE deployment version (versions 2–5 were used for V1.1.1–V1.1.3 and the trial; exact mapping not recorded); ping label `V1.1 "Vaigai" · server 2.5`.

**Tests performed** — self-tests 42/42 + 54/54; simulated-browser checks for R24 / R29 / R30 / R35 / R36; static handler check (332 handlers, none missing). Owner checked in LIVE: all working except R36 (two search examples).

**Result** — LIVE, working (owner, Oct 2026). R36 reopened → V1.1.2.

**Known issues** — R36 word-joined searches (fixed in V1.1.2).

**V2 learning** — one function name per project: Apps Script silently keeps the LAST definition of a duplicated name.

---

### 2026-10-06 — V1.1.2 (server 2.6) — R09 · R23 · R34 · R36 · R37 · R39 · R42

**Requirement**
- R36: "r3h" must find "R3 H2 IMP&DIFF N 86 OD AP"; "brf10npp" must find "BRF 10N … PP" / "BRF 10 N … PP".
- R34: products from Supabase (`sku_master` + Vasy `erp_snapshot`), master sheet as fallback, cached in the Products tab. Owner decisions: MRP = selling in Vasy; Vasy "w" prices are GST-inclusive, so the upload file carries MRP and selling **incl GST, as they are** (cost is still grossed up); every price labelled **incl GST / excl GST** like w / wo; cost comes from the purchase register.
- R37: correct a wrong product after it has shipped — **only from PO edit**, with a clear warning.
- R09: convert all old lots into V1.1 shipments (owner: proceed).
- R23: faster saves. R39: full button behaviour audit.

**Files changed** (`purchase-intelligence-v1.1/`)
- `apps-script/ProductsApi.js` — NEW. `syncProductsV11_()`: Supabase (read-only, key from `VT_SB_KEY`) + master sheet → Products tab; writes "V1.1 Product Sync Report". If Supabase cannot be read, the old master-only sync runs.
- `apps-script/ShipmentTools.js` — NEW. `apiShipmentRecode_` (R37), `v11LotConvertDryRun` / `v11LotConvertApply` / `v11LotUnconvert` (R09), `v11SpeedCheck` (R23).
- `apps-script/Code.js` — `syncProducts()` uses ProductsApi only when Script Property `V11_PRODUCTS_SB` = `on`, else the old master-only sync (`syncProductsMasterOnly_`, logic unchanged, split out as `readMasterByCanon_`); `getProducts()` also returns `gstSp`, `nonSp`, `unit`, `gstPct`, `source` and copes with an 11-column tab; request-app lot list skips converted lots and lists V1.1 shipment numbers (R42).
- `apps-script/ShipmentApi.js` — version 2.6; allocation column N "Returned" (received = qty − returned); allocations replaced in one block write (no row-by-row deletes); returns kept when a shipment is edited; helper `v11ReplaceRows_`.
- `apps-script/BillApi.js` — bill lines replaced / unassigned in one block write.
- `apps-script/LiveApi 7.2.js` — `lotConvSet_()`; `readLots_` / `readLotLines_` hide converted lots; `apiLot_` / `apiLotDelete_` refuse a converted lot; route `shipmentRecode`.
- `apps-script/goodscheckapi.js` — skips converted lots (their numbers come from the shipments).
- `frontend/VT_Purchase_Intelligence_V1_1.html` — chip "V1.1.2 · Vaigai"; word-chain search (`sChain`); incl / excl GST tags (`GT()`) on PO builder, PO edit, bill, material inward, split and rate history; selling written to the file as typed (`spUploadRate`); Vasy MRP / selling preferred when the product has them; GST % default from the product; bill rate default = PO price → register last cost → master; "⚠ correct product" in PO edit (`poFixOpen` / `poFixApply`); returns shown on converted shipments; theme button crash fixed (R39).

**Data / Sheet / API changes**
- Products tab: + L GST Selling · M NonGST Selling · N Unit · O GST % · P Source (Supabase / Supabase+Master / Master). MRP and Selling = incl GST; Price = cost excl GST.
- Shipment Allocations: + N Returned. Lots: + U Converted To (shipment ID; only after conversion).
- New tabs (reports, rewritten each run): "V1.1 Product Sync Report", "V1.1 Conversion Report", "V1.1 Speed Check".
- Settings tab: A7 "Product source".
- New Script Property `V11_PRODUCTS_SB` (`on` = Supabase product sync; off / missing = old master-only sync).
- API: `shipmentRecode` (additive). Audit actions: PRODUCT_CORRECT, LOT_CONVERT, LOT_UNCONVERT.
- Supabase: read only, no schema change.

**Backward-compatibility impact**
- Upload files: GST-code selling price is no longer grossed up (owner decision — Vasy w prices are tax-inclusive). Cost / rate still grossed up as before.
- Until `V11_PRODUCTS_SB` = `on` (or without ProductsApi.gs), product sync behaves exactly as before. Without ShipmentTools.gs, nothing else changes.
- Lot conversion is opt-in (run by hand), reversible (`v11LotUnconvert`), and old lot rows are never deleted. Shipped / received per PO line stay identical, except products that were NOT on the PO (now EXCESS — shipped & received unchanged, no longer "shipped against the PO").
- Rollback: redeploy V1.1.1 (the deployment version before V1.1.2), run `v11LotUnconvert` if conversion was applied, set `V11_PRODUCTS_SB` to `off` and run "Sync products now".

**Deployment** — an intermediate LIVE deployment version (between 2 and 5); ping `V1.1 "Vaigai" · server 2.6`.

**Tests performed**
- Server (mock workbook): self-tests 42/42 + 54/54 with the block-write change; product sync (Supabase + master + fallback when Supabase is down); conversion dry run / apply / second apply (nothing twice) / undo (numbers identical to before) / undo refused after a later edit; product correction refused on a locked bill, applied when unlocked; Goods Check + request progress run.
- Dashboard (simulated browser): owner's search examples; earlier regression (R24 / R29 / R30 / R35); incl / excl GST labels and file values (cost 100 @ 12 % → 112, selling 58.10 written as is); correct-product flow (refused without CORRECT; PO line, old lot and shipment follow; shipped qty unchanged); delete buttons call the right server action; **906 buttons pressed across 22 screens / windows / views — 0 errors** after the theme fix.
- LIVE checks: owner tested every change in LIVE; product sync run (8,282 products); conversion DRY RUN run and reviewed (not applied yet).

**Result** — LIVE, all changes working (owner, 6 Oct 2026). Product sync and conversion dry run reviewed → V1.1.3.

**Known issues**
- R41: product charge insight still reads old lots only (V1.1 bill charges not counted; converted lots drop out of it).
- Vasy `sellingPrice` = MRP − Vasy discount; when the register has no newer actual, that is the selling default.
- Lots that exist only on one PC (never synced) are not converted — sync every PC first.
- Converted bills carry "V1" / "V1:<Vasy bill>" markers instead of real MI numbers (V1 never stored them).

**V2 learning**
- Product master: canonical SKU + w / wo item codes from Supabase; prices from the live ERP snapshot; keep explicit tax-inclusive / exclusive flags on every price field.
- Corrections of identity (product) must cascade PO line → shipment allocation → bill line in one audited server call.
- Migrations: dry run with a before/after numbers check, opt-in apply, marker column instead of deletes, and an undo that refuses records edited after migration.

---

### 2026-10-07 — V1.1.3 (server 2.7) — R43 · R44 · R45 · R46 (+ R09 dry-run review)

**Requirement**
- Owner: V1.1.2 working in LIVE (all changes). Product sync and conversion dry run reviewed with the LIVE export.
- R43: Supabase is the truth, master sheet only a fallback (master data known to be wrong; real master comes in V2). MRP and selling in separate columns. No blank / 0 MRP must reach the upload file.
- R44: the dry run listed 16 PO lines whose numbers would change — all were the same PO line under two codes (temporary / name code on one side, real code on the other).
- R45: serial numbers on shipment product lines. R46: Vasy MI number recordable from the bill as well, status "MI uploaded".

**Files changed** — `apps-script/ProductsApi.js` (0 counts as missing → master fallback, both lanes; new report counts), `apps-script/ShipmentTools.js` (code-mismatch handling, PO Tracking code correction + undo, report section), `apps-script/ShipmentApi.js` (version 2.7), `frontend/VT_Purchase_Intelligence_V1_1.html` (chip "V1.1.3 · Vaigai", serial badges, MI boxes on the bill).

**Data / Sheet / API changes** — PO Tracking: column E (and F name) corrected for the PO lines listed in the conversion report, only when the lot carried the real product. New Script Property `V11_CONV_CODEFIX` (record of those corrections, used by the undo). Audit action PO_CODE_FIX. No API change.

**Backward-compatibility impact** — none for staff; the corrections make Goods Check and the request app count those lines correctly (they showed 0 shipped under the temporary code).

**Deployment** — LIVE deployment version 5 or 6 (server 2.7 is unchanged in version 6); ping `V1.1 "Vaigai" · server 2.7`.

**Tests performed** — LIVE export reviewed: sync 8,282 products (6,747 both, 1,532 Supabase only, 3 master only; 7,202 with Vasy prices); conversion dry run 88 lots / 13 skipped (10 lots of deleted POs, 3 empty lots) / 85 bills (43 locked) / 16 code mismatches mapped one by one. Mock workbook: mismatch converted under the real code, PO Tracking corrected, undo restores both; self-tests 42/42 + 54/54; dashboard: serial badges, MI from the bill → "MI uploaded"; 907 buttons pressed, 0 errors.
- LIVE checks: owner confirmed every change working in LIVE (7 Oct 2026): serial numbers, MI number from the bill, product sync with master fallback; second conversion dry run showed 0 changed numbers.

**Result** — LIVE, working (owner, 7 Oct 2026).

**Known issues** — Vasy's `sellingPrice` is MRP minus the Vasy discount (e.g. IMP60KC MRP 103.61 / selling 86.00), so selling ≠ MRP for most products; the file carries Vasy's selling. 10 lots of deleted POs stay as old lots (nothing to attach them to). PO-17092603 line 4: SLV202723S (PO) vs SLV202723SN (lot) are both real products — the lot's SLV202723SN is kept; owner to confirm.

**V2 learning** — product identity must be fixed at PO creation (no temporary codes), or every downstream record needs a re-key.

---

### 2026-10-07 — V1.1.4 (dashboard file only) — R47

**Requirement** — R47: on the bill, typing a w / wo quantity allowed only one digit — the box was redrawn (and re-selected) as soon as a side went from empty to filled, so the second digit replaced the first.

**Files changed** — `frontend/VT_Purchase_Intelligence_V1_1.html` only (chip "V1.1.4 · Vaigai"): `v11BillSet` no longer redraws during typing; new `v11BillQtyDone` redraws on leaving the box when a side was added or emptied (to show / hide its MRP & selling boxes).

**Data / Sheet / API changes** — none. **Backward-compatibility impact** — none; server stays 2.7.

**Deployment** — LIVE staff deployment **version 6** (owner, 7 Oct 2026) with dashboard chip "V1.1.4 · Vaigai".

**Tests performed** — simulated typing "4" then "40" in the wo box: same box kept, other side filled, redraw only on leaving the box, value kept; earlier dashboard regressions; 907 buttons pressed, 0 errors. Owner also confirmed the V1.1.3 dry run: 16 code mismatches understood (auto-code → Vasy code), 0 numbers change.
- LIVE checks: owner confirmed everything working in LIVE (7 Oct 2026), including two-digit w / wo quantities on the bill.

**Result** — LIVE, working (owner, 7 Oct 2026).

