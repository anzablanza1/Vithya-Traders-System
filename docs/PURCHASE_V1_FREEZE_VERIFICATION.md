# Purchase Intelligence V1 — Freeze Verification

Verified: 2026-09-30

This document records facts verified after the immutable Purchase Intelligence V1 archive was created.

The frozen archive under:

archive/purchase-intelligence-v1/

must remain unchanged as the historical V1 snapshot.

## 1. Live Apps Script project

Script ID:

14nuzy82prVwp3u1uIM3FZ2z_6dxk_I717U-2KBTNEHKv6MYyRN9hAHeR

The exact live source was cloned directly from Google Apps Script and preserved privately.

The Git archive contains a sanitized copy of that source.

## 2. Bound operational workbook

Workbook name:

po request live

Workbook ID:

1d7_Y5rMG8n77TCYIOY12zm-J1De-wl5MKzY8qrNpmbI

This is the actual workbook bound to the Purchase Intelligence / PO Request Apps Script project.

A frozen XLSX backup is stored privately.

## 3. Production web-app deployment

Production deployment version:

36

Deployment description:

EDITS

The live Purchase Intelligence dashboard was verified to use the corresponding /exec deployment.

The exact production URL and deployment ID are stored in the private recovery backup and are intentionally not repeated here.

## 4. Purchase-history sources used by V1

Purchase Intelligence V1 has two purchase-register paths.

### Primary live path

Vasy FTP
→ PurchaseBillData CSV
→ Hostinger supabase.php
→ Supabase purchase_bill_data
→ LiveApi
→ Purchase Intelligence dashboard

Supabase purchase_bill_data is therefore a primary live purchase-history source.

### Google Sheets path / fallback

The Purchase_Register tab is inside the larger Product Database System workbook.

RegisterApi reads this sheet as the Google Sheets register path/fallback.

The full Product Database System workbook was frozen privately as XLSX.

## 5. Vasy → Supabase pipeline verified

The Hostinger sync code explicitly maps:

PurchaseBillData*.csv
→ purchase_bill_data

The sync uses replace-by-document logic keyed on:

voucher_no

This resolves the earlier V1 documentation item that marked the Vasy → Supabase purchase pipeline as needing live verification.

## 6. Product master authority clarified

The legacy external product master workbook is referenced by the live Apps Script.

The live Code.js syncProducts() function copies product data from the external master into the local Products tab.

Runtime getProducts() reads the local Products tab.

Therefore:

- external product master = upstream legacy source
- local Products tab = runtime operational copy

The legacy master was already considered stale/unreliable operationally and must not automatically become the V2 source of truth.

A frozen copy is stored privately for recovery/reference only.

## 7. Supplier workbook

The supplier dependency was verified as the workbook named:

supplier data

A frozen XLSX backup is stored privately.

## 8. Hostinger cron behavior

Normal Vasy FTP files arrive approximately:

02:00–02:30 AM IST

Primary fixed Supabase ingestion cron:

21:00 UTC
= approximately 02:30 AM IST the following day

A second cron time may be added or changed operationally for retries, testing, late files, or manual reprocessing.

An observed secondary schedule during the freeze was:

08:49 UTC
= approximately 02:19 PM IST

The exact cron command structure and operational notes are stored privately.

Secrets and trigger tokens are intentionally excluded from Git.

## 9. Private frozen data captured

The following were frozen outside Git because they contain live operational data:

- PO Request Live workbook
- Product Database System workbook
- Supplier Data workbook
- Legacy Product Master workbook
- Supabase purchase_bill_data CSV
- exact live Apps Script clone
- production deployment mapping
- Hostinger cron mapping

SHA-256 checksum manifests were created and successfully verified for the private Purchase Intelligence backup and Google Sheets backups.

## 10. Security follow-up

The V1 code contained a hard-coded fallback API token.

The Git archive copy was sanitized before commit.

The raw live copy remains preserved privately for historical recovery.

A controlled credential rotation should be performed separately so that the working V1 production system is not disrupted during the freeze.

## 11. V2 rule

V2 development must treat the frozen V1 archive as reference only.

Do not modify the archived V1 implementation in place.

V2 should be built separately and migrated deliberately.
