# V1.1 automated checks

Run everything (from the repo root):

```
bash purchase-intelligence-v1.1/tests/run_all.sh
```

It copies the Apps Script files and the dashboard from this repo into a temporary folder and runs them
with a fake Google Sheets (server) and a simulated browser (dashboard). Nothing touches the live sheet.

| File | What it checks |
|---|---|
| `server/harness.js` | Fake SpreadsheetApp / PropertiesService / LockService; loads the server files. Base for the others. |
| `server/hconv.js` | `v11SelfTest` (42 checks) and `v11BillSelfTest` (54 checks) on the fake workbook. |
| `server/hprod.js` | Product sync from Supabase with master-sheet fallback (`V11_PRODUCTS_SB`), report tab, fallback when Supabase is down. |
| `server/hconv5.js` | Lot conversion dry run / apply / second apply / undo, PO-code correction, "correct product" refusal on a locked bill. |
| `dashboard/t28.js` | Shipment entry PO picker, bill w/wo split, charges list, PO-builder unit + search. |
| `dashboard/t29.js` | Product search (owner examples "r3h", "brf10npp"). |
| `dashboard/t30.js` | incl / excl GST labels, upload file values (cost grossed up, selling as typed). |
| `dashboard/t31.js` | "Correct product" from PO edit only. |
| `dashboard/t32.js` | Delete buttons call the right server action. |
| `dashboard/t33.js` | Serial numbers on shipment lines, MI number from the bill → "MI uploaded". |
| `dashboard/t34.js` | Typing two digits in the bill w / wo qty. |
| `dashboard/t35.js` | Sort + filter on the Shipments and Bills lists. |
| `dashboard/audit2.js` | Opens every screen / window / view with sample data and presses every button; 0 problems expected. |

The self-tests inside `ShipmentApi.gs` / `BillApi.gs` refuse to run on any workbook except the old TEST copy.
