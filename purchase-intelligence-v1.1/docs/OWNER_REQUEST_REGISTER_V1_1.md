# Purchase Intelligence V1.1 — Owner Request & Bug Register

Every change or bug the owner has raised, with a fixed number. Refer to items by number (e.g. "R24").
Numbers are never reused. New items are added at the bottom.

Status: ✅ LIVE · 🧪 Built, in TEST (next release) · 📝 Planned · ⏳ Owner action / decision · 🧊 Deferred

Releases: **Vaigai** = V1.1 server 2.4, live Oct 2026 · **V1.1.1** = server 2.5, live Oct 2026 · **V1.1.2** = server 2.6 + ProductsApi + ShipmentTools, live Oct 2026 · **V1.1.3** = server 2.7 · **V1.1.4** = dashboard file only — all live Oct 2026 (staff deployment version 6) · **V1.1.5** + **V1.1.6** = staff deployment version 7 (13 Oct 2026) · **V1.1.7** = restructure phase 1 · **V1.1.8 / 8b** = phase 3 · **V1.1.9 + server 2.8** = phases 2 + 4 (all in test)

| No. | Area | What was raised | Type | Status | Notes |
|---|---|---|---|---|---|
| R01 | Goods Check / request app | Receipts tab overstates "received" (rows repeated on every lot save; shipped logged as received) | Old V1 bug | ✅ LIVE (Vaigai) | Received now comes from lots marked received + arrived shipments. Receipts tab no longer read |
| R02 | Goods Check | Closed POs still listed | Old V1 bug | ✅ LIVE (Vaigai) | Also hides split children of a closed parent |
| R03 | Goods Check | Over-shipped goods that arrived still shown as "in transit" | Old V1 bug | ✅ LIVE (Vaigai) | Main PO dashboard still uses the old rule for OLD lots — fixed when lots are converted (R09) |
| R04 | Data | PO-31072603: lot deleted but PO not | Team action | ⏳ Team | Delete the PO completely in the dashboard |
| R05 | PO delete | Deleted PO came back on next sync (PO Tracking rows never removed) | Old V1 bug | ✅ LIVE (Vaigai) | Delete now removes the PO on the server too |
| R06 | Shipments | Shipment number reused after a delete | V1.1 bug | ✅ LIVE (Vaigai) | Permanent per-day counter |
| R07 | Shipments | Sheet Status stayed "In Transit" after arrival | V1.1 bug | ✅ LIVE (Vaigai) | Status = Arrived / In Transit |
| R08 | Old lots | Lot numbers not sequential, "*" provisional numbers | Old V1 bug | 🧊 Deferred | Not patched in V1 code; V1.1 numbers are server-assigned. Disappears with R09 |
| R09 | Old lots | Convert all lots into shipments | Change | ✅ LIVE (V1.1.3) | Owner: proceed. Run from Apps Script: `v11LotConvertDryRun` → check the "V1.1 Conversion Report" tab → `v11LotConvertApply`. Undo: `v11LotUnconvert`. Old lot rows are kept (column U "Converted To") |
| R10 | Shipment entry | Two quantity boxes were confusing | V1.1 UX | ✅ LIVE (Vaigai) | One "Qty shipped" box; PO split folded underneath |
| R11 | Shipment entry | Editing the split should also change the shipped qty | V1.1 UX | ✅ LIVE (Vaigai) | |
| R12 | Shipment entry | Show other suppliers' pending POs for the same product | Change | ✅ LIVE (Vaigai) | Shown, never auto-filled |
| R13 | Shipment entry | Search when adding a product | Change | ✅ LIVE (Vaigai) | |
| R14 | Shipment entry | New product auto-filled full qty and always said "fully allocated" | V1.1 bug | ✅ LIVE (Vaigai) | Starts empty; label shows where qty went |
| R15 | Shipment entry | Product list mixed own and other suppliers | V1.1 UX | ✅ LIVE (Vaigai) | Two separate boxes |
| R16 | Shipment entry | Product name + pending prominent, item code small | V1.1 UX | ✅ LIVE (Vaigai) | |
| R17 | PO detail | SH number on a PO not clickable | V1.1 UX | ✅ LIVE (Vaigai) | Opens the shipment |
| R18 | Shipments | PO numbers in shipment list / form clickable | Change | ✅ LIVE (Vaigai) | |
| R19 | Shipment entry | Add a whole PO with pending qty filled in | Change | ✅ LIVE (Vaigai) | Replaced by R24 picker |
| R20 | PO detail | Ship lot with ticked products did not add them | V1.1 bug | ✅ LIVE (Vaigai) | Form had opened behind the PO window; split-PO selection fixed |
| R21 | Shipment entry | Change UOM per product | Change | ✅ LIVE (Vaigai) | Saved and used in the upload file |
| R22 | All V1.1 saves | Double save / double delete during the ~2 s wait | V1.1 bug | ✅ LIVE (Vaigai) | "Saving…" overlay, one save at a time |
| R23 | All V1.1 saves | Save + refresh takes ~5 s | Performance | ✅ LIVE (V1.1.2) | V1.1.1: one round trip. V1.1.2: shipment / bill lines rewritten in one block instead of one row-delete per line. `v11SpeedCheck` times every tab |
| R24 | Shipment entry | Pick a PO → list its pending products → tick several → add | Change | ✅ LIVE (V1.1.1) | Filter box, tick all / clear, already-added items greyed |
| R25 | Bills | "Billed" shown when the bill was only ready | V1.1 bug | ✅ LIVE (Vaigai) | Billed only when every side has a Vasy bill number |
| R26 | Bills / Shipments | Show bill numbers on shipments and shipment numbers on bills | Change | ✅ LIVE (Vaigai) | Clickable both ways |
| R27 | Bills | Bill status chip looked empty | V1.1 bug | ✅ LIVE (Vaigai) | Colour fixed |
| R28 | Bills / upload | MRP and selling price not filled | V1.1 bug | ✅ LIVE (Vaigai) | Register → master → PO line; separate w / wo |
| R29 | Bills | w / wo split: typing one side fills the other (like old lots) | Change | ✅ LIVE (V1.1.1) | Line total kept; overtyping raises it (recheck flag shows) |
| R30 | Bills | Charges: standard dropdown + free typing | Change | ✅ LIVE (V1.1.1) | Freight, Transport, Packing & Forwarding, Loading/Unloading, Hamali, Courier, Insurance, Handling, Door delivery, Cartage, Octroi, Other |
| R31 | Rules | Delete chain PO ← Shipment ← Bill; unassign before delete; Vasy numbers lock | Decision | ✅ LIVE (Vaigai) | |
| R32 | Bills / MI | Two download points (MI after arrival + override; Supplier Bill), Vasy MI and bill numbers per w / wo | Decision | ✅ LIVE (Vaigai) | |
| R33 | Register | Supabase register pull not working | Old V1 bug | ✅ LIVE (V1.1.1) | Two server functions had the same name (Supabase + Sheet); the one loaded last won. Renamed and routed |
| R34 | Products | Product data from Supabase, master sheet as fallback, cached in the sheet | Change | ✅ LIVE (V1.1.2) | Owner: MRP = selling in Vasy; Vasy w prices are GST-inclusive → file carries MRP / selling incl GST as they are (cost still grossed up). Every price labelled incl GST / excl GST. Cost from the purchase register (master only as fallback). Products tab +5 columns; "V1.1 Product Sync Report" tab |
| R35 | PO builder | Unit at the top always showed "nos" | Old V1 bug | ✅ LIVE (V1.1.1) | Duplicate selector removed; each cart line now has its own unit selector; exports use it |
| R36 | PO builder | Product search works only sometimes | Old V1 bug | ✅ LIVE (V1.1.2) | V1.1.1 fixed the index rebuild. Reopened: "r3h" did not find R3 H2…, "brf10npp" did not find BRF 10N … PP. V1.1.2: typed letters without spaces are matched against the start of consecutive words |
| R37 | PO / Shipments | Change a wrong product even after it is shipped (emergency, with warning) | Change | ✅ LIVE (V1.1.2) | Owner: only in PO edit. "⚠ correct product" on a shipped line → pick the right product → list of affected lots / shipments / bills → type CORRECT. Refused if a bill is locked. Audited |
| R38 | Shipments | Module all one colour, no contrast | V1.1 UX | ✅ LIVE (V1.1.1) | Coloured headers (teal shipments, amber bills, blue MI), coloured state stripes per product, zebra rows |
| R39 | Whole dashboard | Check every button actually works | Audit | ✅ LIVE (V1.1.2) | Behaviour audit: 906 buttons pressed across 22 screens / windows / views with sample data — 1 old bug found and fixed (🌙 theme button crashed in PO Tracking mode). All delete buttons call the right server action |
| R40 | Release | V1.1 runs on a new copy of the live sheet; old V1 frozen (token changed, access = owner only) | Decision | ✅ LIVE | LIVE sheet `1SuQsKP9JwE4DGk8RELGdqMpfQjquVhK_vWC6pmIcJfE`, Apps Script `1R3cGa6vgyOkdwF3qFsZ38Tmu48YXBe0qLnyg3ArmEM2TeGWSbfczRNT9` |
| R41 | Product page | Charge insight (per-unit freight) reads old lots only — V1.1 bill charges (and converted lots) are not counted | Found in R09 work | 📝 Planned | Read charges from V1.1 bills too |
| R42 | Request app | Lot list on a request line did not show V1.1 shipment numbers | Found in R09 work | ✅ LIVE (V1.1.2) | SH numbers now listed with the old lots |
| R43 | Products | Supabase is the truth, master only a fallback; MRP and selling in separate columns; a Vasy MRP of 0 must not block the upload | Decision | ✅ LIVE (V1.1.3) | A 0 / blank Vasy MRP or selling now counts as missing → master MRP fills it. Report shows how many were filled from the master and how many Vasy selling ≠ MRP |
| R44 | Lot conversion | Dry run: 16 PO lines whose lot code ≠ PO code (temporary codes like impellerk60cri vs real IMP60KC) | Found in R09 dry run | ✅ LIVE (V1.1.3) | Matched by PO line position; the real product (in Products) is kept and PO Tracking is corrected; listed in the report; undone by v11LotUnconvert. Owner: mismatches come from auto-codes for new products later replaced by the Vasy code — expected. PO-17092603 line 4 (SLV202723S vs SLV202723SN, same sleeve, different make): register shows Gajanand billing SLV202723SN since Feb 2026 → SN kept. Second dry run (V1.1.3): 0 numbers change |
| R45 | Shipment entry | Serial number on product lines when a shipment has many products | Change | ✅ LIVE (V1.1.3) | Numbered badge on every product line |
| R46 | Bills | Record the Vasy Material Inward (MI) number in the bill too → status "MI uploaded" | Change | ✅ LIVE (V1.1.3) | MI w / wo boxes next to the Vasy bill number; same rules as the shipment's Material Inward window |
| R47 | Bills | w / wo qty on the bill: after typing one digit the box got re-selected, so the second digit replaced the first | V1.1 bug | ✅ LIVE (V1.1.4) | The bill no longer redraws while typing; the w / wo MRP & selling boxes appear when you leave the qty box |
| R48 | Shipments / Bills | Sort by + filter by: custom date range, status, supplier and other relevant options | Change | ✅ LIVE (V1.1.5) | Sort list, date field + from / to + quick ranges, status / bill / only-show chips, supplier; kept per PC |
| R49 | Whole dashboard | Restructure: separate data entry from tracking; group PO / Shipment / Bill; analytics separate; think of V2 | Design | ✅ Plan approved · 📝 Phases 1–4 | `DASHBOARD_STRUCTURE_PROPOSAL.md` v3: workflow-ordered menu, All POs on the Fund-planning engine, Today, search, saved views, supplier page, bulk actions, WhatsApp chase text. Owner 13 Oct: bills before OR after arrival; closed POs only in Analyse; all extra ideas in |
| R50 | Apps Script | Clean up stale script files / deployments | Owner action | ⏳ Owner | Delete `Untitled` (whereAmI debug helper); archive the trial deployment; see START_HERE / chat checklist |
| R51 | Memory / Git | New chat must be able to continue | Docs | ✅ Done | `START_HERE_V1_1.md`, tests folder with `run_all.sh`, versions recorded (V1 = 36, V1.1 LIVE = 6) |
| R52 | Fund planning | Sort by supplier on the home page, like Preview / PDF | Change | ✅ LIVE (V1.1.6) | "Order by … then … then …" + ▲/▼ on the home page, shared with Preview / PDF / Excel; extra keys PO number, Pending ₹, Transit ₹, PO value ₹ |
| R53 | Fund planning | Status filter showed one status per PO (part received hid in-transit goods); supplier filter looked broken | Bug | ✅ LIVE (V1.1.6) | New "Show POs that have": pending / in transit / received / not sent / overdue (a PO can match several) + "only those lines & amounts"; old Status renamed "PO stage"; dropdown count, label and ticks now update immediately (they stayed on "All" before) |
| R54 | Bills | Total qty column (w + wo) per line in the bill split | Change | ✅ LIVE (V1.1.6) | Updates while typing |
| R55 | Bills / products | MRP 0 in some Vasy upload files | Bug | ✅ LIVE (V1.1.6) | Cause: the product has MRP 0 in Vasy itself (e.g. CPG143957A — new, never purchased; 166 such codes in Vasy) and none in the master. Fixes: red MRP boxes + warning on the bill; MRP typed on an earlier bill is reused; sync report lists "in Vasy but no MRP" first; product sync moved from 2 am to 5 am (Vasy → Supabase load runs ~3:05 am, so 2 am always used yesterday's prices) |
| R56 | Access modes | Mode names / rights | Change | 📝 Phase 2 | Four modes: View only (display, no changes) · Operations (was PO Tracking — enters shipments and records status, never sees supplier names or rates) · Purchase team (was Follow-up) · Management |
| R57 | Workflow | Closed POs must not appear in workflow / tracking screens — they are history; open POs are time-sensitive | Decision | 🧪 V1.1.7 | Closed POs only in Analyse › PO History and in search (marked closed) |
| R58 | Bills | Bills are prepared before OR after the goods arrive — both normal | Decision | 🧪 V1.1.7 | Bill quick views "Ready — goods not arrived" / "Ready → upload MI"; shipments quick view "Billed, not arrived" |
| R59 | Modes | Supplier contact details visible only in Management; Purchase team vs Management difference stays as it is | Decision | ✅ kept | Already Management-only in code (`supCallHtml`) — unchanged |
| R60 | Follow-up | Redesign tasks, snooze and follow-up per the workflow | Change | 🧪 V1.1.8 | Snooze → next follow-up date; dad's answer log (4 outcomes); to-dos; Ask dad · by supplier (R63) |
| R61 | Restructure phase 1 | Workflow menu, All POs, Bills tab, quick views, Track / Analyse, Operations / Purchase team names | Change | 🧪 V1.1.7 | Dashboard file only |
| R62 | Today | One "Today" screen in workflow order: new requests · POs to send · sent with no promised date · promised date passed · follow-ups & to-dos due · shipments overdue · arrived not on a bill · bill ready (goods not arrived / → MI) · MI done → Vasy bill · recheck qty · fully received → close. Menu badges | Change | 🧪 V1.1.8 | Landing screen. Overview + Daily brief stay under Track for now |
| R63 | Follow-up | Dad is the only contact with suppliers; the team drives him in a short daily meeting. "By supplier" list of what to ask each supplier today (promised date, shipped?, LR / transport, pending items, bill in the WhatsApp group, bill on dad's phone → forward) | Change | 🧪 V1.1.8 | Today › 📞 Ask dad · by supplier; copy for WhatsApp; one answer for all POs of a supplier; "Copy today's answers" |
| R64 | Follow-up | "Sent but no promised date" must be chased at once, not after 3 days | Change | 🧪 V1.1.8 | On the ask list from the day the PO is sent; Daily brief marks it urgent from day one; All POs "To chase" uses the promised date |
| R65 | All POs / Fund planning | Sort and filter panel has too many options — structure and order it | Change | 🧪 V1.1.8 | Main row: supplier · PO stage · has · one Sort list · clear. "More filters" (category, product, matching lines, custom 3-level order) and "Columns & sharing" fold away |
| R66 | Analyse | Remove the MOQ / EOQ Levels module (inventory analysis will own it). Add a module to enter supplier-given lead time and MOQ per product × supplier, next to the real lead time from our POs. No Apps Script change | Change | 🧪 V1.1.8 | Analyse › Lead time & MOQ. Saved in PO Meta rows "~ST\|supplier\|n". Levels removed from the menu (old code dormant) |
| R67 | Restructure phase 3 extras | PO window progress strip; bills "next Vasy step" button; follow-up calendar | Change | 🧪 V1.1.8 | Dashboard file only |
| R68 | Ask by supplier | Rename "Ask dad · by supplier" → "Ask by supplier" (no "dad" on screen). Expand all / collapse all; tick POs and shipments (or a whole supplier) and act on all ticked at once | Change | 🧪 V1.1.8b | Bottom bar: POs → promised / shipping / no answer / delayed / next follow-up; shipments → bill in group / on personal phone / ask tomorrow; copy ticked |
| R69 | Layout | The Detailed / Condensed switch at the top looked irrelevant and duplicated module switches — one place only | Change | 🧪 V1.1.8b | Kept ONE global switch at the top; it now drives every screen (tables, PO cards, Today, Ask by supplier). Module "Density" switch removed; PO builder "Condensed" renamed "Summary" (it is a read-only summary, not spacing) |
| R70 | Overviews | Overview for Shipments and Bills like the PO overview | Change | 🧪 V1.1.8b | POs › Overview (moved from Track), Shipments › Overview, Bills › Overview; tiles open the matching list |
| R71 | Review | Re-analyse everything and suggest more ideas | Proposal | ✅ owner picked the ★ ones | `DASHBOARD_STRUCTURE_PROPOSAL.md` §7 — I1 I2 I3 I5 I6 I7 I8 I10 I13 I14 I16 I19 built as R78–R89 |
| R72 | Shipments / Bills | Every edit audited — who, when and what changed | Change | 🧪 V1.1.9 · server 2.8 | Audit Log note lists changed fields and lines (old → new) + optional reason; new route `history`; 🕘 History in both windows |
| R73 | Shipments | Shipment opens as a view (product + qty, expand for the PO split, search); "✎ Edit shipment" opens today's form; product search inside the form too | Change | 🧪 V1.1.9 | Shipments list ✎ and Ask-by-supplier "Enter LR / date" go straight to the form |
| R74 | Bills | Bill opens read-only; "✎ Edit bill" to change; product search | Change | 🧪 V1.1.9 | Vasy steps (download, MI, Vasy bill no.) still work from the view |
| R75 | Shipments / Bills | "What changed / why" box when editing — kept in the history | Change | 🧪 V1.1.9 · server 2.8 | optional |
| R76 | Overviews | Clicking an overview tile shows that list; click a line to open it (like the PO overview) | Change | 🧪 V1.1.9 | Shipments and Bills overviews; "open the full list with this filter" link; supplier table numbers clickable |
| R77 | Board | Excess chip and date ran outside the cards | Bug / redesign | 🧪 V1.1.9 | New card layout that never exceeds its column; one card per shipment (not per PO it touches) |
| R90 | Dates | Some dates showed as "Tue Oct 13 2026 00:00:00 GMT+0530…" | Bug | 🧪 V1.1.9 | `posDispDate` now reads any date format → "13 Oct" |
| R56 | Modes (phase 2) | View only (no PIN, nothing can be changed) and an Operations PIN | Change | 🧪 V1.1.9 · server 2.8 | Operations PIN asked once per PC; Operations cannot delete; View only opens on Goods check; Script Property `VT_PIN_OPS` |
| R78 | Ask by supplier | ✓ Discussed per supplier + progress (I1) | Change | 🧪 V1.1.9 | this PC, resets daily; discussed suppliers fold to the bottom |
| R79 | Ask by supplier | Promise score per supplier (I2) | Change | 🧪 V1.1.9 | kept / broken / avg days late / no-answer in 30 days, from the answer log |
| R80 | Ask by supplier | Escalate flag (I3) | Change | 🧪 V1.1.9 | 2+ broken promises in 60 days, or no answer 3 call-days running |
| R81 | New PO | Lead time & MOQ used (I5) | Change | 🧪 V1.1.9 | arrival estimate per supplier group; "below MOQ → round up"; PO expected date = today + lead time |
| R82 | Requests | Already on order / on the way / last PO (I6) | Change | 🧪 V1.1.9 | supplier and rate hidden in Operations |
| R83 | New PO | Duplicate-order warning (I7) | Change | 🧪 V1.1.9 | on the line and a confirm on ✓ Create PO |
| R84 | All POs | Bulk mark sent / close (I8) | Change | 🧪 V1.1.9 | tick POs → bar on top |
| R85 | Shipments | Expected date filled from the supplier's real transit days (I10) | Change | 🧪 V1.1.9 | new shipments only; editable |
| R86 | Today | "Since yesterday" strip (I13) | Change | 🧪 V1.1.9 | |
| R87 | All | Browser tab shows the Today count (I14) | Change | 🧪 V1.1.9 | |
| R88 | Track | Fix list (I16) | Change | 🧪 V1.1.9 | no expected date, no LR, off-PO, no supplier bill no., MRP 0, no supplier, temporary codes, no rate |
| R89 | Menu | Search box (I19) | Change | 🧪 V1.1.9 | POs (incl. closed), shipments, LR, bills, products; "/" to jump there; Enter opens |
| R91 | Board | After V1.1.9 the Board did not show fully — cards in a long column were squashed to a thin strip; old V1 lot cards still showed "Thu Oct 08 2026 … GMT" | Bug (from R77) | 🧪 V1.1.9b | Cards keep their full height and the column scrolls; old V1 lots get the same compact card with short dates. Test t42 now checks it (it fails on the V1.1.9 file) |
| R92 | Connection | The live-sheet connection was inside PO Requests and hard to find; open it from any tab without leaving the screen; with an unsaved draft and a connection problem, connect and still save the draft | Change | 🧪 V1.1.9c | Menu-bar button (✓ saved / ● not connected) and ⚙ Settings open a connection window over the current screen; it lists changes waiting to be saved; after connecting, a waiting save is retried by itself |
| R93 | Speed | Saving still takes a few seconds | Change | 🧪 V1.1.9c · server 2.8 | Server reads each sheet once per save (was 2–3 times) and re-uses it for the reply; an edit rewrites only from the first changed row. Shipment save: ~53% less sheet reading; bill save ~46% less. Saves no longer wait behind background saves |
| R94 | Reliability | "Connection error" pops up often and edits are not saved | Bug | 🧪 V1.1.9c | Saves go one at a time (parallel saves made the sheet lock wait or fail); a passing problem is retried twice by itself; if it still fails, a "Not saved yet" window keeps every entry on screen with Check connection / Try again |
