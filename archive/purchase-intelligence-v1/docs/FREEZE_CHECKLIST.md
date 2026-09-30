# FREEZE_CHECKLIST.md — V1 baseline

## Files captured (frozen, in /outputs)
- `VT_Purchase_Intelligence_V1.html` — dashboard, **v8.6 · Noyyal** ✅
- `PORequest_index_V1.html` — PO-Request UI ✅ (reconstructed from RTF; validated — eyeball before canonical)
- `PORequest_Thamirabarani_v9.gs` — Code.gs (requests/master/statuses/doGet) ✅
- `LiveApi_v7.2.gs` — tracking/meta/lots/receipts/suppliers + Supabase proxy + writeSheet ✅
- `RegisterApi.gs` — read-only Purchase_Register pull ✅
- `GoodsCheckApi_V1.gs` — getGoodsCheck() for PO-Request ✅
- `CHANGE_REGISTER_V1.md` — full V1 history ✅
- `CHANGE_REGISTER_V2.md` — V2 plan (build not started) ✅
- **This documentation set** (12 md files) ✅

## Files still MISSING / to confirm
- [ ] **Live deployed copies** of Code.gs / index.html — confirm the frozen copies match the deployed
      `/exec` (the request index was rebuilt from RTF).
- [ ] Exact **`/exec` deployment URL** and current **deployment ID** (kept privately, not in docs).
- [ ] The **Vasy → Supabase** ETL/pipeline definition (external; not in any captured file).
- [ ] Confirmation of authoritative **product master** (Products tab vs MASTER_ID workbook).

## Google Sheets to export privately (do this now)
- [ ] Register workbook → `Purchase_Register` tab (`1uBS4vD24…`)
- [ ] PO-Request workbook → `PO Requests, Products, Drafts, Settings, Names, Statuses`
- [ ] LiveApi tabs → `PO Tracking, Lots, Lot Lines, Receipts, PO Meta, Suppliers, Audit Log, Closed, Archive`
- [ ] Supplier workbook (`1Uc2ba4A…`) and Product master workbook (`1fVUY4J…`)
- [ ] Supabase `purchase_bill_data` — full export

## Must stay OUTSIDE GitHub (secrets — never commit)
- `VT_API_TOKEN`, `VT_SB_KEY` (Supabase service_role), `VT_PIN_SALT`, `VT_PIN_FOLLOW`, `VT_PIN_MGMT`
- The `/exec` URL + token pair (operational access)
- Any real invoice/party data exports

## Is the V1 baseline complete?
**Code + documentation: YES** — the running system's source and a full current-state doc set are captured
and internally consistent. **Data + live-deploy confirmation: PENDING the four "MISSING" items above**
(private sheet/Supabase exports, deployment URL/ID, Vasy→Supabase pipeline, master authority). Once those
four are confirmed/exported, the freeze is fully complete and V2 can begin against a safe baseline.
