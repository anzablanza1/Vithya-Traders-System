# DATA_MODEL_CURRENT.md — V1 (frozen)

The exact V1 data model **before** the V2 shipment redesign. Weaknesses noted but **not changed**.

## Browser state (dashboard)
- `PODOCS[]` — the in-memory PO documents (the working model). Each PO doc roughly:
  - `poId` (internal), `realNo` (software/Vasy PO no, entered after upload), `supplier`, `lane` ('g'|'n'),
    `status`, `createdAt`, `sentAt`, `promised` (promised **ship** date), `expected`,
    `parentPoId` (for split children), `splitInto[]`, `closed`, `closedAt`, `closedBy`,
    `cancelReason`, `cancelledAt`, `approvedAt`, `billAt`, `snoozeUntil`, `notes[]` (to-dos),
    `lines[]`, `lots[]`, `receipts[]`.
  - **line**: `code`, `name`, `qty`, `price`, `uom`, `cancelledQty`, `reqLineIds[]` (origin request),
    `addedAt`/`addedOn` (added-in-edit/at-lot tag), `note` (per-line note), `exp`, `reSentAt`, `_pendingCode`.
  - **lot** (= a shipment, V1): `lotId`, `lotNo` (2-digit, server-authoritative), `date` (shipped),
    `expected` (delivery), `receivedAt`, `uploadedAt`, `miReadyAt`, `transport`, `lr`, `billG`, `billN`,
    `note`, `charges[]`, `roundG`, `roundN`, `vasyBillNo`, `_synced`, `lines[]` where each lot-line =
    `{i (PO line index), code, name, qty, g (GST split qty), n (Non-GST split qty), rate, tax, ret,
      upName, mrp, sp, flags[] (e.g. 'over-shipped','migrated')}`.
- Derived quantities (functions, not stored): `recvForLine`, `shipForLine`, `lineFunnel`
  (created/sent/pending/shipped/received/excess/cancelled), `poRollup` (status), `posDocProg`
  (ordered/received/transit/toShip), `poDates`/`poFollowDate`.

## Identifiers
- PO internal `poId`; user-facing `realNo` (Vasy PO no). PO number formats seen: `PO-DDMMYYNN`,
  `VTPO-YYYYMMDD-NN`. Lot id `lotId` + 2-digit `lotNo`; lot display `PO-...-NN` (`NN*` if unsynced).
- Canonical product code = code with trailing `/` stripped (GST/Non-GST share a canon).

## Local/browser storage keys (localStorage)
| Key | Purpose |
|-----|---------|
| `vt_session_v2` (PERSIST_KEY) | full session: PO cart, PODOCS, confirmed levels, assumptions |
| `vt_outbox` | durable write queue (failed/pending sheet writes, retried) |
| `vt_live_cfg` | `{url, token}` for the Apps Script web app |
| `vt_reg_meta` | last register pull meta `{at, n, src}` |
| `vt_lot_tomb` | tombstoned lot ids (prevent deleted lots resurrecting on sync) |
| `vt_code_alias` | permanent item-code adoptions (temp→ERP code) |
| `vt_charge_names` | remembered additional-charge names |
| `vt_changelog` | local change register ring buffer |
| `vt_po_counter` | local PO number counter |
| `vt_user_name`, `vt_theme`, `vt_density`, `vt_search_fuzzy`, `vt_cost_pw`, `vt_pins_v*` | prefs/security |
| `vt_req_user`, `vt_req_dl` | PO-Request-side prefs |
- **IndexedDB** `REG_DB` / store `REG_STORE` — cached purchase register rows (survives lock/reload).

## Google Sheets tabs (operational model) — see GOOGLE_SHEETS.md for columns
- **PO Tracking** — one row per PO line (poNumber, realNo, lineId, code, name, qty, poQty, lane,
  poStatus, supplier, expected, **Line Note**, …). Source of truth for PO lines.
- **Lots** — one row per lot (lotId, poNumber, lotNo, date, transport, lr, billG, billN, miReadyAt,
  **Received At (col 10)**, uploadedAt, note, expected(**col 15**), Vasy Bill No, Round Off GST,
  Round Off NonGST, Charges JSON, Totals JSON).
- **Lot Lines** — one row per lot-line (lotId, poNumber, lineRef, code, name, qty, gstQty, nonQty, rate,
  tax, ret, …).
- **Receipts** — received quantities per (poNumber, code).
- **PO Meta** — one row per PO: PO Number, Supplier, Approved At, Bill At, Promised, Snooze Until,
  Notes JSON, Updated At, By, **Closed At, Closed By, Cancel Reason, Cancelled At, Real No** (v6.6).
- **Suppliers** — supplier list (own workbook via SUP_SHEET_ID).
- **Audit Log** — every change (action, entity, before/after, by).
- **Closed / Archive** — closed/archived PO ids.
- **PO Requests / Products / Drafts / Settings / Names / Statuses** — PO-Request app (Code.gs).
- **Analytics · SKU Summary / Analytics · SKU Supplier / Fund Planning** — pushed by dashboard.

## Purchase register row shape (from Supabase `purchase_bill_data`, mapped by SB_COLMAP)
`bill_date, bill_no, voucher_no, party_name, department, category, sub_category, uom, product_type,
product_name, item_code, rate, qty, total_amount, tax_rate, tax_amount, gst_no` +
derived `__landing = rate + tax/qty`, `mrp`/`sell` **not present** in Supabase (come from master).

## Product master (Products tab, PROD_HEADERS)
`Canonical Code, Product Name, Brand, Category, Subcategory, GST Code, GST Price, NonGST Code,
NonGST Price, GST MRP, NonGST MRP`. (No selling-price column — selling derives from register/MRP.)

## Weaknesses V2 will replace (do NOT change in V1)
1. **Lot = one shipment inside one PO.** No cross-PO shipment; `lot.poNumber` is single-valued.
2. **Bill created per lot** → cannot represent one supplier bill spanning multiple POs/shipments, nor
   one shipment split across bills. This breaks tally for real multi-PO consignments.
3. No first-class **Shipment**, **Shipment↔PO allocation**, or **Bill↔Shipment allocation** objects.
4. Excess/off-PO handled ad-hoc on the lot rather than as explicit allocation classes.
5. Shipment/Bill/Receipt quantities are not independently modelled (lot conflates them).
