/**********************************************************************
 * VITHYA TRADERS — SALES INVOICE → SUPABASE            [VT-DW-060]
 *
 * Globals declared here (check before pasting):
 *   SIS, pullInvoicesToSupabase, backfillInvoicesFromSheets,
 *   invoiceSupabaseStatus, pullInvoicesLast30Days, pullInvoicesLast90Days,
 *   nightlyInvoiceSync, installInvoiceTrigger, removeInvoiceTrigger,
 *   sisNum_, sisInt_, sisDate_, sisFy_, sisProp_,
 *   sisPost_, sisRow_, sisPushAll_, sisFindSheet_, onOpenInvoiceSync
 *
 * ── WHY THIS IS A SEPARATE FILE ──
 *   SalesAutomation.gs will not compile in your project, and this is the one
 *   thing that cannot wait for it: the invoice register is what makes
 *   receipts joinable to invoices. So this file stands alone. It shares no
 *   names with SalesAutomation.gs and does not call into it.
 *
 * ── WHAT IT SOLVES ──
 *   sales_data.invoice_id_db_id is '0' on all 11,153 rows, so the FTP feed
 *   cannot be joined to receipts. But the receipts DO carry the id:
 *
 *     cash_receipt_data.db_invoiceno   817 of 818   (99.9%)
 *     bank_receipt_data.db_invoiceno   342 of 368   (92.9%)
 *
 *   and the API invoice register carries the matching salesId. Pushing that
 *   register into public.sales_invoice completes the chain:
 *
 *     receipt.db_invoiceno -> sales_invoice.sales_id -> order_no -> voucher
 *
 * ── WHAT IT TOUCHES ──
 *   Writes : public.sales_invoice only. Never any *_data table.
 *   Upsert on sales_id, so re-running is free.
 *
 * ── SETUP ──
 *   Script Properties already used elsewhere:
 *     SUPABASE_URL, SUPABASE_SERVICE_KEY
 *     VASY_BASE_URL, VASY_API_TOKEN, VASY_BRANCH_ID
 *
 * ── RUN ──
 *   backfillInvoicesFromSheets()   fast — pushes what is already in the
 *                                  year workbooks. Start here.
 *   pullInvoicesToSupabase()       pulls fresh from the API, then pushes.
 *   invoiceSupabaseStatus()        coverage against the receipts
 **********************************************************************/

const SIS = {
  URL_PROP:   'SUPABASE_URL',
  KEY_PROP:   'SUPABASE_SERVICE_KEY',
  TABLE:      'sales_invoice',
  CONFLICT:   'sales_id',
  CHUNK:      500,
  GAP:        300,

  VASY_BASE:  'VASY_BASE_URL',
  VASY_TOKEN: 'VASY_API_TOKEN',
  VASY_BRANCH:'VASY_BRANCH_ID',
  PATH:       '/api/v1/sales/get-all-sales-orders',
  /* Not guesses. SalesAutomation.gs has been calling this exact endpoint for
     months with INV_PAGE: 100 and GAP: 20000, and the endpoint enforces the
     first one — limit 500 returns "limit cannot exceed 100". I should have
     read the working caller before writing a new one. */
  PAGE:       100,
  API_GAP:    20000,
  MAX_RUN_MS: 1500000,

  /* the sheets the backfill reads, newest last so it wins on conflict */
  SHEETS: ['Sales_Invoices_2526', 'Sales_Invoices_2627'],
};

/* ---------- helpers ---------- */

function sisNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}

function sisInt_(v) {
  const n = sisNum_(v);
  return n === null ? null : Math.round(n);
}

/** yyyy-MM-dd from whatever shape the cell holds, or null — never a guess */
function sisDate_(v) {
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

/** the financial year a date falls in, as 2526 / 2627 */
function sisFy_(iso) {
  if (!iso) return null;
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10);
  const start = (m >= 4) ? y : y - 1;
  return String(start).slice(-2) + String(start + 1).slice(-2);
}

function sisProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function sisPost_(rows) {
  const url = sisProp_(SIS.URL_PROP).replace(/\/+$/, '') +
    '/rest/v1/' + SIS.TABLE + '?on_conflict=' + SIS.CONFLICT;
  const key = sisProp_(SIS.KEY_PROP);
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });
  return { code: res.getResponseCode(), text: res.getContentText() };
}

/** one sheet row or one API record -> one Supabase row, or null if unusable */
function sisRow_(o) {
  const id = sisInt_(o.salesId);
  if (!id) return null;                 // no id means no join key
  const d = sisDate_(o.salesDate);
  return {
    sales_id:      id,
    prefix:        o.prefix ? String(o.prefix) : null,
    sales_no:      o.salesNo ? String(o.salesNo) : null,
    order_no:      o.orderNo ? String(o.orderNo) : null,
    sales_date:    d,
    due_date:      sisDate_(o.dueDate),
    inv_type:      o.type ? String(o.type) : null,
    channel_name:  o.channelName ? String(o.channelName) : null,
    status:        o.status ? String(o.status) : null,
    payment_type:  o.paymentType ? String(o.paymentType) : null,
    /* contactId is 0 for walk-in; store null so joins do not match everybody */
    contact_id:    sisInt_(o.contactId) || null,
    customer_name: (o.customerName && String(o.customerName) !== 'None')
                     ? String(o.customerName) : null,
    total:         sisNum_(o.total),
    paid_amount:   sisNum_(o.paidAmount),
    /* the API does not return a balance; the working caller computes it and
       so must this, or every API-sourced invoice would look fully open */
    balance:       (o.balance !== undefined && o.balance !== null && o.balance !== '')
                     ? sisNum_(o.balance)
                     : Math.round(((sisNum_(o.total) || 0) -
                                   (sisNum_(o.paidAmount) || 0)) * 100) / 100,
    fy:            sisFy_(d),
    source:        o.__source || 'API',
    loaded_at:     new Date().toISOString(),
  };
}

/** push in chunks, stopping at the first failure — a re-run is free */
function sisPushAll_(rows, label) {
  /* Postgres rejects a batch naming the same conflict key twice */
  const seen = {}, clean = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (seen[rows[i].sales_id]) continue;
    seen[rows[i].sales_id] = true;
    clean.unshift(rows[i]);
  }
  const dupes = rows.length - clean.length;

  let sent = 0;
  for (let i = 0; i < clean.length; i += SIS.CHUNK) {
    const batch = clean.slice(i, i + SIS.CHUNK);
    const res = sisPost_(batch);
    if (res.code < 200 || res.code >= 300) {
      throw new Error(label + ': stopped at row ' + (i + 1) + ' of ' +
        clean.length + '\n\nHTTP ' + res.code + '  ' + res.text.slice(0, 300) +
        '\n\n' + sent + ' already pushed. The upsert makes a re-run safe.');
    }
    sent += batch.length;
    if (i + SIS.CHUNK < clean.length) Utilities.sleep(SIS.GAP);
  }
  return { sent: sent, dupes: dupes };
}

/**
 * Find a tab without Registry. Looks in the active book, then in each
 * workbook id held in Script Properties.
 */
function sisFindSheet_(name) {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (sh) return sh;
  } catch (e) {}
  const props = PropertiesService.getScriptProperties().getProperties();
  const ids = [];
  Object.keys(props).forEach(function (k) {
    const v = String(props[k] || '');
    if (/BOOK_ID$|_ID$/.test(k) && v.length > 30) ids.push(v);
  });
  for (let i = 0; i < ids.length; i++) {
    try {
      const sh = SpreadsheetApp.openById(ids[i]).getSheetByName(name);
      if (sh) return sh;
    } catch (e) {}
  }
  return null;
}

/* ================= backfill from the sheets ================= */

/**
 * The year workbooks already hold 33,210 invoices pulled from the API and
 * verified against the FTP feed to the rupee. Pushing those costs no API
 * calls and no rate limit, so it is the right place to start.
 */
function backfillInvoicesFromSheets() {
  const t0 = Date.now();
  const all = [];
  const found = [];

  SIS.SHEETS.forEach(function (name) {
    /* Registry's vtSheet is nicer, but this file has to work even when the
       rest of the project will not compile — so it falls back to opening the
       year workbooks by their Script Property id. */
    let sh = null;
    try { sh = vtSheet(name); } catch (e) { sh = null; }
    if (!sh) sh = sisFindSheet_(name);
    if (!sh || sh.getLastRow() < 2) { found.push(name + ': not found'); return; }

    const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim(); });
    const need = ['salesId', 'salesDate', 'orderNo'];
    const missing = need.filter(function (c) { return hdr.indexOf(c) < 0; });
    if (missing.length) {
      found.push(name + ': missing ' + missing.join(', '));
      return;
    }

    const v = sh.getRange(2, 1, sh.getLastRow() - 1, hdr.length).getValues();
    let ok = 0, bad = 0;
    v.forEach(function (r) {
      const o = { __source: 'SHEET-BACKFILL' };
      hdr.forEach(function (h, i) { o[h] = r[i]; });
      const row = sisRow_(o);
      if (row) { all.push(row); ok++; } else bad++;
    });
    found.push(name + ': ' + ok.toLocaleString() + ' usable' +
      (bad ? ', ' + bad + ' without a salesId' : ''));
  });

  if (!all.length) {
    throw new Error('Nothing to push.\n\n' + found.join('\n'));
  }

  const res = sisPushAll_(all, 'backfill');
  const msg = 'INVOICE BACKFILL  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    found.join('\n') + '\n\n' +
    'pushed        : ' + res.sent.toLocaleString() + '\n' +
    (res.dupes ? 'duplicate ids : ' + res.dupes + '  (newest kept)\n' : '') +
    '\nNow run invoiceSupabaseStatus() to see the receipts match up.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return res.sent;
}

/* ================= pull fresh from the API ================= */

/**
 * Pulls the invoice register for a window and pushes it. Use this on a
 * trigger to keep the register current once the backfill is in.
 *
 * days defaults to 7. Apps Script hands a trigger an EVENT OBJECT as the
 * first argument, so the value is coerced rather than trusted — that exact
 * mistake set a refresh window to 1970-01-01 elsewhere in this project.
 */
function pullInvoicesToSupabase(days) {
  const t0 = Date.now();
  const n = Number(days);
  const d = (isFinite(n) && n > 0) ? n : 7;

  const to = new Date();
  const from = new Date(to.getTime() - d * 86400000);
  if (isNaN(from.getTime())) throw new Error('Bad window.');
  const iso = function (x) {
    return Utilities.formatDate(x, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  };

  const base = sisProp_(SIS.VASY_BASE).replace(/\/+$/, '');
  const token = sisProp_(SIS.VASY_TOKEN);
  const branch = sisProp_(SIS.VASY_BRANCH);

  const all = [];
  let offset = 0, total = 0, pages = 0;
  Logger.log('pullInvoices: last ' + d + ' days, ' + SIS.PAGE +
    ' per page, ' + (SIS.API_GAP / 1000) + 's apart');

  let ranOut = false;
  while (true) {
    if (Date.now() - t0 > SIS.MAX_RUN_MS) { ranOut = true; break; }
    const res = UrlFetchApp.fetch(base + SIS.PATH, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'api-token': token },
      payload: JSON.stringify({
        branch_list: branch,
        from_date: iso(from), to_date: iso(to),
        limit: SIS.PAGE, offset: offset,
      }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 429) { Utilities.sleep(45000); continue; }
    if (res.getResponseCode() !== 200) {
      throw new Error('HTTP ' + res.getResponseCode() + ' at offset ' + offset +
        '\n\n' + res.getContentText().slice(0, 300));
    }
    let j;
    try { j = JSON.parse(res.getContentText()); }
    catch (e) { throw new Error('Non-JSON at offset ' + offset); }
    const resp = j.response || {};
    if (!total) total = sisInt_(resp.totalCount) || 0;
    /* The array is salesDataListDTOList. I guessed items/salesOrders/data,
       found none of them, and reported "no invoices in the last 30 days" —
       which read like an answer rather than a failure. The working caller in
       sales_automation.gs has read this key for months. */
    const list = resp.salesDataListDTOList || [];
    if (!list.length) {
      if (!pages) {
        throw new Error('The API returned no list.\n\nresponse keys: ' +
          Object.keys(resp).join(', ') + '\ntotalCount: ' + resp.totalCount +
          '\n\nNothing was pushed.');
      }
      break;
    }

    list.forEach(function (o) {
      o.__source = 'API';
      const row = sisRow_(o);
      if (row) all.push(row);
    });

    pages++;
    offset += list.length;           // advance by what came back, not the ask
    Logger.log('  page ' + pages + ': ' + all.length + ' invoices so far' +
      (total ? ' of ' + total : '') + '   (' +
      Math.round((Date.now() - t0) / 1000) + 's elapsed)');
    if (total && offset >= total) break;
    if (list.length < SIS.PAGE) break;
    Utilities.sleep(SIS.API_GAP);
  }

  if (!all.length) {
    const m = 'No invoices in the last ' + d + ' days. Nothing pushed.';
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return 0;
  }

  /* whatever was fetched is pushed, even if the window did not finish —
     the upsert makes a partial push harmless and a re-run free */
  const res = sisPushAll_(all, 'api pull');
  const msg = (ranOut ? 'INVOICES — PARTIAL, ran out of time' :
    'INVOICES PULLED AND PUSHED') + '  (' +
    Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'window  : last ' + d + ' days\n' +
    'pages   : ' + pages + (total ? ' of ~' + Math.ceil(total / SIS.PAGE) : '') + '\n' +
    'pushed  : ' + res.sent.toLocaleString() + '\n' +
    (res.dupes ? 'duplicates: ' + res.dupes + '\n' : '') +
    (ranOut ? '\nStopped at offset ' + offset + ' of ' + total +
      '. What was fetched is saved. Run it again with a SHORTER window to ' +
      'cover the rest.' : '');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return res.sent;
}

/* ================= status ================= */

function invoiceSupabaseStatus() {
  const base = sisProp_(SIS.URL_PROP).replace(/\/+$/, '');
  const key = sisProp_(SIS.KEY_PROP);
  const get = function (path) {
    const r = UrlFetchApp.fetch(base + '/rest/v1/' + path, {
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
      muteHttpExceptions: true,
    });
    if (r.getResponseCode() !== 200) return null;
    try { return JSON.parse(r.getContentText()); } catch (e) { return null; }
  };

  const sum = get('v_receivables_summary?select=*');
  const s = (sum && sum[0]) || {};
  /* Read the column names the view actually has. The last version asked for
     receipted / truly_open / with_receipt, which I had renamed when the view
     was rebuilt — so it printed zeros next to a real total and looked like
     data loss. */
  const n = function (k) { return Number(s[k] || 0).toLocaleString('en-IN'); };
  const msg = 'RECEIVABLES\n\n' +
    (s.invoices
      ? 'invoices   : ' + n('invoices') + '\n' +
        'billed     : ' + n('billed') + '\n' +
        'paid       : ' + n('paid') + '\n' +
        'OPEN       : ' + n('open_amount') + '   across ' +
          n('open_invoices') + ' invoices\n\n' +
        'ageing\n' +
        '   0-30    : ' + n('open_0_30') + '\n' +
        '   31-60   : ' + n('open_31_60') + '\n' +
        '   61-90   : ' + n('open_61_90') + '\n' +
        '   over 90 : ' + n('open_90_plus') + '\n\n' +
        'paid but untagged : ' + n('untagged_invoices') + ' invoices, ' +
          n('untagged_value') + '\n' +
        'needs a manual split : ' + n('needs_manual_split') + '\n\n' +
        'receipts held from ' + (s.receipts_from || '—') + ', so only ' +
          n('open_in_receipt_era') + ' open invoices can be checked\n' +
          'against a receipt at all.'
      : 'The register is empty. Run backfillInvoicesFromSheets().');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/**
 * Fill the 10-26 August gap.
 *
 * The register was backfilled from the sheets, and the sheets were starved
 * during the outage — 1 or 2 invoices a day where there should be ~100. That
 * is why only 742 of 1,223 receipts found their invoice; the 490 unmatched
 * ids all sit INSIDE the register's range, so they are holes rather than
 * strangers.
 *
 * 30 days covers it. The dropdown cannot pass an argument, hence the wrapper.
 */
function pullInvoicesLast30Days() {
  /* ~3,000 invoices at 100 a page, 20s apart, is roughly 10 minutes. A
     manual run gets 30, so this fits; a trigger would not. */
  return pullInvoicesToSupabase(30);
}

/**
 * 90 days is ~99 pages at 20s, about 38 minutes — past even a manual run.
 * So it goes in three passes, each pushing as it finishes, and each safe to
 * repeat because the upsert is keyed on sales_id.
 *
 * Run it three times. It tells you which pass is next.
 */
function pullInvoicesLast90Days() {
  const props = PropertiesService.getScriptProperties();
  const pass = parseInt(props.getProperty('SIS_90_PASS') || '0', 10);
  const windows = [30, 60, 90];
  if (pass >= windows.length) {
    props.deleteProperty('SIS_90_PASS');
    const m = 'All three passes done. Run it again to start over.';
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return 0;
  }
  const n = pullInvoicesToSupabase(windows[pass]);
  props.setProperty('SIS_90_PASS', String(pass + 1));
  const left = windows.length - pass - 1;
  const m = 'Pass ' + (pass + 1) + ' of 3 done (last ' + windows[pass] +
    ' days, ' + n + ' invoices).\n\n' +
    (left ? 'Run pullInvoicesLast90Days() again for the next pass.'
          : 'That was the last one.');
  Logger.log(m);
  try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
  return n;
}

/** the three-pass counter, if a failed run left it part way */
function resetInvoicePasses() {
  PropertiesService.getScriptProperties().deleteProperty('SIS_90_PASS');
  try { SpreadsheetApp.getUi().alert('Pass counter cleared.'); } catch (e) {}
}

/* ================= nightly ================= */

/**
 * The register goes stale the moment we stop pulling.
 *
 * 7 days at ~110 invoices a day is about 8 pages — three minutes, well
 * inside a triggered run. The window also catches edits to older invoices,
 * because from_date on this endpoint filters on when a record CHANGED, not
 * when it was raised: a 30-day pull returned 498 invoices older than 30 days.
 *
 * 04:30, before the 05:30 sales-invoice sheet refresh, so Supabase is
 * current when the analytics chain reads it.
 */
function nightlyInvoiceSync() {
  const t0 = Date.now();
  let msg;
  try {
    const n = pullInvoicesToSupabase(7);
    msg = 'ok  ' + n + ' invoices  (' +
      Math.round((Date.now() - t0) / 1000) + 's)';
  } catch (e) {
    msg = 'FAILED  ' + (e && e.message ? e.message : e);
  }
  /* write to the same log the rest of the automation uses, if it is there */
  try { sautLog_('Invoice sync', msg.indexOf('FAILED') === 0 ? 'FAILED' : 'ok', msg); }
  catch (e) { Logger.log('Invoice sync: ' + msg); }
  return msg;
}

function installInvoiceTrigger() {
  removeInvoiceTrigger();
  ScriptApp.newTrigger('nightlyInvoiceSync')
    .timeBased().atHour(4).nearMinute(30).everyDays(1).create();
  const m = 'Invoice sync will run nightly at about 04:30.\n\n' +
    'That is before the 05:30 sheet refresh, so Supabase is current when\n' +
    'the analytics chain reads it.';
  Logger.log(m);
  try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
}

function removeInvoiceTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyInvoiceSync') {
      ScriptApp.deleteTrigger(t); n++;
    }
  });
  return n;
}

function onOpenInvoiceSync() {
  SpreadsheetApp.getUi()
    .createMenu('🧾 Invoices → Supabase')
    .addItem('Backfill from the sheets', 'backfillInvoicesFromSheets')
    .addItem('Pull last 7 days from the API', 'pullInvoicesToSupabase')
    .addItem('Pull last 30 days (fills the Aug gap)', 'pullInvoicesLast30Days')
    .addItem('Pull last 90 days', 'pullInvoicesLast90Days')
    .addItem('Status', 'invoiceSupabaseStatus')
    .addSeparator()
    .addItem('Run nightly at 04:30', 'installInvoiceTrigger')
    .addItem('Stop the nightly run', 'removeInvoiceTrigger')
    .addItem('Reset the pass counter', 'resetInvoicePasses')
    .addToUi();
}