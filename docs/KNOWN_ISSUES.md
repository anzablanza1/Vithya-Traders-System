# KNOWN_ISSUES

Current bugs, unreliable data, performance issues, technical debt, and
assumptions that need checking. Ordered roughly by importance.

---

## Open bugs

### K1. `ofcActions_` runs an OLD version in the live project — OPEN
`whatIsLive()` reports `ofcActions_` and (previously) `buildPoStatus` as OLD,
meaning an **older `.gs` file is shadowing** the current definition. Effect:
the office "below cost" action grouping is wrong. Everything else on the
office screen is fine.
**To fix:** in the Apps Script editor, search `function ofcActions_`. If two
files define it, delete the older. If only `OfficeAPI.gs` does, that file is a
stale paste — check it contains `CHECK COST` and re-paste if not. Re-run
`whatIsLive()` until it reads NEW. **The owner must do this in the editor.**

### K2. `overflow:hidden` disables sticky headers — FIXED, watch for recurrence
Any `overflow:hidden` on a table or an ancestor silently kills
`position:sticky`. Fixed on the recon screen. If a future screen's header
won't freeze, check for this first.

---

## Unreliable / incomplete data

### K3. Receipts only from 17 Aug 2026
The FTP receipt feeds began carrying `db_invoiceno` on 17 Aug 2026. Before
that there is **no receipt→invoice link**. `receipt_register` (the export) has
the totals but no invoice id. Any statement about pre-17-Aug settlement is a
statement about missing data. **Blocked on Vasy** providing a receipt export
with invoice db ids (request raised). Until then, reconciliation uses the
agreed-opening-balance model.

### K4. Landing cost unreliable in old sales rows
"Below cost" lines: FTP 0.5%, this-year 1.7%, FY24-25 9.2% — the older the
data, the more false losses. **Pre-2026 margin is not real.** This-year margin
(~25%) is sound. Do not report historical margin as fact.

### K5. `product_data` FTP export is broken
~117 rows of ~13,685; it is a delta export that never completes. **Use
`erp_snapshot` (full ~13,700) instead.** Do not treat `product_data` as a
product master.

### K6. Purchase history sparse before Apr 2026
Proper purchase entry began this financial year. Earlier purchase data is thin
**by fact of the records**, not a pipeline fault. Label any purchase screen
accordingly so a blank 2025 is not misread.

### K7. Stock is calibrated, not raw
Live stock = `api − offset` because Vasy sums all financial years (the
year-end rollover was never run). The offset was measured once against the
Stock Register. **Recalibrate on 1 April** and whenever the rollover is run,
or stock figures drift.

### K8. `customer_master` name quality
Many customer names are just `.` or blank in the sales feed; they are resolved
via `contact_id`. The team is renaming at source (slow). Phones in
`v_customer_360` scraped from address text are UNVERIFIED. "No orders in feed"
does not mean a customer never bought.

---

## Performance / operational

### K9. `Cost_Current` sweep crawls
The cost sweep (`refreshCostCurrent`, `/product/details`) runs against the
~5/min rate limit, ~20 per run, and can pause on a productId validation error
(`Please validate productId ...`). It resumes next run via its cursor. It has
been stuck around 6,000–6,800 of 13,560 for a while. **Low urgency** (the ERP
snapshot covers current price/qty), but it means Cost_Current is not a
complete cost source.

### K10. FTP intermittently down
The FTP feed has stopped for multi-day stretches (complaint raised with Vasy).
While down, raw `*_data` tables freeze; sales are covered by the failover into
`sales_ftp_gap`; **receipts and purchases go stale** until it resumes. Run
`clearFtpGap()` after FTP catches up.

### K11. Free Supabase plan
Project is on the Free plan (at snapshot). VERIFY headroom (row limits, egress)
before large new workloads.

---

## Technical debt

### K12. Duplicate / superseded `.gs` files
The project holds many old probe and superseded files (see `APPS_SCRIPT.md`).
At least one is shadowing a live function (K1). They should be deleted in
small batches with `whatIsLive()` run after each. **Not yet done.**

### K13. Supabase view/table SQL not yet exported to the repo
The view definitions live only in the database. Until exported (see
`FILES_TO_COLLECT.md`), the live DB is the single copy of the view logic — a
recovery risk.

### K14. "Security Definer" linter warnings
Every view is flagged CRITICAL by the Supabase linter. Not currently
exploitable (no anon key in use), but it is real debt if the anon key is ever
exposed. See `SECURITY.md`.

### K15. No Git / no staging
Changes go straight to live by manual paste. Mitigated by guards and
`whatIsLive()`, but there is no version history or rollback yet. This KB +
GitHub is the first step to fixing it.

---

## Assumptions to verify

- **VERIFY** the live trigger set and the live `.gs` file list against
  `whatIsLive()` and the editor — the docs describe the intended set.
- **VERIFY** exact Vasy endpoint query params against the live callers before
  reusing them.
- **VERIFY** whether any pg_cron / Edge Function schedule exists in Supabase
  (assumed none).
- **VERIFY** which HTML dashboards are served from the Apps Script project vs
  opened as local files vs hosted, and where each hosted copy lives.
- **VERIFY** the exact Google Sheet workbook IDs and names (held in Script
  Properties).
