# Dashboard restructure — detailed proposal v2 (R49 · option C)

Status: 📝 waiting for owner approval (13 Oct 2026). Phases are planned only after approval.

**Owner answers this plan is built on (13 Oct 2026)**
- One person does data entry **and** follow-up (today's *Follow-up* mode); the owner oversees (*Management*); office staff only look up PO status, rarely (*PO Tracking* mode). Later there may be one data-entry person and one tracking person.
- The same person reviews Requests and builds POs.
- All old lots are converted → old-lot screens can go.
- Mode names: **View only** · **Purchase team** · **Management** (approved).
- **Fund planning** is used every day, also as the "By PO" view because of its sort / filter → the Purchase team must see it, and its filter engine becomes the standard for the PO list.
- Overview and Daily brief stay (under Track) until the **Today** screen replaces them.

---

## 1. The workflow, step by step

```
 Sales asks          Purchase decides & orders            Supplier delivers                 Books & closes
┌──────────┐   ┌───────────┐  ┌──────────┐  ┌─────────┐   ┌───────────┐  ┌──────────┐   ┌──────────┐  ┌─────────┐  ┌─────────┐
│1 Request │ → │2 Review   │→ │3 Build PO│→ │4 Send & │ → │5 Shipment │→ │6 Arrival │ → │7 Bill    │→ │8 Vasy MI│→ │9 Close  │
│ (req app)│   │  requests │  │          │  │ follow up│   │ dispatched│  │ received │   │ entered  │  │ & bill  │  │ PO      │
└──────────┘   └───────────┘  └──────────┘  └─────────┘   └───────────┘  └──────────┘   └──────────┘  └─────────┘  └─────────┘
                         └──────── Today screen shows what is waiting at every step ────────┘
                         Track: Board · Follow-up · By product · Goods check  |  Analyse: Fund planning · Analytics · History · Register
```

Each step below says: **who**, **where in the new menu**, **what you see**, **what you can do**, **filters / sort**, **what is new or better than today**, and **what it hands to the next step**.

### Step 1 — Sales request (request app, unchanged)
- Who: sales / branch staff. Where: the separate request form (not this dashboard).
- Goods Check (request app) keeps showing them shipped / in transit / received for their lines — no supplier, no rate.
- Better: request lines now show SH numbers (done in V1.1.2).

### Step 2 — Review requests → *POs › Requests*
- Who: Purchase team. **Today:** separate "Requests" tab.
- See (kept): open request lines from the live sheet, combined per product (total qty asked), requester, urgency, comments, whether it is a new product, progress of lines already ordered (ordered / shipped / received).
- Do (kept): add to the PO cart as w or wo (one line, ticked lines, or new product with a temporary code), set a status on ticked lines (bulk), To-do / All switch, export Excel / PDF.
- Filters / sort (kept + new): status, urgency, requester, product, category, **date range (new)**; sort by date, urgency, product.
- **New / better:** a badge "N new requests" on the menu; "already pending on PO-xxx / in transit SH-xxx" shown right on the request line so nobody orders twice; last purchase rate & supplier from the register on the line.
- Hands over: cart lines to Step 3.

### Step 3 — Build PO → *POs › New PO* (today's PO Builder)
- See: cart grouped by supplier × w / wo, best supplier and last landing cost from the register, MRP incl GST, rate excl GST, unit, line value.
- Do: search products (word-chain search), add / remove, change supplier, qty, unit, rate; split w / wo; **Create PO**; download the Vasy PO file; summary export.
- **New / better:** after "Create PO" the screen jumps to the new PO in *All POs* (so the next action — Send — is one click); a check "this product is already on open PO-xxx" before creating.
- Hands over: a PO in stage **Made**.

### Step 4 — Send & follow up → *POs › All POs* (+ the PO window)
- This becomes **the main working list** — built on the Fund planning filter engine (owner: "replacement for By PO").
- See per PO: number, supplier, stage chip (Made · Sent · Part shipped · In transit · Part received), *has* chips (⏳ pending · 🚚 in transit · 📦 received), promised / expected date, overdue flag, last follow-up note, ordered / shipped / received qty, pending ₹, SH and BL numbers.
- Do (row buttons + PO window): **✈ Mark sent**, supplier contact (phone / WhatsApp from Suppliers), **promised date**, **💤 snooze**, **follow-up note / to-do**, **✎ Edit PO** (qty, rate, add item, **⚠ correct product**), **✕ cancel balance**, **⇄ move lines to another PO**, **🚚 Ship** (opens a new shipment with this PO's pending lines), **✓ Close**, **↺ Reopen**, **🗑 Delete** (server-checked).
- Filters: has pending / in transit / received / not sent / overdue; PO stage; supplier; category; product; w / wo; date range (PO date / sent / promised / expected); search. Sort: the 3-level "Order by" (supplier, stage, date, PO no., product, pending ₹, transit ₹, PO ₹) ▲▼. Quick views: *To send* · *To chase (overdue / no promise)* · *Waiting for goods* · *Fully received → close* · *All open* · *Closed (history)*.
- Columns can show / hide ₹ (View only never sees ₹ or supplier).
- **New / better:** one list replaces By PO + most of Fund planning's look-up use; **next-action button** on every row (Send / Chase / Ship / Close — the single most likely next step); the PO window gets a **progress strip** Request → PO → Sent → Shipped → Arrived → Billed → Closed with dates; Closed POs are a filter, so "PO History" no longer needs its own tab.
- Hands over: pending lines to Step 5.

### Step 5 — Shipment dispatched → *Shipments*
- See: shipments with SH no., supplier, POs, products, qty, excess / off-PO, ship / expected / arrived dates, LR, status, bill status.
- Do: **＋ New shipment** (supplier → pick a PO → tick lines, or search products; oldest-PO-first split; excess / off-PO; UOM; serial numbers), edit, delete, cancel.
- Quick views: **🚚 To arrive** · **⏰ Overdue** · **📦 Arrived – not on a bill** · All. Filters / sort: as V1.1.5 (date field + range, status, bill status, supplier, excess / off-PO / converted / no LR).
- **New / better:** quick-view chips on top (one click instead of opening filters); **arrival** button stays on the row.
- Hands over: an In-Transit shipment → Step 6.

### Step 6 — Arrival / goods received → *Shipments* (row button) — later *Arrivals*
- Today: **📦 Mark arrived** = everything received and accepted (interim V1.1-06), reversible until an MI number exists.
- Later (V1.1-06 proper): an **Arrivals** check per line — received, rejected / damaged / short, note → Accepted = Received − Rejected; rejections listed for the supplier.
- Hands over: arrived goods → MI (Step 8) and the bill (Step 7).

### Step 7 — Bill entered → *Bills* (own top tab, out of Shipments)
- See: bills with BL no., supplier, supplier bill nos (w / wo), shipments, w total, wo total, stage (Draft · Ready · MI uploaded · Part billed · Billed), locks.
- Do: **＋ New bill** (from a shipment or blank), assign / unassign shipments, w / wo split per line (auto-fill other side), **Total qty**, rates (excl GST), GST %, MRP / selling (incl GST; red when missing), charges + round-off, note, delete when empty.
- Quick views: **Draft** · **Ready → upload MI** · **MI done → record Vasy bill** · **Billed** · **Recheck qty**. Filters / sort: as V1.1.5.
- Bills can be prepared before arrival (owner rule).
- Hands over: Ready bill → Step 8.

### Step 8 — Vasy MI & bill → *Bills* (bill window) and *Shipments* (MI window)
- Do: **⬇ Download for Material Inward** (needs arrival, override recorded), **record Vasy MI no.** (w / wo) → "MI uploaded"; **⬇ Download for Supplier Bill**, **record Vasy bill no.** (w / wo) → "Billed"; clear numbers (audited, reverse order).
- **New / better:** the bill window shows the next Vasy step as the big button (Download MI → Record MI → Download bill → Record bill) instead of all buttons at once.
- Hands over: billed shipments → PO can close.

### Step 9 — Close → *POs › All POs* (quick view "Fully received → close")
- Do: **✓ Close PO**; request lines become "Received" in the request app.
- **New / better:** POs that are fully received **and** billed are listed ready to close; close several at once.

---

## 2. The new menu

```
🏠 Today   |   POs ▸ Requests · New PO · All POs   |   🚚 Shipments   |   🧾 Bills   |   🔎 Track   |   📊 Analyse   |   ⚙
```

| Menu | Holds | Visible to |
|---|---|---|
| 🏠 **Today** *(phase 2)* | one to-do list in workflow order, each item with its action button: new requests · POs to send · POs to chase (overdue / no promise) · shipments overdue · arrived not on a bill · bills ready for MI · MI done, no Vasy bill · recheck qty · ready to close | Purchase team, Management |
| **POs** | Requests · New PO · **All POs** (fund-planning style list) | Purchase team, Management (View only: All POs without ₹ / supplier) |
| 🚚 **Shipments** | list + quick views + New shipment + arrival + MI window | Purchase team, Management (View only: read) |
| 🧾 **Bills** | list + quick views + New bill + Vasy steps | Purchase team, Management |
| 🔎 **Track** | Board · Follow-up calendar · By product · Goods check · Overview & Daily brief (until Today replaces them) | everyone (View only without ₹ / supplier) |
| 📊 **Analyse** | **Fund planning** (Purchase team + Management) · PO analytics · Register intelligence (Dashboard, Search, Full Data, Levels) | Fund planning: Purchase team + Management; the rest: Management |
| ⚙ | connection, user name, mode / PIN, register load, product sync status | everyone |

**Removed:** "By bill" (old lots), old lot buttons (ship lot / split / MI / receive on V1 lots), "By PO" (→ All POs), "PO History" tab (→ All POs › Closed).

**Modes:** *View only* (was PO Tracking) → Track + read-only records, never ₹ or supplier · *Purchase team* (was Follow-up) → everything except PO analytics and register intelligence · *Management* → everything. Each mode opens on its own home: View only → Track › Goods check; Purchase team → Today (Overview until phase 2); Management → Today.

---

## 3. What changes for the person doing the work

| Today | After |
|---|---|
| 8 top tabs + 11 sub-views in PO Tracking; the order does not follow the work | 6 menus in workflow order; every step has one home |
| Find a PO: By PO (few filters) or Fund planning (good filters, but it is "money") | **All POs** with Fund planning's filters + quick views + next-action button |
| Shipments and Bills share one tab | each has its own tab and quick views |
| What do I do now? → look in Overview, Daily brief, Follow-up, Board | **Today** lists it, in order, with the button (phase 2) |
| History, Analytics, Fund planning mixed with daily work | Analyse menu; Fund planning still one click away for the Purchase team |
| Old-lot screens and buttons still visible | gone (all lots converted) |
| Mode called "PO Tracking" but it is look-up only | "View only" |

Fewer clicks for the daily loop (requests → PO → send → chase → shipment → bill → Vasy → close): every step's list opens already filtered to "what is waiting", and the row button does the next action.

---

## 4. More ideas to make it better (owner can pick)
1. **One search box in the menu bar** — type a PO, SH, BL, supplier or product → jump straight to it.
2. **Menu badges** with counts (requests waiting, shipments overdue, bills ready for MI).
3. **Saved views** — save a filter + sort (e.g. "Pawan — in transit") and reuse it.
4. **Supplier page** — everything open with one supplier (POs, shipments, bills, ₹ pending), handy when they call.
5. **Bulk actions** — mark several POs sent / closed, export several bills.
6. **Daily WhatsApp-ready chase list** — copy "overdue POs per supplier" text in one click.

## 5. Why this suits V2
- **Records = V2 tables / APIs**: purchase_order (+lines), shipment (+allocations), bill (+lines), later arrival / receipt. V2 can replace one record screen at a time behind the same menu.
- **Today = the V2 "next actions / exceptions" view** — its rules are written here once, later become a database view.
- **Track = read views; Analyse = the BI layer** on Supabase.
- **Modes = V2 roles** (View only / Purchase team / Management).
- The same list pattern everywhere (quick views + filters + sort + next action) becomes one reusable V2 component.

## 6. Not in scope of this restructure
No change to how data is saved, numbering, Vasy files, GST rules or the request app. Line-level arrival with rejections (V1.1-06) and Vasy validation (V1.1-07) stay separate work items, but get their place in this menu (Arrivals, Bills).
