# DECISIONS

Why the system is built the way it is. Each entry: the decision, the reason,
and the alternative that was rejected where known. This is the "why" behind
`ARCHITECTURE.md` and `BUSINESS_RULES.md`.

---

### D1. Build around Vasy, never replace it
Vasy stays the system of record. Everything here reads from Vasy and computes;
nothing writes back except the reconciliation sign-off (and even that is a
separate table, not a change to Vasy). **Rejected:** replacing Vasy, or
two-way sync — both add risk with no benefit to the actual need (fast, honest
answers).

### D2. Supabase as the durable warehouse; Google Sheets as computation
The owner's stated principle: Supabase holds the real, complete data because
it connects to versatile tools and runs fast queries; Google Sheets is fine
for computation and staging, but the authoritative copy lives in Supabase.
**Reason:** Apps Script/Sheets cannot connect to arbitrary tools or the API as
freely as Supabase can. **Rejected:** Sheets-only (hit ~12M-cell limits and
was slow) and Supabase-only (Apps Script is still the easiest way to reach the
Vasy API and Google Sheets).

### D3. Two ingestion paths — FTP for bulk, API for the rest
FTP is free, unlimited, and carries most datasets in bulk, so it feeds the raw
tables. The API fills what FTP does not carry (invoices) and acts as failover.
**Rejected:** API-only (rate limits make full history impractical) and
FTP-only (no invoices, no live pulls).

### D4. `sales_data` is raw and untouchable; other sources in their own tables
So the system can always answer "what did Vasy actually send" and so the FTP
pipeline's delete-by-voucher never collides with backfilled rows. `v_sales_all`
reconciles them with a source rank. **Rejected:** one big sales table with a
source column — it destroys the raw record and makes the delete logic unsafe.

### D5. `sales_ftp_gap` as a separate, deletable table
When FTP is down, API-pulled sales go into their own table, ranked below FTP,
so that once FTP catches up the table can simply be truncated. **Reason:** the
owner explicitly wanted the failover data to be cleanly removable. **Rejected:**
writing failover rows into `sales_history` (harder to isolate and delete).

### D6. Read models for dashboard speed
Dashboards read tiny pre-computed blobs, not the whole analytics table.
**Reason:** reading 6,973 × 63 cells on every click made screens unusable.
**Rejected:** live queries from the browser on each load.

### D7. Dashboards over Apps Script, not direct Supabase from the browser
The service key can read and delete everything, so it must never sit in a
browser. Supabase-backed screens go through an Apps Script proxy that holds the
key server-side. **Rejected (for now):** an `anon` key + RLS SELECT policies —
more moving parts and a bigger attack surface for no current benefit; revisit
only if a screen is demonstrably too slow.

### D8. The floor shows no cost/supplier/margin
A deliberate business choice so counter staff (and anyone over their shoulder)
never see buying prices or suppliers. Enforced in code and tested.

### D9. Reconciliation by agreed opening balance, not invoice-by-invoice repair
Pre-April receipts were not always entered, so old invoice-level outstanding
is unreliable. Rather than chase thousands of old invoices, agree one opening
balance per customer as at 1 Apr 2026 and run cleanly forward. **Rejected:**
trying to reconstruct historical settlement from data that does not exist.

### D10. Vasy `balance` is the receivables truth
Because traced receipts only start 17 Aug 2026, the invoice's own balance
(from Vasy) is trusted over anything computed from receipts. **Rejected:**
computing outstanding purely from traced receipts (would understate massively).

### D11. Split the nightly chain into four jobs
Apps Script triggers get ~6 minutes; the chain is ~16. Splitting into
`nightlyRollup / Customers / Stock / Models` lets each finish. **Rejected:**
one combined `nightlyAnalytics` (died part-way, silently).

### D12. `erp_snapshot` as the product master, not `product_data`
The FTP `product_data` export is a delta and never completes. The API ERP
snapshot has the full ~13,700 products. **Rejected:** waiting for Vasy to fix
the FTP product export (may never happen; workaround already works).

### D13. Calibrated stock (`api − offset`)
Vasy returns the sum of all financial years' stock because the year-end
rollover was never run. A measured offset corrects it. **Rejected:** running
the Vasy rollover (owner's operational decision, not taken yet) — until then,
calibration is the safe workaround.

### D14. `whatIsLive()` as the source of truth for "what is running"
Because Apps Script silently shadows duplicate function names, the only
reliable way to know what is live is to read the live function bodies. This
diagnostic exists precisely because "I pasted the fix" has been wrong before.

### D15. Prefer the working caller over re-deriving API constants
Every Vasy endpoint constant (page size, date format, list key, path) is read
from the proven working caller rather than guessed. **Reason:** guessing these
repeatedly cost debugging cycles; the correct values were always already in
the working code. See `CHANGELOG.md`.

### D16. Version 1 preservation before any redesign
This knowledge base and a GitHub repository come **before** any new
architecture, so the working system is fully recoverable first. (This document
set is that step.)
