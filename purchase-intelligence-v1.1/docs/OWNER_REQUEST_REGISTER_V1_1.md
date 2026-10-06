# Purchase Intelligence V1.1 — Owner Request & Bug Register

Every change or bug the owner has raised, with a fixed number. Refer to items by number (e.g. "R24").
Numbers are never reused. New items are added at the bottom.

Status: ✅ LIVE · 🧪 Built, in TEST (next release) · 📝 Planned · ⏳ Owner action / decision · 🧊 Deferred

Releases: **Vaigai** = V1.1 server 2.4, live Oct 2026 · **V1.1.1** = server 2.5, live Oct 2026 · **V1.1.2** = server 2.6 + ProductsApi + ShipmentTools (this build)

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
| R09 | Old lots | Convert all lots into shipments | Change | 🧪 V1.1.2 | Owner: proceed. Run from Apps Script: `v11LotConvertDryRun` → check the "V1.1 Conversion Report" tab → `v11LotConvertApply`. Undo: `v11LotUnconvert`. Old lot rows are kept (column U "Converted To") |
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
| R23 | All V1.1 saves | Save + refresh takes ~5 s | Performance | 🧪 V1.1.2 | V1.1.1: one round trip. V1.1.2: shipment / bill lines rewritten in one block instead of one row-delete per line. `v11SpeedCheck` times every tab |
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
| R34 | Products | Product data from Supabase, master sheet as fallback, cached in the sheet | Change | 🧪 V1.1.2 | Owner: MRP = selling in Vasy; Vasy w prices are GST-inclusive → file carries MRP / selling incl GST as they are (cost still grossed up). Every price labelled incl GST / excl GST. Cost from the purchase register (master only as fallback). Products tab +5 columns; "V1.1 Product Sync Report" tab |
| R35 | PO builder | Unit at the top always showed "nos" | Old V1 bug | ✅ LIVE (V1.1.1) | Duplicate selector removed; each cart line now has its own unit selector; exports use it |
| R36 | PO builder | Product search works only sometimes | Old V1 bug | 🧪 V1.1.2 | V1.1.1 fixed the index rebuild. Reopened: "r3h" did not find R3 H2…, "brf10npp" did not find BRF 10N … PP. V1.1.2: typed letters without spaces are matched against the start of consecutive words |
| R37 | PO / Shipments | Change a wrong product even after it is shipped (emergency, with warning) | Change | 🧪 V1.1.2 | Owner: only in PO edit. "⚠ correct product" on a shipped line → pick the right product → list of affected lots / shipments / bills → type CORRECT. Refused if a bill is locked. Audited |
| R38 | Shipments | Module all one colour, no contrast | V1.1 UX | ✅ LIVE (V1.1.1) | Coloured headers (teal shipments, amber bills, blue MI), coloured state stripes per product, zebra rows |
| R39 | Whole dashboard | Check every button actually works | Audit | 🧪 V1.1.2 | Behaviour audit: 906 buttons pressed across 22 screens / windows / views with sample data — 1 old bug found and fixed (🌙 theme button crashed in PO Tracking mode). All delete buttons call the right server action |
| R40 | Release | V1.1 runs on a new copy of the live sheet; old V1 frozen (token changed, access = owner only) | Decision | ✅ LIVE | LIVE sheet `1SuQsKP9JwE4DGk8RELGdqMpfQjquVhK_vWC6pmIcJfE`, Apps Script `1R3cGa6vgyOkdwF3qFsZ38Tmu48YXBe0qLnyg3ArmEM2TeGWSbfczRNT9` |
| R41 | Product page | Charge insight (per-unit freight) reads old lots only — V1.1 bill charges (and converted lots) are not counted | Found in R09 work | 📝 Planned | Read charges from V1.1 bills too |
| R42 | Request app | Lot list on a request line did not show V1.1 shipment numbers | Found in R09 work | 🧪 V1.1.2 | SH numbers now listed with the old lots |
