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
| V1.1-02b | Convert UNFINISHED V1 lots into V1.1 shipments after go-live (dry run first); decide on finished lots later | ⏳ owner to decide timing |
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

### <<LIVE_DATE>> — V1.1-01 · 02 · 03 · 04 · 04a · 05 (+ interim 06) — release "Vaigai"

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
- Rollback: redeploy the previous LIVE version (<<OLD_VERSION>>) and set `V11_LOT_LOCK` to `off`; the four new tabs can stay (V1 never reads them). Staff go back to the v8.6 file.

**Deployment** — LIVE Apps Script version <<NEW_VERSION>> ("V1.1 Vaigai — server 2.4"), previous <<OLD_VERSION>>. Server label in ping: `V1.1 "Vaigai" · server 2.4`. Dashboard file: `VT_Purchase_Intelligence_V1_1.html` (chip "V1.1 · Vaigai").

**Tests performed**
- Phase 0 (TEST copy): baseline row counts; Receipts diagnostic — 531 repeated rows, 146 rows for 16 in-transit lots, 292 PO lines over-stated; all 179 lot-less "L…" rows belong to deleted lots (Audit Log), no history exists only in Receipts.
- Automated, on the real TEST workbook: `v11SelfTest` 42/42, `v11BillSelfTest` 54/54 (multi-PO, edit without duplicates, numbering never reused, validation rejects, over-allocation warning, PO qty untouched, bill from 2 shipments, one shipment on 2 bills with recheck, MI refused before arrival / override recorded, lock rules, delete order, arrival = received, full reversal, all existing tabs unchanged).
- 04a before/after comparison: 0 shipped changes, 77 received and 46 in-transit corrections, closed POs dropped from Goods Check; owner verified PO-31072603 (lot deleted, PO should have been deleted) and VTPO-20260722-002 (closed).
- Speed: V1 lot save 4.4 s vs V1.1 shipment save 2.9 s on TEST.
- Dashboard: simulated-browser regression on every step + owner checks in a separate TEST Chrome profile (2.2 → 2.6b), old-lot lock checked with the old v8.6 file, staff trial on two PCs (feedback good).
- LIVE checks after deploy: <<LIVE_CHECKS>>

**Result** — <<RESULT>>

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
