# FTP V2 recovery deployment status — 2026-11-19

## Confirmed
- Hostinger contains pending daily CSVs from 2026-10-13 onward, and pre-cutoff historical/partially processed exports.
- Original 95.23 MiB SalesInvoiceData_21024_09102026_161104.csv is historical; do not replay it with the daily loader.
- Original vt_ftp_sync.php --check reached a historical file and safely stopped at its 24 MiB size limit. No CSVs imported by the check.
- Existing production RPC public.vt_ftp_replace_document(text,jsonb) replaces complete document lines atomically but does not track export versions.
- New public.vt_ftp_replace_document_v2(text,jsonb,text) and public.vt_ftp_document_versions installed on Supabase project kssydapdfmkfufrqhwzp. SQL candidate compiled in BEGIN/ROLLBACK before installation. Objects verified after installation.
- PHP V2 candidate committed in hostinger/vt_ftp_sync.php on branch fix/ftp-safe-loader-20261119. **Not yet deployed on Hostinger**.
- No CSV apply and no database import tested under V2. All former HTTP cron jobs must stay OFF.

## Design
- Only candidate CSV filenames stamped >= 2026-10-13 are eligible for normal import. Older pending *.csv remain intact for separate audit; *.csv.processed remain excluded.
- Importer groups lines into complete document by dataset-specific key, invokes a transactional RPC, and only renames file after all document acknowledgements succeed.
- RPC holds per-document advisory transaction lock and records newest export timestamp plus canonical JSON hash in vt_ftp_document_versions.
- Older versions are skipped, identical repeated versions skipped, and equal-timestamp/different-content fails closed.
- Current conservative shrink guard rejects dropping to less than 40% of existing lines. Review legitimate shrink exceptions manually.
- ProductData still disabled due nonunique product/batch identity; API fallback remains separate.

## Next safe step
1. Back up Hostinger's currently installed /home/u631621082/vt_ftp_sync.php.
2. Upload the GitHub branch's NEW hostinger/vt_ftp_sync.php to the same private path. Keep vt_ftp_schema.php and supabase_key.txt unchanged. Never share secret contents.
3. Run temporary **check-only** Custom Cron (then delete it):
   /usr/bin/php /home/u631621082/vt_ftp_sync.php --check --max-files=10
   Use Hostinger View Output and confirm earliest eligible file. This should no longer stop on the Oct 9 historical file.
4. Before any --apply: capture full CHECK output and independently inspect first eligible file and Supabase baseline.
5. Perform controlled oldest-file one-file apply only after validation, confirm row/document amounts, .processed rename, and version ledger.
6. Validate restart/retry and older-export-order safeguards; only then enable small bounded backlog batches and later a single CLI cron.
7. After full backlog: run sql/ftp_post_import_audit.sql; verify FY boundary, document counts/totals, holidays and overlaps.

## Caveats
- Filename export timestamp is a proxy for recency; a backdated snapshot pushed under a newer filename could still override fresher business edits. Audit Vasy export semantics.
- No automatic deletion if a record is absent from a subsequent daily file; cancellations/deletions need separate policy.
- Version ledger starts empty; the first V2 application establishes its watermark even for documents that already exist.
- Older partially processed Oct 9–12 files are excluded from the normal loader, not declared reconciled or discarded.
- Keep this draft PR unmerged until real Hostinger test passes.

## Hostinger first live test — 2026-11-19 (verified)

- User deployed V2 PHP and ran `--check --max-files=10`: **SUCCESS files=10 lines=1012 mode=CHECK**. Old October 9 historical file no longer blocks this daily recovery check.
- `--apply --file=VendorData_21024_13102026_021942.csv` succeeded, zero rows; Hostinger renamed it to `.csv.processed`.
- `--apply --file=MaterialInwardData_21024_13102026_021946.csv` succeeded with 23 lines grouped into three documents; Hostinger renamed it to `.csv.processed`.
- Independently confirmed live Supabase records:
  - MI3098, inward_date 10/10/2026: 9 rows
  - MI3099, inward_date 28/09/2026: 7 rows
  - MI3100, inward_date 28/09/2026: 7 rows
  - All source=FTP and three corresponding ledger entries with export_stamp=20261013021946.
- Older business dates inside a newer export are expected and important; export timestamp is not the same as transaction date.
- **Not yet tested:** duplicate-safe replay, older-version skip, same-timestamp-content conflict, interrupted batch retry, and larger daily batches.
- **Next:** process October 13 PurchaseReturn (zero rows) and SalesInvoice (917 rows/112 IDs) in a controlled two-file batch. Confirm Supabase row counts, ledger entries, amounts and stop on any error. Keep the permanent cron disabled.

## Second controlled batch — 2026-11-19 (independently verified)

- User ran `/usr/bin/php /home/u631621082/vt_ftp_sync.php --apply --all --max-files=2`.
- Hostinger reported PurchaseReturnData_21024_13102026_021947.csv, 0 lines, processed; SalesInvoiceData_21024_13102026_021952.csv, 917 lines / 112 invoice IDs, processed.
- Final Hostinger result: `SUCCESS files=2 lines=917 mode=APPLY`.
- Live read-only Supabase checks: 112 sales ledger entries, all 112 IDs present, exactly 917 current lines across those IDs, loaded during 17:33–17:34 UTC.
- Total sales rows changed 226457 -> 227088; distinct invoice IDs 38893 -> 38970. This is consistent with document replacement, not naive append; a full duplicate audit and replay test are still outstanding.
- Total version entries now 115: 112 sales and 3 material inward.
- Keep permanent cron disabled. Next test should check unchanged version replay and older-version rejection safely, without rewriting existing sales data. Do not claim these have passed yet.

## Transactional retry/order verification — 2026-11-19

- SQL tests invoked live installed `public.vt_ftp_replace_document_v2` **within explicit BEGIN/ROLLBACK transactions only**, with session claim role set to service_role; no lasting test data or document changes.
- Existing sales invoice DB ID 102465374 (current export stamp 20261013021952) was tested with earlier stamp 20261012021952 and a minimal payload: RPC responded `status=skipped_older`, `current_stamp=20261013021952`. No sales modification.
- Synthetic vendor ledger entry for `FTP_V2_RETRY_TEST_DO_NOT_SAVE`, matching payload hash and export stamp, was tested with RPC: `status=skipped_same`. Entire transaction rolled back, synthetic ledger row not retained.
- This verifies core RPC branches. It does not yet verify recovery after PHP process interruption, or every dataset-specific key.
- Next controlled step: one scheduled `/usr/bin/php /home/u631621082/vt_ftp_sync.php --apply --all --max-files=10`, only after confirming no other apply cron exists. Check output for `SUCCESS` and `PROCESSED`, stop on first error, delete temporary cron and audit Supabase row/ledger effects before expanding further.

## Third controlled batch — 2026-11-19 around 23:26 IST
- Hostinger screenshot: `SUCCESS files=10 lines=124 mode=APPLY`; last visible files processed include ProductConsumptionAndWastageData_21024_13102026_024255.csv (header-only), CreditNoteData_21024_13102026_024256.csv (header-only), StockAdjustmentData_21024_13102026_024256.csv (31/31), VendorData_21024_14102026_021934.csv (3/3), MaterialInwardData_21024_14102026_021938.csv (18/3).
- Independently verified live Supabase: stock adjustment 31 rows / 31 keyed documents, vendor 3/3, material inward 18/3. Version ledger contains matching 31, 3, 3 document-version entries for their respective export stamps.
- Entire backlog is NOT complete. Keep full recovery audit and permanent cron enablement pending. Operator must delete completed temporary cron before next bounded run.

## 20-file batch stopped on shrink guard — 2026-11-19 around 23:38 IST

- Hostinger output: `STOPPED SalesInvoiceData_21024_15102026_020753.csv: Supabase RPC HTTP 400 ... Shrink guard: 1 incoming against 9 live`. No overall success; file must remain `.csv`.
- Earlier completed files reported `PROCESSED`, including October 15 MaterialInwardData_21024_15102026_020740.csv (20 rows/3 docs) and header-only PurchaseReturn.
- Read-only Supabase: 167 version entries for `sales_data` with export_stamp `20261015020753`, against 203 invoice documents reported by Hostinger for the stopped CSV. Thus per-document commits occurred before stop. Retry is designed to skip identical committed versions, but this exact partially failed file has not yet been replay-tested.
- Do not weaken 40% shrink guard or manually rename failed CSV. Need exact offender invoice ID and side-by-side 9 previous lines vs 1 incoming line from uploaded CSV; distinguish legitimate correction from incomplete export. No further cron until reviewed.

## Verified Oct 15 invoice shrink exception installed (Nov 19)
- User checked Vasy invoice `VTMIN2627-1155` (invoice DB ID `112464397`) and confirmed its current complete invoice is **one item gn13, qty 1, ₹38,000**; prior Supabase document had 9 lines.
- Uploaded `SalesInvoiceData_21024_15102026_020753.csv` was locally inspected: exactly one matching invoice row with voucher `VTMIN2627-1155`, item `gn13`, qty 1.0, net amount 38000.0.
- Applied narrow, version-specific exception in Supabase `vt_ftp_replace_document_v2`: allows shrinking **only** invoice DB ID 112464397, export stamp 20261015020753, existing lines 9 -> incoming 1, voucher/item/qty/amount exact. All other shrink guards remain active.
- GitHub SQL file `sql/ftp_v2_verified_shrink_exception_20261015.sql`. Its syntax passed transaction-only BEGIN/ROLLBACK validation before production CREATE OR REPLACE FUNCTION.
- **No retry or CSV apply performed** after this exception; original file should remain `.csv`. Next run only `--apply --file=SalesInvoiceData_21024_15102026_020753.csv`; validate PROCESSED and Supabase invoice after execution. 167 documents previously committed may report skipped_same. Stop if any other shrink mismatch surfaces.

## Oct 15 sales file retry successful — verified live after targeted correction
- User executed `--apply --file=SalesInvoiceData_21024_15102026_020753.csv`; Hostinger output `SUCCESS files=1 lines=1441 mode=APPLY`, `PROCESSED`, checksum `6d6c9b06f23dfb41e6aceb9ab53cf5fb2d78b36242c01202d00894d3abc9d88d`.
- Live Supabase verification: 203 version-ledger entries for `sales_data`, export `20261015020753`; all 203 invoice DB IDs present and currently exactly 1,441 lines total.
- Vasy-confirmed corrected invoice `112464397` / `VTMIN2627-1155` now exactly one row `gn13`, qty 1, net_amount 38000, source FTP, loaded 2026-11-19 18:30:49 UTC. Old 9-line document replaced.
- Current full `sales_data`: 228,049 lines, 39,157 distinct invoice DB IDs at verification.
- The exception is currently embedded in RPC V2, restricted to exact invoice/export/amount/qty and prior row count; retain and later remove/reconcile as part of permanent configuration.
- This validates successful recovery of one interrupted multi-document CSV. Entire Oct-Nov backlog and cross-dataset audits remain outstanding. Old cron stays disabled.

## 2026-11-20 — Oct 16 shrink guard on invoice 126039277

- Oct 16 controlled batch halted at `SalesInvoiceData_21024_16102026_020156.csv`: RPC shrink guard `1 incoming against 5 live`. Hostinger indicated 862 lines / 106 invoice documents. By the stop, Supabase had 93 version ledger entries for that export, representing 762 current invoice lines. Do not regard the failed file as fully committed.
- Uploaded CSV verified one line for DB ID `126039277`, voucher `VTMIN2627-2409`, date `21/09/2026`, item `gn13`, qty `1.0`, net amount `90104.999`. User checked Vasy and confirmed the invoice has **one line**.
- Existing Supabase data still had five lines for this invoice before retry, with no version entry for this Oct 16 export.
- Installed updated V2 RPC with a **strict second shrink exception** requiring exactly this ID, export timestamp `20261016020156`, previous five lines, one incoming line, matching voucher/item/quantity/amount. Earlier Oct 15 exception is retained. The amended function passed `BEGIN/ROLLBACK` compilation before installation.
- GitHub source for this scoped update: `sql/ftp_v2_verified_shrink_exception_20261016.sql`.
- **No live CSV retry has been executed yet.** Next controlled step: run `--apply --file=SalesInvoiceData_21024_16102026_020156.csv` once; stop on error, then verify the corrected invoice and 106 version entries / 862 current lines. Keep permanent cron off.

## Systemic sales-shrink policy — 2026-11-20
- User confirmed Vasy one line on invoice DB IDs 124205048 and 122968208; existing Supabase had four lines for each. Uploaded October 16 CSV has one gn13 line each, net_amount 85904 and 95650.999 respectively.
- Implemented sales-only audit-and-replace policy in live V2 RPC. For any NEWER sales export containing fewer invoice lines than existing, audit table public.vt_ftp_document_shrink_audit records table, document, export stamp, prior/incoming counts, voucher and pending review status. Then atomic document replacement proceeds. Other datasets preserve the old 40% shrink guard.
- Existing per-document export timestamps, replay idempotency, RPC locks, CSV header checks and safety stops remain. Audit entries do NOT prove every export is complete; validate changed invoices and totals against Vasy after backlog.
- Source committed at sql/ftp_v2_sales_shrink_audit_policy.sql. SQL syntax checked inside rollback transaction, then deployed to live project. Audit table exists; service_role can invoke RPC; anon cannot.
- No CSV imported by this schema change. At deployment: 98/106 versioned October 16 invoices, zero audit rows, and both verified candidate invoices still had four old lines.
- Next: one-file controlled retry of SalesInvoiceData_21024_16102026_020156.csv; then verify 106 invoice versions, 862 current sales lines, exact two invoice corrections, and shrink audit records. Permanent cron stays disabled.

## October 16 sales file completed after systemic shrink policy — 2026-11-20
- Hostinger output for `SalesInvoiceData_21024_16102026_020156.csv`: `SUCCESS files=1 lines=862 mode=APPLY`; file renamed `.csv.processed`.
- Read-only live Supabase validation: export stamp `20261016020156` now has **106 versioned invoice documents**, all 106 present in `sales_data` with exactly **862 current lines** among those invoice IDs.
- Invoice DB ID `126039277`, voucher `VTMIN2627-2409`: one line gn13 qty 1 net 90104.999 (previously 5).
- Invoice DB ID `124205048`, voucher `VTMIN2627-2250`: one line gn13 qty 1 net 85904 (previously 4).
- Invoice DB ID `122968208`, voucher `VTMIN2627-2139`: one line gn13 qty 1 net 95650.999 (previously 4).
- Shrink audit captured 2 rows in `public.vt_ftp_document_shrink_audit` for the latter two 4-to-1 replacements, both initially status pending. The 5-to-1 invoice was committed under the previous exact exception, thus not backfilled into the new audit.
- Full `sales_data` at validation: 228680 rows and 39240 distinct invoice DB IDs. No entire-backlog completeness claim. Continue bounded chronologically ordered imports; keep permanent cron disabled.

## October 17 controlled batch — 2026-11-20
- Hostinger screenshot of `--apply --all --max-files=20` ended `SUCCESS files=20 lines=1243 mode=APPLY`, with final processed file `StockAdjustmentData_21024_17102026_020350.csv`. Other file rows and exact set of 20 not individually reconciled from screenshot.
- Read-only Supabase V2 version ledger checks for October 17 export stamps: vendor_data 1, material_inward_data 7, sales_data 145, cash_receipt_data 45, bank_receipt_data 19, purchase_bill_data 15, stock_adjustment_data 13.
- Verified all 145 October 17 versioned sales invoice IDs are present in sales_data, with exactly 906 current lines across them.
- Full sales_data currently 229204 lines, 39324 distinct invoice IDs.
- Shrink audit table now has 3 pending entries; new October 17 `VPOS2627/13109` / DB ID `129909242`, 22 existing lines -> 19 incoming lines (requires Vasy review later). Previous Oct 16 entries are 124205048 and 122968208, both user-confirmed one-line corrections; review_status not yet changed.
- This is a completed controlled batch, not proof of full FTP backlog or date coverage. Run the next bounded 20-file batch, inspect output and verify, then eventually reconcile missing dates and totals. Keep permanent cron disabled during recovery.

## October 31 timed-out sales file recovered — 2026-11-20
- A 200-file Hostinger batch encountered `Supabase RPC HTTP 500` / PostgreSQL `57014 canceling statement due to statement timeout` at `SalesInvoiceData_21024_31102026_020148.csv`. Before retry, zero documents for export `20261031020148` were versioned; earlier Oct 31 vendor (1) and material inward (15) documents were committed.
- Found no btree index on `public.sales_data(invoice_id_db_id)`, despite importer V2 filtering, counting and deleting by that column. Live Supabase index created: `CREATE INDEX IF NOT EXISTS idx_sales_invoice_id_db_id ON public.sales_data (invoice_id_db_id);`. `EXPLAIN` confirmed `Index Only Scan using idx_sales_invoice_id_db_id`. Database statement_timeout was 120000 ms.
- User performed one-file controlled retry `--apply --file=SalesInvoiceData_21024_31102026_020148.csv`; output `SUCCESS files=1 lines=666 mode=APPLY` and `PROCESSED`. SHA256 `9c3a4b2d9fe58276d71c64c33def76687f13e04e626fda59ba86e8c4bfae1a37`.
- Live Supabase verification: 100 invoice version entries for export `20261031020148`; all 100 invoice IDs present, exactly 666 current lines; no shrink audit events with this export stamp. Full sales_data at validation: 233060 lines, 40096 distinct invoice DB IDs.
- Follow-up: record index migration in GitHub SQL if not already committed. Continue with bounded batches (prefer 50–100 per run rather than 200 until duration/limits established); keep permanent cron disabled pending backlog/date/completeness audit.

## 2026-11-20 — October 9 historical snapshot audit, READ ONLY, NO REPLAY
- Confirmed through live PHP importer code: $earliestSafeDate='20261013' explicitly excludes the Oct 9-12 historical/unprocessed CSVs. "No eligible unprocessed CSV files found" therefore does NOT imply all historical data complete. ProductData remains intentionally disabled.
- Local inspected Oct 9 bulk snapshot row counts: SalesInvoiceData 225705 (38781 invoice IDs; April 2025-October 2026); PurchaseBillData 10658 (2961 purchase vouchers; includes 2024 historical bills); MaterialInwardData 10077 (2796 inward numbers; April 2025-October 2026); StockAdjustmentData 29175 (stock transaction rows, Mar 2025-Oct 2026); PurchaseReturnData 3; ProductConsumptionAndWastageData 0. Additional Oct10-11 smaller files and Oct12 header-only files remain excluded. No writes were made.
- Read-only monthly sales line-count AND summed net_amount comparisons between Oct9 CSV and live sales_data: exactly matching at month level Apr2025-Mar2026. Later differences:
  Apr2026 CSV 15411 lines / 11169884.18 vs DB 15418 / 11266124.01;
  May2026 13053 / 10833882.33 vs DB 13052 / 11611197.70;
  Jun2026 13593 / 11326115.37 vs DB 13581 / 12363284.64;
  Jul2026 16833 / 13447689.89 vs DB 16833 / 14549832.00;
  Aug2026 14972 / 12258151.48 vs DB 14969 / 16340730.09;
  Sep2026 15274 / 14418898.77 vs DB 15263 / 16912752.16.
  Sum Apr-Sep increases around 9589298.58, NOT proof of added sales; later corrected invoice values can legitimately change earlier months.
- Specific material discrepancy requiring Vasy verification: invoice 121836283 / VTMIN2627-2015 dated Aug 27 2026 has Oct9 CSV one line gn13 net_amount 135, while live Supabase one line gn13 net_amount 716771 from export stamp 20261015020753. This is a 716636 difference and must not be overwritten with the older snapshot. Another sample invoice 120326792 old IP80V47582T 290.01, current gn13 net 89774, latest stamp 20261117020223. August CSV has five gn13 rows totaling 675; live DB has 49 gn13 lines totaling 4099783; high-impact revisions warrant independent Vasy checks.
- PurchaseBill monthly counts/amounts match Oct9 snapshot exactly from Apr2025-Mar2026, but diverge Apr2026 onward; DB contains more 2024 purchase-bill rows than Oct9 snapshot. MaterialInward DB likewise contains 2024 rows absent from Oct9 CSV, so snapshot is NOT a complete universal historical authority. StockAdjustment monthly counts and adjusted quantities show historical discrepancies especially Apr2025 and Apr2026, requiring composite-key row-level audit.
- Three purchase-return vouchers in Oct9 CSV exist in live DB, with 1 row each. Four uploaded ProductConsumptionAndWastage Oct9-12 CSVs are header-only (0 data rows).
- **Do not remove cutoff or replay old bulk CSV into live tables.** Correct policy: preserve latest per-document export version; stage Oct9 historical CSVs read-only, compare row identities, quantities, amounts, tax, line counts and voucher statuses against DB, classify newer-version revisions vs missing/stale/mismatched docs, and only make approved selective changes. Do not delete records absent in Oct9 snapshot, given differing historical coverage. Keep ProductData disabled.
- This is INITIAL aggregation/sample audit, not complete document-level or financial reconciliation. Avoid declaring recovery complete until row-level diff and missing-date review is performed.

## User-confirmed Vasy value and expanded discrepancy review — 2026-11-20
- User verified invoice DB ID 121836283 / VTMIN2627-2015: correct Vasy value is **716771.000**. October 9 snapshot value 135 was outdated; live Supabase already shows 716771. Mark this item approved/current-correct, DO NOT revert.
- Additional high-priority sales discrepancies confirmed by direct read-only lookup vs locally inspected Oct 9 historical CSV (user Vasy confirmation pending):
  - 120504347 / VTMIN2627-1881 / 19 Aug 2026: gn13 old 135, live 85367.
  - 120504453 / VTMIN2627-1882 / 19 Aug 2026: gn13 old 135, live 77266.
  - 120504536 / VTMIN2627-1883 / 19 Aug 2026: gn13 old 135, live 84960.
  - 120504622 / VTMIN2627-1884 / 19 Aug 2026: gn13 old 135, live 86288.
  - 120326792 / VTMIN2627-1855 / 18 Aug 2026: old item IP80V47582T net 290.01, live gn13 net 89774.
- A partial, user-editable workbook `VT_Historical_Discrepancies_Initial_Review.xlsx` was generated on the conversation surface; it **does not represent every historical discrepancy**.
- Prepared local read-only PHP helper `vt_historical_audit_readonly.php` for private Hostinger placement. It uses existing private Supabase key and V2 schema, compares one Oct 9 historical CSV against the full current table per run, outputs private discrepancy CSV, does no DB writes or file renames. Static `php -l` syntax check passed; no live execution yet. This helper is NOT deployed or integrated into cron; operator must upload and first run it separately under control before results can be certified.
- Need full execution of per-dataset audit (sales, purchase bills, material inward, stock adjustments, purchase returns), careful comparison of later Oct10–12 revisions, and classification of missing/current-only records. No historical replay has been authorized.

## 2026-11-20 — Sales Oct09 audit CSV and confirmed six corrections
- User uploaded `AUDIT_SalesInvoiceData_Oct09_vs_Live_20261119_205109.csv` generated from read-only historical audit: 830 flagged invoice document rows; discrepancy_category counts OTHER_FIELDS_OR_LINE_CONTENT_CHANGED=705, AMOUNT_CHANGED=114, LINE_COUNT_CHANGED=11. This is the source's own classification, not proof that all records are financially wrong.
- User confirmed current larger values for invoice DB IDs 120504347 (85367), 120504453 (77266), 120504536 (84960), 120504622 (86288), 120326792 (89774), as well as previously confirmed 121836283 (716771). The Oct09 smaller values are outdated; DO NOT revert these six.
- Prepared on conversation surface `VT_Sales_Oct09_vs_Live_All_830_Review.csv`, preserving all 830 rows and adding priority and review status: 6 approved; 84 remaining HIGH net amount differences >=10000; 25 MEDIUM net amount differences >1; 715 LOW / no material numeric differences (including 705 other-field-only mismatches and minor rounding effects). Thresholds are review heuristics, not accounting materiality rules.
- The 705 OTHER_FIELDS group have matching document lines, aggregated quantities, net amounts and taxes, but may still have substantive line-level or metadata changes. A later detailed column-by-column comparison can establish which are innocuous.
- All classifications are read-only, approval recorded in review CSV only. No write/repair to Supabase. Need user to inspect HIGH differences and independently approve or flag.

## 2026-11-20 — crosscheck Oct09 sales discrepancies against live Vasy Sales Item Register
- User provided `Sales-Item-Register-21024-5.xlsx`, 106216 item rows, covering the later fiscal-year period (all previously flagged invoices in Apr-Oct 2026 were found; the FY25-26 sample wasn't present). Streamed direct worksheet data; no DB changes.
- Joined the Vasy live report by exact voucher_no to all 830 historical discrepancy rows from `AUDIT_SalesInvoiceData_Oct09_vs_Live_20261119_205109.csv`.
- **686 of 830 flagged invoices appeared in the new Vasy register. Every one of the 686 matched the previously audited live Supabase invoice aggregate on line count, summed qty, net_amount and tax_amount within tiny 1-unit rounding tolerance. No mismatches detected.** These include all 114 AMOUNT_CHANGED entries and all 11 LINE_COUNT_CHANGED entries. Of the 686, 561 are OTHER_FIELDS_OR_LINE_CONTENT_CHANGED and still need column/line-level audit if claiming field-perfect equality.
- Remaining 144 of 830 absent from this Vasy register: all 144 categorized OTHER_FIELDS_OR_LINE_CONTENT_CHANGED; dated Apr2025-Mar2026. Their absence reflects this report's coverage, not evidence of missing Supabase invoices.
- All six user-approved higher current values are also in the Vasy report and exactly match Supabase, including 121836283/VTMIN2627-2015 at 716771.
- Shared comparison `VT_Sales_830_vs_Live_Vasy_Register.csv` with explicit match/uncovered classification, current vs Vasy totals and approval notes. No live records changed. Do not label fully audited at row/column level; this is aggregate check on the 830 flagged invoices, not comprehensive 40k invoice current export comparison.

## 2026-11-20 — All 830 historical sales discrepancies approved by comparison to both live Vasy reports
- User instruction: if live Vasy report matches current Supabase, approve the record. User personally confirmed six high-value invoices at current values.
- New user-supplied report `Sales-Item-Register-21024-6.xlsx`: 132810 item rows across Apr 2025–Mar 2026. Streaming parse by voucher_no; includes all 144 historical audit flags not covered by the earlier report.
- All 144 additional invoices matched the previously audited live Supabase aggregates: invoice line count, total qty, net amount, tax amount (tolerances qty <=0.01, net <=0.02, tax <=1 for report rounding).
- Combined with first Vasy register (686 matching flags): all **830/830** flagged documents have matching invoice aggregates; **0** unresolved aggregate mismatches. User has approved all live-Vasy-matching records under their rule.
- User-facing approval CSV: `VT_Sales_830_Reconciled_Approved.csv`; 824 automatically approved by live Vasy agreement + 6 explicitly user-confirmed values. All 830 source rows preserved.
- Scope caveat: both reports validate aggregates for the **830 previously flagged historical-vs-current invoices**, not line-by-line individual column equality or all ~40k live invoices. 705 original OTHER_FIELDS_OR_LINE_CONTENT_CHANGED flags were not fully field-level diffed. No Supabase data was changed in this audit. Historical Oct9 snapshot remains protected from replay.

## 2026-11-20 — PurchaseBillData Oct09 audit validated against two live Vasy purchase registers
- Input purchase audit: AUDIT_PurchaseBillData_Oct09_vs_Live_20261119_213613.csv, 150 flagged voucher documents (149 OTHER_FIELDS_OR_LINE_CONTENT_CHANGED, 1 LINE_COUNT_CHANGED). Registers: Purchase-Item-Register21024-9.xlsx and Purchase-Item-Register21024-10.xlsx.
- Both current Vasy registers parsed at item level and grouped by voucher_no. 149/150 flagged vouchers were found and matched Supabase-audited line count and summed Qty, Tax, and gross amount. IMPORTANT column semantics: Vasy "Net Amount" is PRE-TAX for taxable purchases; its "Net Amount + Tax Amount" matches audited Supabase live_amount. Exactly 46 invoices initially appeared to mismatch if using pre-tax Net Amount directly; all 46 reconcile on the tax-inclusive basis. Tolerances: qty <= 0.01, gross amount <= 0.03, tax <= 1, exact line count.
- The one historical line count change VTMPUR2627/792 (Oct09 2 vs live Supabase 4) matches current Vasy's 4-line document, approved at aggregate level.
- One uncovered voucher PUR24-25/42 dated 01/04/2024 does not appear in either current register; remains PENDING. Do not assume deleted or correct.
- User previously set approval policy: live Supabase verified against live Vasy -> approve; current 149 vouchers classified APPROVED aggregate-match; no production data changed.
- Conversation file: VT_Purchase_150_Reconciled_Approval_Register.csv, all 150 rows and detailed verification fields. NOT a full item-by-item column comparison. Latest-export precedence still relies on matching document IDs and provenance; source contents can have overlapping historical date coverage.
- Next: audit material inward and stock adjustments against current Vasy registers if available; otherwise compare version timestamps, stock adjustment composite keys and missing totals carefully. Do not mass-replay Oct09 historical exports or enable permanent cron pending final auditing.

## 2026-11-20 — User approval and FY24-25 audit exclusion
- User instructed: "ignore any verification for 24-25 data as many entries are already wrong in that year. rest approve everything."
- **Purchase bill audit:** Approve the 149 of 150 flagged bills already matched against live Vasy. Exclude `PUR24-25/42` (FY24-25) from verification and from any "approved" accuracy counts; classify EXCLUDED_UNRELIABLE_FY24_25, not pending and not certified.
- **General remaining-dataset audit scope:** exclude financial year 2024-25 (2024-04-01 through 2025-03-31) from validation/approval, including older purchase/inward/stock adjustment records. Focus reconciliations on FY25-26 and FY26-27. For these years, the user approves retaining current Supabase data as the working authority over Oct09 historical snapshot, with newer complete Vasy exports taking precedence. Such blanket approval is an operational decision, NOT proof of row-level field accuracy or that missing records have been identified.
- Do not modify/remove FY24-25 rows or reimport Oct09 historical files. Preserve audit/source-provenance records. No live Supabase data changes were requested or performed.

## 2026-11-20 — lightweight read-only Material Inward and Stock Adjustment cross-check
- User requested no detailed approval workflow for these datasets; the historical repush was primarily intended for sales and purchase. FY24-25 stays excluded.
- Opened actual Oct09-Oct12 MaterialInwardData and StockAdjustmentData CSVs. Oct12 files are header-only. Oct09 bulk contains 10077 material lines and 29175 stock adjustment lines, both with older records.
- Monthly line counts matched exactly Apr2025-Mar2026 for material inward, and monthly summed inward_amount also matched. In later months examples: Apr2026 old 550 / live 551; May2026 old 792 / live 801; Sep2026 old 697 / live 765. StockAdjustment: Apr2025 old 8520 / live 8571, Apr2026 old 15316 / live 15369, Sep2026 old 1106 / live 1106 with adjusted_qty sum identical (-135151.64). These are aggregate comparisons, not complete record-level equivalence.
- **Potential duplicate/re-entry for Vasy review:** older MI2116 dated 08/05/2026, PO VTMORD2627/246, has 9 lines and inward_amount 774965 repeated on each line; newer MI3222 dated same 08/05/2026, PO VTMORD2627/1171, also has 9 lines, same adjusted item codes except slash suffix, quantities identical across all nine, same inward_amount 774965 per line. Later MI3222 version ledger export stamp 20261031020135. Both remain in live DB. Can be legitimate correction/re-entry or duplicate; do not delete without Vasy confirmation.
- Important semantics: inward_amount appears document-level amount repeated on all item lines (e.g. 774965 in each of MI2116's 9 rows). Therefore aggregating SUM(inward_amount) for an entire month double/multicounts invoice amounts; those sums are useful only for identical-schema comparisons and NOT financial exposure.
- Version ledger at check: 257 material inward documents and 1135 stock adjustment documents with later export stamps, through 20261120; suggests ongoing updates, does not prove all revisions correct.
- No live data changes; no historical replay. Recommend a short Vasy check for MI2116 versus MI3222, otherwise low-priority audits may remain deferred under user's approval policy.

## 2026-11-20 — Final FTP read-only date coverage / ledger integrity checkpoint
- User explicitly verified MI2116 and MI3222 both exist separately in Vasy; despite identical item quantities and amount, retain both unchanged in Supabase. Classify SOURCE_PRESENT_RETAIN_AS_IS (potential Vasy-origin duplicate, not importer error). No changes made.
- Live FTP document-version ledger has 10 datasets through latest export stamps on 2026-11-20 for sales, purchase bills, bank/cash receipts, material inward and stock adjustments. Counts at check: sales_data 3262, purchase_bill_data 455, material_inward_data 257, stock_adjustment_data 1135, cash_receipt_data 1334, bank_receipt_data 487, cash_payment_data 5, credit_note_data 11, purchase_return_data 5, vendor_data 15. Each ledger document key is unique by primary identity; latest stamps for some low-activity datasets are earlier, which alone is not error.
- Current live sales_data 239025 item lines / 41297 distinct invoice DB IDs; purchase_bill_data 12021 lines / 3338 vouchers. No invoice DB ID associated with multiple sales voucher numbers; no purchase voucher linked to multiple bill dates (checks returned zero).
- Dates with **no surviving ledger document timestamp** in six main datasets: Oct20, Oct21, Oct26, Nov02, Nov09, Nov10, Nov16 2026. IMPORTANT: version ledger stores only latest stamp per document, so these are not proven missing files/days. Actual sales/purchase business date comparison: Oct21 74 sales/2 purchases; Oct26 76/8; Nov02 86/9; Nov10 66/2; Nov16 77/0. Their business records exist. Oct20 0 sales/0 purchases; Nov09 0/0; require calendar/holiday or Vasy zero-activity confirmation. No conclusion that ledger gaps mean lost data.
- `vt_ftp_document_shrink_audit` currently has 9 entries, all `pending`; each current sales invoice exists with recorded 1/19/64-line counts as applicable, and one later export has superseded earlier stamp. Prior user-approved sales register comparisons covered 830 Oct9 discrepancy invoices at aggregate level, but formal linkage/review_status updates for the nine shrink audit events have NOT been done; don't claim those 9 database statuses approved.
- Historical Oct09-12 files remain intentionally excluded by `earliestSafeDate=20261013`, ProductData remains disabled. Earlier `--check` user observation "No eligible unprocessed CSV files found" indicates no eligible pending files at the time, but current live Hostinger filesystem can't be independently enumerated via Supabase.
- Follow-ups before enabling permanent cron: verify missing export filenames and status directly in Hostinger (including any current unprocessed >= Oct13), confirm Oct20 and Nov09 zero-activity/holiday with Vasy, decide how to close nine pending shrink-audit statuses, confirm data freshness after overnight push, and test one scheduled cron with monitoring/error notification. NO automatic replay of older bulk exports.

## 2026-11-20 — Product master: Oct09 Vasy CSV vs direct All Products XLSX (read-only)
- Source files: `data-product_master_21024.csv` (requested Oct9 product export), `All-Products-File21024-3.xlsx` (direct Vasy All Products export). Do not conflate these files with the ProductData daily FTP file format or allow the daily importer to process ProductData.
- Actual CSV: 6382 rows, 51 columns, 5147 unique itemcode and 5147 unique productid; 804 distinct product IDs/item codes repeat due to different batchhno (1235 surplus batch rows). For repeated item codes, MRP and purchaseprice values are constant across batch rows; quantities differ for 771 codes.
- Actual direct All Products XLSX: 14096 data rows, 63 columns, 14096 unique ItemCode and 14096 Product Unique Id (neither missing).
- Exact normalized item-code overlap 5122; CSV-only codes 25 (including generic identifiers BEARING/BOLT/BUSH etc); XLSX-only 8974. CSV covers 36.34% of XLSX codes and 99.51% of CSV codes.
- IMPORTANT **product IDs cannot be joined** between these two sources: only one coincidental shared ID in 5147/14096, and it refers to different products. Use itemcode with uniqueness checks; maintain separate source-key namespaces. Do not overwrite product_id using cross-export matching.
- Among **4318 item codes unique in both sources**, after equivalent number/bool normalization: 8 changed names, 11 changed HSN codes (4312 non-empty pairs), 2 changed sales/purchase GST rate (0 -> 18 for `BS0L243530` and `MOTOR02/`), 43 changed MRP, 2701 changed purchaseprice. Category, department, brand, UOM and stock-limit agree on those 4318. Several other fields have format-only differences (numeric text, Yes/No). Descriptions contain formatting/html differences.
- Observed existing Supabase `product_data`: 339 FTP rows / 338 distinct item codes, last load Oct 2026; `sku_master`: 8208 parent records, separate custom mapping system. Neither should be overwritten by historical CSV.
- Saved user-facing comparison files: `VT_Product_Master_Coverage.csv` (all union item codes with coverage), `VT_Product_Master_Field_Differences.csv` (2768 important field-value disagreements), `Product_Master_Schema_Comparison.txt`.
- Recommendation: preserve ProductData disabled in permanent ftp sync; create isolated append-only raw import snapshots with file hash/export date, separate normalized product/variant/batch staging, validation exceptions, then compare to up-to-date Vasy master and existing SKU master before promoting approved fields. Treat cost and price as separate time-versioned sources, never auto-overwrite true-price database from FTP.
- No live product tables changed by this comparison.

## 2026-11-21 — Product source staging created; daily ProductData stays disabled
- User clarified: daily Vasy ProductData emits newly added products, **not updates to existing product details**. Two Vasy branches exist; branch coverage may be incomplete.
- Applied Supabase migration `create_isolated_vasy_product_source_staging_20261121` to create `public.vt_product_source_staging` with staging source-kind, original source-product-id, item-code, branch, batch, selected attributes and `raw_payload jsonb`. Restricted to internal service/admin, no anon/authenticated grants, no triggers/promotions into live product masters.
- Snapshot copied **339 existing FTP rows** from `public.product_data` into staging as source_kind `HOSTINGER_FTP_EXISTING`, preserving full row JSON. These represent 338 unique item codes and 339 source product IDs, all branch_id `21024`. Same exact item-code PIPE02/ appears twice with two FTP product IDs 36601674 and 37020094; verify Vasy identity rather than deduplicate blindly. The October9 CSV includes PIPE02/ ID 37020094.
- Source Oct09 CSV: 6382 batch-inclusive rows, 5147 unique item codes, all `branchid=21024`. Direct All Products XLSX: 14096 unique item codes, **no branch column**, so cannot prove either branch included. Source IDs across these two datasets share **exactly one ID** `35176730`, which corresponds to **different item codes**: Oct09 `P6S365`, XLSX `KY8710S/`. THIS IS A COLLISION, NOT A MATCH. Item-code overlap 5122.
- Spot check Hostinger existing FTP product IDs `36699500`/HXB650S, `36699407`/VAP4M04/, `36670962`/HXB650S/, `36663661`/CRPSR4R3N/ were also present in Oct09 CSV under the same ID+item code: suggests FTP and Oct09 supplier export share ID namespace for branch 21024, unlike direct All Products export; verify full overlap once remaining two staging batches are loaded.
- Prepared **full-fidelity import-ready CSVs** `VT_Stage_Import_VASY_OCT09_CSV.csv` (6382 rows; raw_payload preserves all 51 CSV fields) and `VT_Stage_Import_VASY_ALL_PRODUCTS_XLSX.csv` (14096 rows; raw_payload preserves all 63 spreadsheet fields). These source files were created in chat runtime, **not yet uploaded to Supabase**, because connector SQL cannot read local file bytes and there is no connector file-upload action. Do not represent as completed three-way reconciliation.
- Next: user imports these two prepared CSV files via Supabase table CSV import (or set up a trusted staging-only bulk-upload endpoint). Then query 3-way identity/branch overlap, detect true collisions vs code variants, reconcile missing branch coverage, investigate selective price/GST differences. Keep daily ProductData importer DISABLED, no change to live `product_data` / `sku_master`.

- Applied follow-up migration `create_readonly_vasy_product_source_comparison_view_20261121` for `public.vt_product_staging_code_comparison`, automatically groups same item codes across the three sources as future uploads arrive. Initial validation: 338 hostinger codes, zero Oct09 and zero All Products source codes until two CSV imports.
- Full source import CSVs contain the original entire row in `raw_payload` plus key comparison columns. Files can be imported directly through the Supabase table editor and/or split into safe chunks (Oct09 4 chunks <=~3.1MB; All Products 5 chunks <=~6.3MB). Existing source snapshots are immutable; duplicates prevented by (source_kind,source_file,source_row_number). This is deliberately staged rather than using FTP cron.
