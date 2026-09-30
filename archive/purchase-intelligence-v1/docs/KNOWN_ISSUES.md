# KNOWN_ISSUES.md — V1 (frozen)

Currently **unresolved** issues, debt, and workarounds with ongoing consequences. (Resolved items excluded.)

## Structural (the reason for V2)
1. **One lot = one PO.** Bill/split-bill is locked to a single lot within a single PO. Real supplier
   shipments span multiple POs (+ excess + off-PO). Result: **multi-PO consignments can't be billed as one
   material inward and tallies don't reconcile.** Primary V2 driver. **Do not patch in V1.**
2. **No first-class Shipment / allocation objects.** Excess and off-PO are handled ad-hoc on the lot.
3. **Shipment/Bill/Receipt quantities not independently modelled** (the lot conflates them).

## Data / integration limitations
4. **No live sales feed.** EOQ/reorder use purchase outflow as a proxy (documented limitation).
5. **No live stock feed** from Vasy into the dashboard.
6. **Vasy → Supabase population pipeline is external and undocumented here** — **NEEDS LIVE VERIFICATION**.
7. **Product master authority ambiguous:** `Products` tab vs MASTER_ID workbook — confirm which wins.
8. **Rate has multiple sources** (`lineCostBest` precedence) — correct by design but can surprise; verify
   when a rate looks wrong.

## Operational / behavioural
9. **Two-date follow-up chase logic not fully wired to phase** (display done; chase still generic).
10. **Analytics/lead-time sparse early** — cells read "—" until enough completed ship→receive cycles.
11. **Column-order fragility:** sheet readers use fixed indices (e.g. Lots Received At=col 10, Expected
    =col 15). Reordering columns breaks reads. Keep column order stable.
12. **Stale local cache on a device** can show old POs until a sync or **Settings → Reset local data**;
    mitigated by sheet-as-source-of-truth + outbox clear, but a very stale browser file (old HTML) can
    still confuse — always open the latest HTML (version chip should read v8.6).
13. **PO-Request `index.html` was reconstructed from an RTF** during V1 work; validated (scripts pass) but
    should be eyeballed against the true deployed copy before treating as canonical.

## Environment
14. **jsPDF core font lacks ₹** — all PDFs use "Rs" deliberately; Excel header/footer **fills** are not
    possible with the bundled SheetJS build (text markers used instead).
15. Single `/exec` deployment serves 4 server files — a redeploy is required after **any** `.gs` change.

## Watch-outs (not bugs, but easy to break)
- `SPLIT_CTX`/`SPLIT_FRESH` guards keep split values from being wiped on re-render — don't remove.
- `posBoardDocs()`/`posFilteredTops()` must exclude `p.closed` — regressed once; keep excluded.
- `lotNo` is server-authoritative; don't compute a "final" lot number client-side.
