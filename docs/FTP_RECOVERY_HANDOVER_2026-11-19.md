# Vithya Traders FTP recovery handover — 19 November 2026

Status: **repair candidate prepared locally; not deployed to Hostinger; original HTTP cron jobs remain cancelled.** This branch was created from `v2-development`.

## User scope
- Vasy is still uploading FTP CSVs into Hostinger (confirmed by the owner).
- Existing `*.csv.processed` files must never be replayed; only pending `*.csv` are candidates.
- API fallback (`sales_ftp_gap`), API invoice register (`sales_invoice`), ERP snapshot and FY 2024–25 sales history are **separate** and must not be changed by the FTP loader.
- FY 2024–25 invoice DB ID backfill is on hold until Vasy supplies the IDs. New FTP sales sync only accepts sales dated from 2025-04-01.
- After the pending files are loaded chronologically, audit missing transaction dates; distinguish business holidays from missing exports by comparing source filenames/ERP activity and financial totals.

## Verified baseline (read-only 19 Nov 2026)
All original FTP data last loaded on 12 Oct UTC / 13 Oct IST. Live counts: `sales_data` 226,457 rows, 38,893 distinct invoice DB IDs; `purchase_bill_data` 11,181; `material_inward_data` 11,156; `stock_adjustment_data` 29,349; `bank_receipt_data` 9,451; `cash_receipt_data` 22,032; `expense_register_data` 18. FY24–25 `sales_history` 57,564. API fallback continued independently (29,097 rows as checked on Nov 19); invoice register 40,213. DB approximately 408 MB.

Installed Supabase RPC: `public.vt_ftp_replace_document(text,jsonb)`, service-role-only function. It atomically replaces one complete document, with advisory lock and a 40% row-shrink guard. The PHP candidate calls this RPC. **No live service-role RPC integration test has yet been run on Hostinger**.

## Defects in old `supabase.php`
1. It uses nontransactional DELETE then INSERT, which can lose documents on timeout.
2. It keys sales by voucher number, but three distinct invoice DB IDs share voucher numbers.
3. It treats bank receipt voucher IDs as unique although three vouchers have two legitimate accounting lines.
4. It replaces entire stock dates, potentially deleting other events from that date.
5. It uses HTTP run tokens/URL-based cron; previous jobs returned 307 redirects.
6. It can silently skip CSV columns / partial malformed rows.

## Review candidate
The repaired PHP loader is CLI-only, sorts export filenames by timestamp, validates the full expected Vasy schema before any write, checks hashes/mtime against in-progress FTP uploads, uses one atomic RPC per document, stops on the first failure, only renames a file `.processed` on complete success, and is rerunnable without duplicate documents. It supports read-only `--check`, one-file `--apply --file=...`, and later bounded `--apply --all --max-files=20`. Processed files are not globbed. Exports before 2026-10-13, oversized full-history files and unsafe product-batch exports are blocked for separate review. ProductData is disabled because the FTP product file has multiple batches per product ID and the current table enforces `UNIQUE(product_id)`.

Tested locally with PHP 8.4: syntax check passed; sample sales (792 rows/119 IDs), bank (13/13), inward (24/10), stock (8/8), purchase (24/10) passed `--check`. Synthetic checks: missing header rejected, FY24–25 sale rejected, header-only export accepted, check-mode did not rename source. **No live DB changes or Hostinger writes were made by this repair.**

## Next-chat instructions
1. Locate the candidate loader on this branch. Do not use the old `hostinger/supabase.php.example` for deployment.
2. Review the current installed RPC definition and its service_role permissions; do not paste keys in chat.
3. On Hostinger, place the reviewed PHP as `/home/u631621082/vt_ftp_sync.php` *outside public_html*; the old `supabase.php` stays disabled.
4. Run `php /home/u631621082/vt_ftp_sync.php --check --max-files=10`. Review oldest unprocessed filenames, header-only files, product disabled notices, and digest.
5. After reviewing one *oldest eligible* pending file, run `php /home/u631621082/vt_ftp_sync.php --apply --file=EXACT_NAME.csv`; independently verify DB values and rename to `.processed`.
6. Test retry/idempotency and stock multi-line timestamp identities. Process backlog in date order in small bounds; do not jump forward after failures.
7. Run SQL per-day coverage audit across FY26–27, check missing dates against Vasy exports and holidays, and reconcile FTP/API overlap **without deleting API fallback**.
8. Only then enable one direct-CLI cron with logging and freshness/error alerts; never restore old URL `curl` cron.

Known separate issue: `v_sales_all` currently selects source priority by voucher_no, not invoice DB ID; FTP has three legitimate voucher collisions. Audit independently after FTP catch-up.