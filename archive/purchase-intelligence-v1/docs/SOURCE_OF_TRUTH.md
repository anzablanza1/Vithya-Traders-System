# SOURCE_OF_TRUTH.md — V1 (frozen)

For each concept, the **current** source of truth. ⚠ = ambiguous / multiple sources.

| Concept | Source of truth | Notes |
|--------|-----------------|-------|
| **Purchase history** | **Supabase `purchase_bill_data`** | Fallback: `Purchase_Register` sheet tab (RegisterApi) or manual .xlsx upload. Cached in browser IndexedDB. |
| **Sales history** | **None (not integrated)** | EOQ/reorder use purchase outflow as a proxy. |
| **Stock** | **Vasy (not read live here)** | Dashboard does not surface live stock. "Received not uploaded" tracked operationally. **NEEDS LIVE VERIFICATION** if any stock number appears. |
| **Supplier list** | **Suppliers workbook** (SUP_SHEET_ID `1Uc2ba4...`) via LiveApi `api=suppliers` | |
| **Product master** (name/brand/cat/codes/prices/MRP) | **Products sheet tab** (Code.gs `getProducts`) | MASTER_ID `1fVUY4...` also referenced by Code.gs — **NEEDS LIVE VERIFICATION** of which is authoritative if they differ. |
| **PO (lines, status)** | **PO Tracking sheet tab** (via LiveApi) | Sheet is authoritative on sync; browser `PODOCS` is the working copy; `vt_outbox` guards unsynced. |
| **Pending qty** | **Derived** from Ordered − shipped/received via allocations/lots | Computed in dashboard; not stored. |
| **Transit qty** | **Derived** = shipped − received (from lots) | Computed. |
| **Received qty** | **Receipts sheet tab** (per poNumber+code) | Capped at ordered for status; excess tracked separately. |
| **Lot / shipment** | **Lots + Lot Lines sheet tabs** | Browser mirror in `PODOCS[].lots`. `lotNo` server-authoritative. |
| **Bill / material inward** | **On the lot** (Charges JSON / Totals JSON in Lots; Vasy Bill No) | ⚠ per-lot only (V2 changes this). |
| **Rate (cost)** | ⚠ **Multiple**: lot split/upload rate → PO line price → register last landing → master | `lineCostBest` precedence. |
| **MRP** | Master (GST MRP / NonGST MRP), else register lastMRP | Lane-specific. |
| **Selling price** | Register last sell → master selling (if any) → MRP; **never cost** | Lane-specific. |
| **Lead time / fill / OTIF / MOQ** | **Derived** in Analytics from register + lots | Populates only with enough completed cycles. |
| **PO meta** (approved/billed/promised/closed/cancel) | **PO Meta sheet tab** | Restored on sync (v6.6); cross-device. |
| **Notes — whole PO (to-dos)** | **PO Meta `Notes JSON`** | Editable/deletable; cross-device. |
| **Notes — per line** | **PO Tracking `Line Note` column** | Persists via LiveApi. |
| **Goods check status** | **Derived** from PO Tracking + Receipts + Lots + PO Meta | Dashboard computes; PO-Request via `getGoodsCheck()` (qty/status only). |
| **Analytics / Fund tables** | **Derived in browser**; optional snapshot pushed to sheet | `writeSheet` → `Analytics · …` / `Fund Planning` tabs for external fetch. |
| **Requests** | **PO Requests sheet tab** (Code.gs) | Dashboard reads via `api=data`. |
| **Change/audit log** | **Audit Log sheet tab** (server) + `vt_changelog` (local) | |
| **Access tiers / PINs** | **Script Properties** (hashed) via `api=security` | Salt+hash; never plaintext. |
| **Register last-pull meta** | `vt_reg_meta` (local) | Shown in Settings. |
