# TODO

Pending work and planned improvements. Grouped by owner. This reflects the
state at the Version-1 handover snapshot (11 Sep 2026).

---

## For the owner (non-code tasks)

- [ ] **Collect the source files into GitHub** using `FILES_TO_COLLECT.md`.
      This is the point of the whole handover — until it is done, the repo is
      documentation without the code it documents.
- [ ] **Fix the `ofcActions_` shadow** — search `function ofcActions_` in the
      Apps Script editor, delete the older file, re-run `whatIsLive()`
      (see KNOWN_ISSUES K1).
- [ ] **Finish the 147 "already agree" reconciliations** — the fast win on the
      reconciliation screen (confirm + sign off).
- [ ] **Chase the Vasy requests:** (1) receipt export WITH invoice db ids for
      history before 17 Aug 2026; (2) the `/api/v1/receipt/...` 403 scope;
      (3) the broken `product_data` FTP export (or accept the ERP-snapshot
      workaround permanently).
- [ ] **Run `clearFtpGap()`** once the FTP feed is confirmed caught up.
- [ ] **Delete the dead `.gs` files** in small batches after `whatIsLive()`
      confirms nothing live depends on them.

## For a developer / AI (build tasks)

- [ ] **Export all Supabase table + view SQL** into the repo
      (`pg_get_viewdef` / `supabase db dump`) — see KNOWN_ISSUES K13.
- [ ] **"Not in the ledger" investigation view** — the ~14 customers with
      invoices but no ledger account.
- [ ] **A live sales figure** that does not wait for the nightly build (a
      screen querying `v_sales_all` directly), if the owner wants it.
- [ ] **Cash-flow view** (money in vs money out) — needs `cash_payment_data`
      built out beyond its current ~38 rows.
- [ ] **Recalibrate stock offset** on 1 April / after any Vasy year rollover.
- [ ] Consider `security_invoker` + RLS SELECT policies **only if** the anon
      key is ever put in a browser (see SECURITY / KNOWN_ISSUES K14).

## Parked (owner's explicit decision — do not restart without asking)

- [ ] **Product master sheet** — a full, cleaned product master. Parked.
- [ ] **Price manager** — the verified-pricing programme
      (`VerifiedPricing.gs`, `VT_Dashboard_11.html`). Parked.
- [ ] **PO prefill** — stays in Google Sheets, not Supabase. Owner's call.
- [ ] **Drop `ops_pipeline_snapshots`** — dead table; drop when certain.

## Nice-to-have / not scheduled

- [ ] A proper staging deployment so changes don't go straight to live.
- [ ] Automated deploy (clasp) instead of manual paste — but the owner is a
      non-coder, so any such change must not make day-to-day edits harder for
      them.
