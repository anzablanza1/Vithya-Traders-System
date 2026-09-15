/**********************************************************************
 * VITHYA TRADERS — OUTSTANDING REPORTS → SUPABASE       [VT-063]
 *
 * Globals declared here (check before pasting):
 *   REC, loadLedgerReport, loadInvoiceOutstandingReport, loadBothReports,
 *   reconciliationStatus, recPush_, recSheet_, recNum_, recProp_,
 *   onOpenRecon
 *
 * ── THE TWO REPORTS AND WHY BOTH ARE NEEDED ──
 *
 *   Customer Outstanding          the LEDGER
 *     674 parties, opening + debit - credit = closing, Rs 1,37,20,937
 *     This is what a customer would agree they owe.
 *
 *   Customer Invoice Outstanding  the INVOICE DETAIL
 *     468 customers, 2,383 unpaid bills, Rs 1,91,40,442
 *
 *   The Rs 54,19,505 between them is invoices that were settled but never
 *   marked against the bill. Closing those brings the detail into line with
 *   the ledger without touching this year's data — which is exactly the
 *   write-off list you asked for.
 *
 * ── WHAT IT TOUCHES ──
 *   Reads  : two Google Sheets you nominate. Never writes to them.
 *   Writes : customer_ledger_snapshot and customer_invoice_outstanding.
 *   Keyed on (name, as_at), so re-running the same day overwrites and
 *   running next month adds a new snapshot beside the old one.
 *
 * ── SETUP ──
 *   Upload both exports to Drive, open each, File > Save as Google Sheets.
 *   Then Script Properties:
 *     VT_LEDGER_SHEET_ID       the Customer Outstanding sheet
 *     VT_INV_OUTSTANDING_ID    the Customer Invoice Outstanding sheet
 *     SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * ── RUN ──
 *   loadBothReports()        both, about a minute
 *   reconciliationStatus()   what is loaded and what it says
 **********************************************************************/

const REC = {
  URL_PROP: 'SUPABASE_URL',
  KEY_PROP: 'SUPABASE_SERVICE_KEY',
  LEDGER_ID: 'VT_LEDGER_SHEET_ID',
  INVOUT_ID: 'VT_INV_OUTSTANDING_ID',
  CHUNK: 400,
  GAP: 250,
};

function recNum_(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

function recProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

/**
 * Open the sheet and find the header row.
 * Vasy puts a branch banner above it in some exports and not others, so the
 * row is looked for rather than assumed — the same mistake cost a round trip
 * on the receipts export.
 */
function recSheet_(propKey, mustHave) {
  const id = recProp_(propKey);
  const sh = SpreadsheetApp.openById(id).getSheets()[0];
  if (sh.getLastRow() < 2) throw new Error('That sheet has no rows.');
  const look = Math.min(8, sh.getLastRow());
  const wide = Math.min(sh.getLastColumn(), 30);
  const block = sh.getRange(1, 1, look, wide).getValues();
  for (let r = 0; r < look; r++) {
    const names = block[r].map(function (x) {
      return String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
    });
    const ok = mustHave.every(function (m) { return names.indexOf(m) >= 0; });
    if (ok) {
      const H = {};
      names.forEach(function (n, i) { if (n) H[n] = i; });
      return { sh: sh, headerRow: r + 1, H: H, raw: block[r] };
    }
  }
  throw new Error('Could not find the header in the first ' + look +
    ' rows.\n\nLooking for: ' + mustHave.join(', ') +
    '\n\nRow 1 reads: ' + block[0].filter(String).join(' | ').slice(0, 250));
}

function recPush_(table, rows, conflict) {
  const url = recProp_(REC.URL_PROP).replace(/\/+$/, '') +
    '/rest/v1/' + table + '?on_conflict=' + conflict;
  const key = recProp_(REC.KEY_PROP);
  let sent = 0;
  for (let i = 0; i < rows.length; i += REC.CHUNK) {
    const part = rows.slice(i, i + REC.CHUNK);
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
                 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify(part), muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      throw new Error(table + ': stopped at row ' + (i + 1) + ' of ' +
        rows.length + '\n\nHTTP ' + res.getResponseCode() + '  ' +
        res.getContentText().slice(0, 300));
    }
    sent += part.length;
    if (i + REC.CHUNK < rows.length) Utilities.sleep(REC.GAP);
  }
  return sent;
}

function recToday_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ---------- the ledger ---------- */

function loadLedgerReport() {
  const f = recSheet_(REC.LEDGER_ID, ['partyname', 'closing']);
  const H = f.H, sh = f.sh;
  const n = sh.getLastRow() - f.headerRow;
  const v = sh.getRange(f.headerRow + 1, 1, n, sh.getLastColumn()).getValues();
  const asAt = recToday_();

  const seen = {}, rows = [];
  v.forEach(function (r) {
    const name = String(r[H['partyname']] || '').trim();
    if (!name) return;
    if (seen[name]) return;          // a duplicate party would break the key
    seen[name] = 1;
    rows.push({
      party_name: name,
      as_at: asAt,
      contact_no: H['contactno'] !== undefined
        ? (String(r[H['contactno']] || '').trim() || null) : null,
      opening_balance: H['openingbalance'] !== undefined ? recNum_(r[H['openingbalance']]) : 0,
      debit:  H['debit']  !== undefined ? recNum_(r[H['debit']])  : 0,
      credit: H['credit'] !== undefined ? recNum_(r[H['credit']]) : 0,
      closing: recNum_(r[H['closing']]),
      source: 'VASY-CUSTOMER-OUTSTANDING',
      loaded_at: new Date().toISOString(),
    });
  });

  /* the report should balance; if it does not, say so rather than load it */
  let off = 0;
  rows.forEach(function (r) {
    if (Math.abs(r.opening_balance + r.debit - r.credit - r.closing) > 1) off++;
  });

  const sent = recPush_('customer_ledger_snapshot', rows, 'party_name,as_at');
  const tot = rows.reduce(function (s, r) { return s + r.closing; }, 0);
  const opn = rows.reduce(function (s, r) { return s + r.opening_balance; }, 0);
  const msg = 'LEDGER LOADED  (' + asAt + ')\n\n' +
    'parties : ' + sent.toLocaleString() + '\n' +
    'opening : ' + Math.round(opn).toLocaleString() + '\n' +
    'closing : ' + Math.round(tot).toLocaleString() + '\n' +
    (off ? '\n\u26a0 ' + off + ' rows where opening + debit - credit does not ' +
      'equal closing.\n   Worth checking that export.' : '');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return sent;
}

/* ---------- the invoice detail ---------- */

function loadInvoiceOutstandingReport() {
  const f = recSheet_(REC.INVOUT_ID, ['customername', 'outstandingamount']);
  const H = f.H, sh = f.sh;
  const n = sh.getLastRow() - f.headerRow;
  const v = sh.getRange(f.headerRow + 1, 1, n, sh.getLastColumn()).getValues();
  const asAt = recToday_();
  const g = function (r, k) { return H[k] !== undefined ? recNum_(r[H[k]]) : 0; };

  const seen = {}, rows = [];
  v.forEach(function (r) {
    const name = String(r[H['customername']] || '').trim();
    if (!name || seen[name]) return;
    seen[name] = 1;
    rows.push({
      customer_name: name,
      as_at: asAt,
      outstanding: g(r, 'outstandingamount'),
      d30: g(r, '30days'), d45: g(r, '45days'), d60: g(r, '60days'),
      d90: g(r, '90days'), d120: g(r, '120days'),
      d120plus: g(r, '120daysmore'),
      unpaid_bills: Math.round(g(r, 'unpaidbills')),
      source: 'VASY-INVOICE-OUTSTANDING',
      loaded_at: new Date().toISOString(),
    });
  });

  const sent = recPush_('customer_invoice_outstanding', rows, 'customer_name,as_at');
  const tot = rows.reduce(function (s, r) { return s + r.outstanding; }, 0);
  const bills = rows.reduce(function (s, r) { return s + r.unpaid_bills; }, 0);
  const msg = 'INVOICE OUTSTANDING LOADED  (' + asAt + ')\n\n' +
    'customers    : ' + sent.toLocaleString() + '\n' +
    'outstanding  : ' + Math.round(tot).toLocaleString() + '\n' +
    'unpaid bills : ' + bills.toLocaleString();
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return sent;
}

function loadBothReports() {
  const a = loadLedgerReport();
  const b = loadInvoiceOutstandingReport();
  const msg = 'BOTH REPORTS LOADED\n\n' +
    'ledger              : ' + a.toLocaleString() + ' parties\n' +
    'invoice outstanding : ' + b.toLocaleString() + ' customers\n\n' +
    'Now run reconciliationStatus() to see the gap.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ---------- what it says ---------- */

function reconciliationStatus() {
  const base = recProp_(REC.URL_PROP).replace(/\/+$/, '');
  const key = recProp_(REC.KEY_PROP);
  const get = function (p) {
    const r = UrlFetchApp.fetch(base + '/rest/v1/' + p, {
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
      muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return [];
    try { return JSON.parse(r.getContentText()); } catch (e) { return []; }
  };
  const s = get('v_reconciliation_summary?select=*&order=next_step');
  if (!s.length) {
    const m = 'Nothing loaded yet. Run loadBothReports().';
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return;
  }
  const L = ['RECONCILIATION', ''];
  let cust = 0, close = 0;
  s.forEach(function (r) {
    cust += Number(r.customers) || 0;
    close += Number(r.to_close) || 0;
    L.push(r.next_step);
    L.push('   ' + Number(r.customers).toLocaleString() + ' customers   ' +
      'ledger ' + Number(r.ledger || 0).toLocaleString() +
      '   invoices ' + Number(r.invoices || 0).toLocaleString() +
      '   to close ' + Number(r.to_close || 0).toLocaleString());
  });
  L.push('');
  L.push('TOTAL   ' + cust.toLocaleString() + ' customers, ' +
    Math.round(close).toLocaleString() + ' to write off');
  const msg = L.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
}

function onOpenRecon() {
  SpreadsheetApp.getUi()
    .createMenu('⚖️ Reconciliation')
    .addItem('Load both reports', 'loadBothReports')
    .addItem('Ledger only', 'loadLedgerReport')
    .addItem('Invoice outstanding only', 'loadInvoiceOutstandingReport')
    .addSeparator()
    .addItem('Status', 'reconciliationStatus')
    .addToUi();
}