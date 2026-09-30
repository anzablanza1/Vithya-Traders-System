# VT Purchase Intelligence — CHANGE REGISTER · VERSION 2

> **Version 1 is frozen.** Baseline = `VT_Purchase_Intelligence_V1.html` (app **v8.6 · Noyyal**),
> `PORequest_index_V1.html`, `GoodsCheckApi_V1.gs`, `LiveApi_v7.2.gs`. Google Sheet backed up by Anu.
> All V1 history lives in the old `CHANGE_REGISTER.md`. This file tracks **only V2** going forward.

Owner: **You** (Anu) or **Me** (build side).
Status: ✅ Done · 🔧 In progress · ⏳ Pending · 🧊 Deferred · ❌ Dropped

---

## V2 GOAL — Multi-PO Shipment → Bill → Goods Check → Vasy redesign

The V1 model assumes **one lot = one PO**. Reality: a supplier sends **one physical shipment**
containing items from **several POs**, plus **excess** and **off-PO** items, and one supplier
**bill** may span several shipments (or one shipment may be split across bills). V2 restructures the
workflow so quantities **allocate** across PO lines instead of being nested inside a single PO.

### New object model (V2)
```
PO → PO Line
Shipment → Shipment Line → Shipment↔PO Allocation → PO Line   (many-to-many)
Bill (Material Inward) → Bill Line → Bill↔Shipment Allocation  (many-to-many)
Goods Receipt / Goods Check → Receipt Line / Exceptions
Vasy Upload  (generated from a Bill, after Goods Check)
```
Rule: **never** `shipment.po_id` or `bill.shipment_id` — both are many-to-many via allocation rows.

### Four workflow stages (each its own module)
1. **PO** — create & send (unchanged in spirit).
2. **Shipment entry** — product-first; pick supplier → add products+qty → system finds open PO lines →
   **FIFO (oldest PO first) as a *suggestion only*** → employee freely edits allocations, can mark
   **excess** and **off-PO**. Creating a shipment sets **In Transit**, NOT Received.
3. **Bill / Material Inward** — separate from shipment; select available-to-bill shipment quantities
   (many shipments → one bill, or one shipment → many bills). All existing bill logic stays here:
   **W/WO split, rates, GST, discounts, freight, packing, additional charges, round-off, totals,
   Vasy item-code mapping, Vasy bill number, upload prep**. Bill can be prepared **before arrival**.
4. **Goods Check / Receipt** — verification step on arrival; normal case = confirm; only record
   **rejected/short/damaged** as an exception. Then the prepared bill becomes **Ready for Vasy**.

### Core quantity fields (keep simple, everywhere)
`Ordered · In Transit · Received · Pending` — derived from allocations.
Shipment-allocated qty shows only in drilldowns. Accepted = Received − Rejected (derived, not stored
everywhere). Excess ≠ Off-PO (kept distinct). Shipment Qty ≠ Bill Qty ≠ Receipt Qty (never overwrite).

### Vasy upload validation (before upload)
duplicate invoice · missing item code · bill total mismatch · invalid W/WO split · GST error ·
qty discrepancy · unresolved off-PO/excess · missing accounting data · rate error → else **Ready for Vasy**.

### Central Exceptions view (later)
unallocated shipment qty · excess · off-PO · received-not-billed · billed-not-received ·
bill≠shipment · receipt≠shipment · rejected · received-not-uploaded · stale in-transit ·
PO remainder to cancel · duplicate invoice · failed Vasy upload.

---

## V2 BUILD PLAN (incremental — each becomes a work item on approval)

| ID | Work item | Depends on | Owner | Status |
|----|-----------|-----------|-------|--------|
| V2-00 | Freeze V1 baseline + start this register | — | Me | ✅ Done |
| V2-01 | **Data model + server**: new sheet tabs (Shipments, Shipment Lines, Shipment-PO Allocations, Bills, Bill Lines, Bill-Shipment Allocations, Receipts) + LiveApi read/write endpoints; keep V1 "Lots" tabs intact for back-compat | V2-00 | Me | ⏳ Pending approval |
| V2-02 | **Migration/back-compat**: map existing V1 lots → shipments + allocations so nothing breaks; PO status derives from allocations | V2-01 | Me | ⏳ |
| V2-03 | **Shipment Entry module** (product-first, supplier→products→qty; FIFO suggestion; fully editable allocation UI; excess & off-PO; shipment header fields; statuses) | V2-01 | Me | ⏳ |
| V2-04 | **Derive PO Ordered/In-Transit/Received/Pending from allocations** (replaces per-lot mirror); update Board/By-PO/By-product/Goods Check/Fund/Analytics to read it | V2-02, V2-03 | Me | ⏳ |
| V2-05 | **Bill / Material Inward module** (select shipment lines across shipments; many↔many; keep all W/WO split + charges + round-off + Vasy mapping/number/upload-prep; bill-before-arrival; additional/off-PO/charge lines) | V2-03 | Me | ⏳ |
| V2-06 | **Goods Check / Receipt module** (verify arrival; simple confirm; rejection/short/damage only as exception; Shipment/Bill/Receipt qty stay independent) | V2-03 | Me | ⏳ |
| V2-07 | **Vasy upload validation + generation from a Bill** (not a lot); one-click/auto per current architecture | V2-05, V2-06 | Me | ⏳ |
| V2-08 | **Central Exceptions view** | V2-04..07 | Me | ⏳ |
| V2-09 | Terminology sweep: "Lot" → "Shipment" in UI (DB names may lag) | V2-03+ | Me | ⏳ |

### Sequencing note
Build order: **V2-01 → V2-02 → V2-03 → V2-04 → V2-05 → V2-06 → V2-07 → V2-08 → V2-09**, shipping
and testing each before the next. Data model + migration first so the live system keeps working
throughout. Nothing is coded until you approve the plan (and each step's design as we reach it).

---

## V2 CHANGE LOG (filled as work lands)

_(empty — first entries land when V2-01 begins)_
