# SUPABASE_DEPENDENCIES.md — V1 (frozen)

## Project
- URL: `https://kssydapdfmkfufrqhwzp.supabase.co`
- Access: **server-side only** via LiveApi using the **service_role** key in Script Property `VT_SB_KEY`.
  RLS is **not** relied upon (service-role bypasses it). The browser never holds the key (v7.2 change;
  the older browser-side anon pull is deprecated/removed).

## Tables/views actually used
| Object | Type | Used by | Fields consumed (via `SB_COLMAP`) |
|--------|------|---------|-----------------------------------|
| `purchase_bill_data` | table | LiveApi `api=register` → dashboard register | `bill_date, bill_no, voucher_no, party_name, department, category, sub_category, uom, product_type, product_name, item_code, rate, qty, total_amount, tax_rate, tax_amount, gst_no` |

Derived client-side (not columns): `__landing = rate + tax_amount/qty`. MRP/selling are **not** in
Supabase — they come from the Products master sheet.

## Consumers
- **Server:** `apiRegister_` in `LiveApi_v7.2.gs` (paged REST GET, `?select=…&limit=…&offset=…`).
- **Client:** `sbPull()` → `vtApiGet('register', {offset,limit})` loop → `SB_COLMAP` → IndexedDB cache.

## Not used / unknown
- No Supabase **functions/RPC** or **views** are called by V1 (only the one table via REST).
- **How `purchase_bill_data` is populated from Vasy** (FTP/API/ETL, cadence) is **external** and
  **NEEDS LIVE VERIFICATION** — not defined in these files.
