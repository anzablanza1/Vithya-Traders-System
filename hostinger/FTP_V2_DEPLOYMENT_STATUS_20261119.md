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
