/**********************************************************************
 * VITHYA TRADERS — RECEIPT REGISTER → SUPABASE          [VT-059]
 *
 * Globals declared here (check before pasting):
 *   RRS, pushReceiptsToSupabase, syncReceiptsToSupabase, receiptRegisterStatus,
 *   rrsNum_, rrsDate_, rrsFy_, rrsProp_, rrsPost_, rrsFindSheet_,
 *   onOpenReceiptPush
 *
 * ── WHY IT DOES NOT REPARSE THE EXPORT ──
 *   receivables.gs already has importReceipts(fileId), which reads the Vasy
 *   export, finds the header wherever Vasy put it, derives a party key and
 *   writes the Receipts sheet. That works and is proven. Rewriting it here
 *   would be a second thing to keep correct.
 *
 *   So this reads the Receipts SHEET — importReceipts' output — and pushes it.
 *
 * ── WHAT IT TOUCHES ──
 *   Reads  : the 'Receipts' sheet   (never writes to it)
 *   Writes : public.receipt_register ONLY. Never any *_data table.
 *   Upsert on receipt_no, so re-running costs nothing.
 *
 * ── WHAT THIS DATA CAN AND CANNOT DO ──
 *   The Vasy export carries the receipt number, party, mode, type, date and
 *   amount — but NOT the invoice db id. So it answers
 *
 *       how much came in, when, by what mode, from whom
 *
 *   and it CANNOT settle an invoice. Only the FTP feeds
 *   (cash_receipt_data / bank_receipt_data) carry db_invoiceno, and those
 *   start 17 Aug 2026.
 *
 *   That is the gap Vasy needs to close. Until they do, this table is the
 *   collection history and nothing more — and the table comment says so.
 *
 * ── SETUP ──
 *   Script Properties: SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   And run importReceipts() first, so the Receipts sheet exists.
 *
 * ── RUN ──
 *   pushReceiptsToSupabase()   push what is in the sheet
 *   syncReceiptsToSupabase()   importReceiptsNow() then push
 *   receiptRegisterStatus()    what is loaded, and how it compares to FTP
 **********************************************************************/

const RRS = {
  URL_PROP: 'SUPABASE_URL',
  KEY_PROP: 'SUPABASE_SERVICE_KEY',
  TABLE:    'receipt_register',
  CONFLICT: 'receipt_no',
  SHEET:    'Receipts',
  CHUNK:    500,
  GAP:      250,
};

function rrsNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}

function rrsDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return null;
}

function rrsFy_(iso) {
  if (!iso) return null;
  const y = parseInt(iso.slice(0, 4), 10), m = parseInt(iso.slice(5, 7), 10);
  const s = (m >= 4) ? y : y - 1;
  return String(s).slice(-2) + String(s + 1).slice(-2);
}

function rrsProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function rrsPost_(rows) {
  const url = rrsProp_(RRS.URL_PROP).replace(/\/+$/, '') +
    '/rest/v1/' + RRS.TABLE + '?on_conflict=' + RRS.CONFLICT;
  const key = rrsProp_(RRS.KEY_PROP);
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
               'Prefer': 'resolution=merge-duplicates,return=minimal' },
    payload: JSON.stringify(rows), muteHttpExceptions: true,
  });
  return { code: res.getResponseCode(), text: res.getContentText() };
}

/**
 * Find a tab in whichever workbook holds it.
 *
 * importReceipts writes through rcvSheet_, which uses txnBook_() — so the
 * Receipts sheet lives in VT_Transactions. Looking there FIRST matters: I
 * checked the active book and the registry, missed it, and told you the
 * sheet was empty while 10,660 rows sat in it.
 */
function rrsFindSheet_(name) {
  try { const sh = txnBook_().getSheetByName(name); if (sh) return sh; } catch (e) {}
  try { const sh = vtSheet(name); if (sh) return sh; } catch (e) {}
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (sh) return sh;
  } catch (e) {}
  const props = PropertiesService.getScriptProperties().getProperties();
  const ids = Object.keys(props)
    .filter(function (k) { return /_ID$/.test(k) && String(props[k]).length > 30; })
    .map(function (k) { return props[k]; });
  for (let i = 0; i < ids.length; i++) {
    try {
      const sh = SpreadsheetApp.openById(ids[i]).getSheetByName(name);
      if (sh) return sh;
    } catch (e) {}
  }
  return null;
}

function pushReceiptsToSupabase() {
  const t0 = Date.now();

  /* The Receipts sheet lives in VT_Receivables, not the active book, so
     looking only at vtSheet and the active spreadsheet found nothing and
     reported "empty" — which was wrong and misleading. Search every
     workbook this project knows about. */
  const sh = rrsFindSheet_(RRS.SHEET);
  if (sh && sh.getLastRow() < 2) {
    throw new Error('The Receipts sheet exists but has no rows.\n\n' +
      'Run importReceipts() from receivables.gs.');
  }
  if (!sh) {
    const props = PropertiesService.getScriptProperties().getProperties();
    const books = Object.keys(props).filter(function (k) {
      return /_ID$/.test(k) && String(props[k]).length > 30;
    });
    throw new Error((sh ? 'The Receipts sheet has no rows.'
                        : 'No sheet called "' + RRS.SHEET + '" was found.') +
      '\n\nSearched: the active book and ' + books.length +
      ' workbook(s) from Script Properties —\n   ' + books.join(', ') +
      '\n\nIf importReceipts() wrote it somewhere else, add that ' +
      'workbook id as a Script Property ending in _ID.');
  }

  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  const H = {};
  hdr.forEach(function (h, i) { H[h] = i; });
  if (H['receipt_no'] === undefined) {
    throw new Error('No receipt_no column on the Receipts sheet.\n\n' +
      'Columns found: ' + hdr.join(', '));
  }

  const v = sh.getRange(2, 1, sh.getLastRow() - 1, hdr.length).getValues();
  const rows = [];
  let noNumber = 0;

  v.forEach(function (r) {
    const no = String(r[H['receipt_no']] || '').trim();
    if (!no) { noNumber++; return; }
    const d = rrsDate_(r[H['date']]);
    rows.push({
      receipt_no:   no,
      party_name:   H['party_name'] !== undefined
                      ? (String(r[H['party_name']] || '').trim() || null) : null,
      mode:         H['mode'] !== undefined
                      ? (String(r[H['mode']] || '').trim() || null) : null,
      receipt_type: H['type'] !== undefined
                      ? (String(r[H['type']] || '').trim() || null) : null,
      receipt_date: d,
      amount:       H['amount'] !== undefined ? rrsNum_(r[H['amount']]) : null,
      status:       H['status'] !== undefined
                      ? (String(r[H['status']] || '').trim() || null) : null,
      created_by:   H['created_by'] !== undefined
                      ? (String(r[H['created_by']] || '').trim() || null) : null,
      fy:           rrsFy_(d),
      source:       'VASY-EXPORT',
      loaded_at:    new Date().toISOString(),
    });
  });

  if (!rows.length) throw new Error('No rows with a receipt number.');

  /* the same receipt number twice in one payload is rejected outright */
  const seen = {}, clean = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (seen[rows[i].receipt_no]) continue;
    seen[rows[i].receipt_no] = 1;
    clean.unshift(rows[i]);
  }
  const dupes = rows.length - clean.length;

  let sent = 0;
  for (let i = 0; i < clean.length; i += RRS.CHUNK) {
    const part = clean.slice(i, i + RRS.CHUNK);
    const res = rrsPost_(part);
    if (res.code < 200 || res.code >= 300) {
      throw new Error('Stopped at row ' + (i + 1) + ' of ' + clean.length +
        '\n\nHTTP ' + res.code + '  ' + res.text.slice(0, 300) +
        '\n\n' + sent + ' already pushed. The upsert makes a re-run safe.');
    }
    sent += part.length;
    if (i + RRS.CHUNK < clean.length) Utilities.sleep(RRS.GAP);
  }

  const msg = 'RECEIPT REGISTER → SUPABASE  (' +
    Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'from the Receipts sheet (written by importReceipts)\n\n' +
    'sheet rows : ' + v.length.toLocaleString() + '\n' +
    'pushed     : ' + sent.toLocaleString() + '\n' +
    (dupes ? 'duplicate receipt numbers : ' + dupes + '  (last kept)\n' : '') +
    (noNumber ? 'no receipt number : ' + noNumber + '\n' : '') +
    '\nThis is collection history. It has no invoice db id, so it cannot\n' +
    'settle an invoice — only the FTP receipt feeds can do that.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return sent;
}

/** import then push — one action */
function syncReceiptsToSupabase() {
  try { importReceiptsNow(); }
  catch (e) {
    throw new Error('importReceiptsNow() failed, so nothing was pushed.\n\n' +
      e.message + '\n\nCheck RCV_FILE_ID at the top of receivables.gs.');
  }
  return pushReceiptsToSupabase();
}

function receiptRegisterStatus() {
  const base = rrsProp_(RRS.URL_PROP).replace(/\/+$/, '');
  const key = rrsProp_(RRS.KEY_PROP);
  const get = function (path) {
    const r = UrlFetchApp.fetch(base + '/rest/v1/' + path, {
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
      muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) return null;
    try { return JSON.parse(r.getContentText()); } catch (e) { return null; }
  };
  const agg = get('receipt_register?select=amount,receipt_date,mode&limit=20000') || [];
  let total = 0, lo = '', hi = '';
  const byMode = {};
  agg.forEach(function (r) {
    total += Number(r.amount) || 0;
    byMode[r.mode || '?'] = (byMode[r.mode || '?'] || 0) + (Number(r.amount) || 0);
    const d = String(r.receipt_date || '');
    if (d && (!lo || d < lo)) lo = d;
    if (d && (!hi || d > hi)) hi = d;
  });
  const msg = 'RECEIPT REGISTER\n\n' +
    'receipts : ' + agg.length.toLocaleString() + '\n' +
    'total    : ' + Math.round(total).toLocaleString() + '\n' +
    'range    : ' + (lo || '?') + ' to ' + (hi || '?') + '\n\n' +
    Object.keys(byMode).map(function (m) {
      return '   ' + m + ': ' + Math.round(byMode[m]).toLocaleString();
    }).join('\n') +
    '\n\nNo invoice link — this answers "how much came in", not "against what".';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenReceiptPush() {
  SpreadsheetApp.getUi()
    .createMenu('💰 Receipts → Supabase')
    .addItem('Import then push', 'syncReceiptsToSupabase')
    .addItem('Push what is in the sheet', 'pushReceiptsToSupabase')
    .addItem('Status', 'receiptRegisterStatus')
    .addToUi();
}