# Dashboard structure — options and recommendation (R49)

Status: 📝 proposal, waiting for owner decision (Oct 2026). Nothing is built yet.

## 1. What the dashboard has today

| Today's place | What is inside | Kind of work |
|---|---|---|
| Requests | sales requests from the request app → add to PO | entry |
| PO Builder | cart, supplier, rates, create PO, Vasy PO file | entry |
| PO Tracking (11 views) | Overview · Daily brief · Goods check · PO History · Analytics · Fund planning · Board · Follow-up · By PO · By product · By bill (old lots) | follow-up, look-up, analysis — all mixed |
| PO detail window | send, edit, split w/wo, cancel balance, close, delete, notes, promised date, snooze, WhatsApp, ship | actions on one PO |
| Shipments (2 views) | Shipments · Bills — list + filters + New + windows (MI, bill, arrival) | entry + status |
| Dashboard · Search · Full Data · Levels | purchase-register intelligence (management) | analysis |

The problem: one tab ("PO Tracking") holds three different jobs: **acting today** (chase, send, close), **looking something up** (where is this product / PO) and **analysis** (history, analytics, fund planning). And PO *entry* lives in two other tabs. Shipments + Bills feel right because they follow one simple pattern: *a list of one kind of record, with filters, a New button and a window that holds every action*.

## 2. Option A — split by Entry vs Tracking (owner idea 1)

Entry: POs · Shipments · Bills (each like today's Shipments). Tracking: Overview, Follow-up, Board, By PO, By product… where every action is also available.

+ A data-entry person never opens Tracking.
− Entry screens still need the same lists and filters as Tracking to *find* the record to work on → two lists of the same POs ("By PO" and "PO entry").
− "Mark arrived", "record MI no.", "add follow-up note" — entry or tracking? Splitting by *verb* creates grey areas.
− Tracking stays a big mixed tab (follow-up + look-up + analysis).

## 3. Option B — split by workflow module (owner idea 2)

PO module (PO entry + PO tracking) · Shipment module (entry + tracking) · Billing module (entry + tracking) · Analytics module (analytics + PO history) · Overall tracking module (everything together).

+ Mirrors the real chain and the future V2 tables (PO, shipment, bill).
+ Each module is self-contained — easy to explain and to replace one by one in V2.
− The most-used tracking views (Board, Follow-up, By product, Goods check) are **cross-module** — they show PO + shipment + bill status together. They would have to live in "Overall tracking", so "PO tracking" inside the PO module and "Overall tracking" overlap.
− A follow-up person visits four places a day (three modules + overall).
− "PO history" is just closed POs — it belongs in the PO list (a filter), not in Analytics.
− 5 modules + 4 register-intelligence screens = a crowded menu.

## 4. Option C — "Today · Records · Track · Analyse" (Claude's proposal)

```
Today            one action queue across the whole chain (home screen)
Records          Requests · POs · Shipments · Bills        ← data entry lives here
Track            Board · By product · Goods check · Follow-up calendar   (cross-record views)
Analyse          PO analytics · Fund planning · Register intelligence (Dashboard, Search, Full data, Levels)
```

**Today** — a single list of *things to do now*, each with its button: requests waiting for a PO → *Make PO*; POs not sent → *Send*; promised date passed / no promise → *Chase*; shipment overdue → *Chase*; arrived but not on a bill → *Create bill*; bill ready → *Upload MI*; MI done, no Vasy bill → *Record bill*; quantity recheck flags; fully received POs → *Close*. Built from today's Daily brief + Overview + Follow-up logic. Filter "show only my kind of work".

**Records** — the Shipments/Bills pattern for every record: list + sort/filter + **New** + window with all actions. Requests and PO Builder fold into **POs** (New PO from requests or blank). PO history = POs with the "Closed" filter. Bills get their own tab (no longer a view inside Shipments). Later, V1.1-06 adds **Arrivals** (receipt / rejection) as a fifth record.

**Track** — look-up views over everything; they open the *same* windows, so every action is available here too — no second copy of any action.

**Analyse** — management only (as now).

Roles reuse the existing modes: *PO Tracking (data entry)* sees Today + Records; *Follow-up* adds Track; *Management* sees everything.

## 5. Comparison

| | A Entry / Tracking | B Workflow modules | **C Today · Records · Track · Analyse** |
|---|---|---|---|
| Data-entry person sees only what they need | ✅ | 🟡 (each module mixes) | ✅ (Records) |
| Follow-up person works in one place | 🟡 (Tracking, but mixed) | ❌ (4 places) | ✅ (Today) |
| No duplicate lists of the same thing | ❌ | 🟡 | ✅ |
| Every action reachable from tracking | ✅ | ✅ | ✅ (same windows) |
| Cross-record views have a natural home | 🟡 | ❌ | ✅ (Track) |
| Matches V2 data model | 🟡 | ✅ | ✅ (Records = V2 tables) |
| Lets V2 replace one part at a time | 🟡 | ✅ | ✅ |
| Build risk in V1.1 | low | medium | low–medium (phased) |

## 6. Why C suits V2

- **Records = V2 tables / APIs** (purchase_order, shipment, bill, later receipt). V2 can take over one record type at a time behind the same screen ("strangler" path) — staff keep the same menu.
- **Today = the V2 "next action / exceptions" view** (V1.1-08). Writing its rules now (one rule per row type) gives V2 a ready specification, later a database view.
- **Track = read views**, **Analyse = BI layer** on Supabase — both already the V2 direction.
- Roles map directly to V2 user roles.

## 7. Suggested V1.1 phasing (smallest safe steps)

1. **Menu regroup + POs record + Bills tab** — new top menu, POs list with the same filters/sort as Shipments (reusing the PO window), PO Builder opened as "New PO", Bills as its own tab, Analytics / Fund / History moved under Analyse, old views kept under Track unchanged. Retire "By bill" (old lots) once the lot conversion is applied.
2. **Today queue** — new screen built from existing calculations; replaces Overview + Daily brief.
3. **Role presets** — landing screen and visible groups per mode.

Each phase is a normal V1.1 release (trial deployment → staff → Git).
