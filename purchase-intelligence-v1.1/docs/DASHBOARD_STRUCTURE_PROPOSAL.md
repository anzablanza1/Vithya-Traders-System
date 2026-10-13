# Dashboard restructure — proposal v3 with phases (R49 · option C)

Status: ✅ plan approved in principle (13 Oct 2026, "everything is good", all extra ideas in). Phases below; each phase is built only after the owner says go.

**Owner decisions this plan is built on (13 Oct 2026)**
- One person does data entry + follow-up (today's *Follow-up* mode); the owner oversees (*Management*); office staff look up status and sometimes record it (*PO Tracking* mode). Later there may be separate data-entry and tracking people.
- The same person reviews Requests and builds POs.
- All old lots are converted → old-lot screens can go.
- **Fund planning** is used daily, also as the "By PO" view → the Purchase team sees it, and its filter engine becomes the standard PO list.
- Overview and Daily brief stay (under Track) until **Today** replaces them.
- **Bills can be prepared before OR after the goods arrive** — both orders are normal.
- **Closed POs never appear in the daily workflow or tracking** (they are history, open POs are time-sensitive); closed POs live only in Analyse.
- **Four modes:** today's PO Tracking mode keeps **entering data and recording status without seeing supplier names or rates**; a new **View only** mode is for display (no buttons that change anything).

---

## 1. The workflow, step by step

```
 Sales asks       Purchase decides & orders               Supplier delivers                   Books & closes
┌─────────┐  ┌──────────┐ ┌──────────┐ ┌───────────┐  ┌───────────┐ ┌────────────┐      ┌──────────────────┐ ┌─────────┐
│1 Request│→ │2 Review  │→│3 Build PO│→│4 Send &   │→ │5 Shipment │→│6 Arrival   │──┐   │8 Vasy MI + bill  │→│9 Close  │
│(req app)│  │ requests │ │          │ │ follow up │  │ dispatched│ │ (received) │  ├──→│ (MI needs arrival)│ │ PO      │
└─────────┘  └──────────┘ └──────────┘ └───────────┘  └─────┬─────┘ └────────────┘  │   └──────────────────┘ └─────────┘
                                                            └────→ 7 Bill entered ──┘   (7 can happen before OR after 6)
                     Today: what is waiting at every step  ·  Track: open POs only  ·  Analyse: history, closed POs, money
```

For each step: **who · where · see · do · filters / sort · new or better · hands over**. "Ops" = the renamed PO Tracking mode (no supplier / rate), see §3.

### Step 1 — Sales request (request app, unchanged)
- Sales / branch staff, in the separate request form. Goods Check there shows shipped / in transit / received per line (no supplier, no rate) and SH numbers (V1.1.2).

### Step 2 — Review requests → *POs › Requests*
- Who: Purchase team (Ops sees the list without rates, cannot order).
- See (kept): open request lines, combined per product, requester, urgency, comments, new-product flag, progress of lines already ordered.
- Do (kept): add to the PO cart as w or wo (one / ticked / new product), bulk status, To-do / All, export Excel / PDF.
- Filters / sort: status, urgency, requester, product, category, **date range (new)**; sort by date, urgency, product.
- **New:** "already on open PO-xxx / in transit SH-xxx" on the line so nothing is ordered twice; last rate + supplier from the register on the line; menu badge "N new requests".
- Hands over: cart → Step 3.

### Step 3 — Build PO → *POs › New PO* (today's PO Builder)
- Who: Purchase team.
- See / do (kept): word-chain search, supplier + landing cost from the register, w / wo groups, qty, unit, rate (excl GST), MRP (incl GST), **Create PO**, Vasy PO file, summary export.
- **New:** warning "already on open PO-xxx" before creating; after Create, jump to the new PO in All POs with **✈ Send** ready.
- Hands over: PO in stage *Made*.

### Step 4 — Send & follow up → *POs › All POs* (+ PO window)
- Who: Purchase team (full); Ops (same list, no supplier / rate / ₹, can record status); View only (read).
- The main working list, on the **Fund planning filter engine**. **Open POs only.**
- See per PO: number, supplier*, stage chip, *has* chips (⏳ pending · 🚚 in transit · 📦 received), promised / expected date, overdue flag, last follow-up note, ordered / shipped / received qty, pending ₹*, SH / BL numbers. (*hidden in Ops and View only)
- Do (kept, in the row or PO window): ✈ mark sent, promised date, 💤 snooze, follow-up note / to-do, ✎ edit PO (qty, rate*, add item, ⚠ correct product), ✕ cancel balance, ⇄ move lines, 🚚 Ship (new shipment with this PO's pending lines), ✓ close, ↺ reopen, 🗑 delete (server-checked). Ops can do status actions (sent, promised date, notes, snooze, ship) but not rates / edit prices / delete.
- Quick views: **To send** · **To chase** (overdue / no promise) · **Waiting for goods** · **Fully received → close** · **All open**.
- Filters: has pending / in transit / received / not sent / overdue; PO stage; supplier*; category; product; w / wo; date range (PO date / sent / promised / expected); search. Sort: 3-level Order by (supplier*, stage, date, PO no., product, pending ₹*, transit ₹*, PO ₹*) ▲▼.
- **New:** next-action button per row (Send / Chase / Ship / Close); PO window **progress strip** Request → PO → Sent → Shipped → Arrived → Billed → Closed with dates; **bulk**: mark several sent / close several; **WhatsApp chase text** per supplier (overdue lines, copy in one click); **saved views**.
- Hands over: pending lines → Step 5.

### Step 5 — Shipment dispatched → *Shipments*
- Who: Purchase team, Ops (supplier hidden — they pick by PO), View only (read).
- Do (kept): ＋ New shipment (supplier → PO picker → tick lines, or search; oldest-PO-first split; excess / off-PO; UOM; serial numbers), edit, cancel, delete; filters + sort (V1.1.5).
- **New:** quick views **🚚 To arrive · ⏰ Overdue · 📦 Arrived, not on a bill · 🧾 Billed, not arrived · All open**; saved views.
- Hands over: In Transit shipment → Step 6 and / or Step 7.

### Step 6 — Arrival → *Shipments* (row button) — later *Arrivals*
- Who: Purchase team, Ops.
- Today: 📦 Mark arrived = all received and accepted (interim V1.1-06), reversible until an MI number exists.
- Later (V1.1-06): per-line received / rejected / damaged / short → Accepted = Received − Rejected; rejection list per supplier.
- Hands over: arrived goods → MI (Step 8).

### Step 7 — Bill entered → *Bills* (own tab) — **before or after arrival**
- Who: Purchase team only (rates).
- Do (kept): ＋ New bill (from a shipment or blank), assign / unassign shipments, w / wo split, **Total qty**, rates excl GST, GST %, MRP / selling incl GST (red when missing), charges, round-off, notes, delete when empty.
- Quick views: **Draft** · **Ready — goods not arrived yet** · **Ready → upload MI** (arrived) · **MI done → record Vasy bill** · **Billed** · **Recheck qty**.
- **New:** the bill shows whether its shipments have arrived, so a bill prepared early waits visibly for arrival instead of being forgotten.
- Hands over: Ready bill → Step 8 (when goods have arrived).

### Step 8 — Vasy MI & bill → *Bills* (bill window) and *Shipments* (MI window)
- Who: Purchase team.
- Do (kept): ⬇ Material Inward file (needs arrival; override recorded), record Vasy MI no. (w / wo) → "MI uploaded"; ⬇ Supplier Bill file, record Vasy bill no. (w / wo) → "Billed"; clear numbers (audited).
- **New:** one **next Vasy step** button (Download MI → Record MI → Download bill → Record bill); export several bills at once.

### Step 9 — Close → *POs › All POs* (quick view "Fully received → close")
- Do: ✓ Close (one or several). The PO leaves all workflow and tracking screens and appears only in *Analyse › PO History*. Request lines become "Received" in the request app.

---

## 2. The new menu

```
🏠 Today  |  POs ▸ Requests · New PO · All POs  |  🚚 Shipments  |  🧾 Bills  |  🔎 Track  |  📊 Analyse  |  🔍 search  |  ⚙
```

| Menu | Holds | Shows closed POs? |
|---|---|---|
| 🏠 **Today** | one to-do list in workflow order with action buttons: new requests · POs to send · POs to chase · shipments overdue · arrived, no bill · bill ready, goods not arrived · bill ready → MI · MI done → Vasy bill · recheck qty · ready to close | no |
| **POs** | Requests · New PO · All POs | no |
| 🚚 **Shipments** | list + quick views + new shipment + arrival + MI window | no (shipments of closed POs only via search / history) |
| 🧾 **Bills** | list + quick views + new bill + Vasy steps | no (billed bills drop out of "open") |
| 🔎 **Track** | Board · Follow-up calendar · By product · Goods check · Overview & Daily brief (until Today) | **no** |
| 📊 **Analyse** | Fund planning · **PO History (closed POs)** · PO analytics · Register intelligence (Dashboard, Search, Full Data, Levels) | yes (history) |
| 🔍 **Search box** | type PO / SH / BL / supplier / product → jump; closed items open read-only, marked "closed" | yes, labelled |
| ⚙ | connection, user, mode / PIN, register load, product sync status | — |

**Removed:** By bill (old lots), old lot buttons, By PO (→ All POs), Closed-PO views inside workflow screens.

**Menu badges:** counts on Today, Requests, Shipments (overdue), Bills (ready for MI).

**Supplier page** (from any supplier name): everything open with that supplier — POs, pending lines, shipments, bills, ₹ pending, contact, WhatsApp chase text. Purchase team + Management only.

---

## 3. Modes (four)

| Mode | Was | Sees supplier & rates? | Can change data? | Opens on |
|---|---|---|---|---|
| **View only** | new | no | **no** — display only (no save buttons) | Track › Goods check |
| **Operations** | PO Tracking | **no** | yes: shipments (enter / edit / arrival), PO status (mark sent, promised date, notes, snooze, ship), requests status — not rates, not bills, not PO prices, not delete | Today (their items) |
| **Purchase team** | Follow-up | yes | everything except register intelligence & PO analytics; sees **Fund planning** | Today |
| **Management** | Management | yes | everything | Today |

- View only needs no PIN (it changes nothing). Operations, Purchase team and Management each have a PIN (Operations PIN is new → small server change in LiveApi `security`).
- Names: *View only* and *Purchase team* approved; *Operations* proposed for the renamed PO Tracking mode (owner may pick another word).

---

## 4. What changes for the person doing the work

| Today | After |
|---|---|
| 8 tabs + 11 sub-views, not in workflow order | 6 menus in workflow order; each step has one home |
| Find a PO: By PO (few filters) or Fund planning | All POs with Fund planning's filters + quick views + next-action button |
| Closed POs mixed into tracking views | closed POs only in Analyse › PO History and search |
| Shipments and Bills share a tab | own tabs, quick views; early bills wait visibly for arrival |
| "What do I do now?" spread over Overview, Daily brief, Follow-up, Board | Today lists it in order with the button |
| PO Tracking mode can't be used for display safely | View only for display; Operations for no-price data entry |
| Old-lot screens still visible | gone |

## 5. Why this suits V2
- Records (PO, shipment, bill, later arrival) = V2 tables / APIs; one screen can move to V2 at a time.
- Today = the V2 "next actions / exceptions" view; Track = read views; Analyse = BI on Supabase.
- The four modes = V2 roles; the "no supplier / rate" rule becomes a V2 permission.
- One list pattern (quick views + filters + sort + saved views + next action + bulk) = one reusable V2 component.

## 6. Phases (each: trial deployment → staff → Git)

| Phase | Release | What | Server change? |
|---|---|---|---|
| **1 — Menu & lists** | V1.1.7 | new menu; POs module (Requests · New PO · **All POs** on the Fund-planning engine with quick views); Bills own tab; quick views on Shipments and Bills (incl. "bill ready, not arrived"); Track and Analyse split; **closed POs out of all workflow / tracking screens**, PO History under Analyse; Fund planning for Purchase team; remove By bill / old-lot buttons / By PO | no |
| **2 — Modes** | V1.1.8 | View only (display) · Operations (no supplier / rate, can record status and shipments) · Purchase team · Management; per-button permission; landing screen per mode; Operations PIN | yes — LiveApi `security` accepts an Operations PIN |
| **3 — Today & next actions** | V1.1.9 | Today screen (replaces Overview + Daily brief); menu badges; next-action button per PO row; PO progress strip; bill "next Vasy step" button | no |
| **4 — Speed-ups** | V1.1.10 | menu search box; saved views; supplier page; bulk send / close / bill export; WhatsApp chase text; Requests: "already on PO / in transit", last rate, date filter; New PO duplicate warning | no |

Not in this restructure: data saving, numbering, Vasy files, GST rules, the request app. V1.1-06 (arrival with rejections) and V1.1-07 (Vasy validation) stay separate but have their place (Arrivals, Bills).
