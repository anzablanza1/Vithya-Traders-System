# Hostinger FTP cron — November 2026 repair

**STATUS: ALL OLD CRONS CANCELLED. DO NOT RESTART YET.**

The previous HTTP command of the form `curl -s https://.../supabase.php?key=...` is obsolete and unsafe. Do not use URL cron or old `supabase.php`. Previous imports used non-atomic delete/insert and cron redirected.

New candidate loader: `hostinger/vt_ftp_sync.php` **plus** `hostinger/vt_ftp_schema.php`. Install both under `/home/u631621082/` (outside `public_html`). Existing private Supabase service key remains in `/home/u631621082/supabase_key.txt`; never add credentials to GitHub.

1. First verify both PHP files are present and run syntax check: `php -l /home/u631621082/vt_ftp_sync.php`.
2. Run read-only inventory: `php /home/u631621082/vt_ftp_sync.php --check --max-files=10`. Verify oldest unprocessed exports and their counts.
3. Test one oldest eligible source file manually using `--apply --file=EXACT_FILENAME.csv`, **only after checking the source hash and affected live document(s)**. Verify DB and `.processed` rename afterward.
4. Test retry/idempotency and stock multi-line keys; process backlog oldest-first in bounded chunks.
5. Run `sql/ftp_post_import_audit.sql`. Compare gaps against FTP filenames and Tamil Nadu business holidays; no automatic holiday assumptions.
6. **Only after approval and successful live testing** create **one direct CLI cron**, example:
   `php /home/u631621082/vt_ftp_sync.php --apply --all --max-files=20 >> /home/u631621082/vt_ftp_sync.log 2>&1`
   Verify the PHP executable path, schedule, permissions, SSH/CLI availability and timeout from Hostinger first.

Do not reprocess `*.csv.processed`. No API fallback data should be altered. The ProductData FTP batch feed remains disabled until a separate multi-batch schema design is validated.

Full context: `docs/FTP_RECOVERY_HANDOVER_2026-11-19.md`.
