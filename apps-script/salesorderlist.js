/**********************************************************************
 * VITHYA TRADERS — SALES ORDER LIST  (invoice level)   [CORRECTED]
 *
 * ENDPOINT — from the Vasy docs, confirmed
 *      POST /api/v1/sales/get-all-sales-orders
 *      body: { branch_list, from_date, to_date, limit, offset }
 *
 *   Earlier attempts used /api/v1/sales. That is a different endpoint —
 *   the PATH was wrong, not the body.
 *
 * WHAT COMES BACK, per invoice
 *      salesId  prefix  salesNo  salesDate  dueDate
 *      paymentType  total  paidAmount  contactId  orderNo
 *      customerName  channelId  channelName  status  type
 *
 * WHY THIS IS THE RIGHT SOURCE FOR OUTSTANDING
 *   balance = total - paidAmount, per invoice, straight from the ERP.
 *   contactId is a real customer key, so parties match on ID rather than name
 *   — which matters when ". A2Z PUMPS" and "A 2 Z PUMPS" are two different
 *   accounts in your books.
 *   dueDate makes ageing buckets possible without inference.
 *
 * WRITES TO VT_Transactions, never the master workbook.
 * Run setupTransactionsBook() (TxnSetup.gs) once before the first pull.
 *
 * RUN
 *   1. solProbe()            read only — counts per year + one real invoice
 *   2. pullSalesInvoices()   resumable; repeat until it says COMPLETE
 *   3. buildOutstanding()    invoice-level outstanding + ageing per customer
 **********************************************************************/

const SOL = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',

  PATH: '/api/v1/sales/get-all-sales-orders',
  SHEET: 'Sales_Invoices',
  OUT_SHEET: 'Customer_Outstanding',

  CURSOR: 'SOL_CURSOR',
  TOTAL: 'SOL_TOTAL',

  FROM: '2025-04-01T00:00:00Z',      // FY25-26 onward
  TO:   '2030-03-31T23:59:59Z',

  PAGE: 100,                         // API rejects anything above 100
  SLEEP_PROP: 'SOL_SLEEP',           // adaptive; starts low, backs off on 429
  SLEEP_START: 2500,
  SLEEP_MAX: 30000,
  BACKOFF: [60000, 120000, 180000, 240000],
  MAX_RUN_MS: 1200000,               // 20 min
};

const SOL_COLS = ['salesId','prefix','salesNo','orderNo','salesDate','dueDate',
  'type','channelName','status','paymentType','contactId','customerName',
  'total','paidAmount','balance'];

function solProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function solPost_(body) {
  const url = solProp_(SOL.BASE).replace(/\/+$/, '') + SOL.PATH;
  for (let a = 0; a <= SOL.BACKOFF.length; a++) {
    const r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'api-token': solProp_(SOL.TOKEN) },
      payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    const code = r.getResponseCode(), txt = r.getContentText();
    if (code === 200) {
      const j = JSON.parse(txt);
      if (j.status === false) throw new Error('API: ' + (j.message || ''));
      return j.response || {};
    }
    if (code === 429) {
      solSlower_();                       // learn a safer pace for next time
      if (a === SOL.BACKOFF.length) return { __rate: true };
      Logger.log('   429 — waiting ' + (SOL.BACKOFF[a] / 1000) + 's');
      Utilities.sleep(SOL.BACKOFF[a]);
      continue;
    }
    throw new Error('HTTP ' + code + ' :: ' + txt.slice(0, 250));
  }
  return { __rate: true };
}

/* ---- adaptive pacing ----
   This is a /sales/ endpoint, not /report/, so it may tolerate a much shorter
   gap than the 30s the report endpoints need. Start optimistic, slow down only
   when the API actually pushes back, and remember the pace that worked. */
function solGap_() {
  const v = PropertiesService.getScriptProperties().getProperty(SOL.SLEEP_PROP);
  const n = parseInt(v || '', 10);
  return isFinite(n) && n > 0 ? n : SOL.SLEEP_START;
}
function solSlower_() {
  const now = solGap_();
  const next = Math.min(SOL.SLEEP_MAX, Math.round(now * 2));
  PropertiesService.getScriptProperties().setProperty(SOL.SLEEP_PROP, String(next));
  Logger.log('   pace: ' + now + 'ms -> ' + next + 'ms');
  return next;
}

function solBody_(from, to, limit, offset) {
  return { branch_list: solProp_(SOL.BRANCH), from_date: from, to_date: to,
    limit: limit, offset: offset };
}
function solRows_(d) { return (d && d.salesDataListDTOList) || []; }
function solNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function solDate_(v) {
  if (!v) return '';
  const s = String(v);
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s.slice(0, 10);
}

/* ================= 1. probe ================= */

function solProbe() {
  Logger.log('════════ SALES ORDER LIST ════════');
  Logger.log('POST ' + SOL.PATH);

  const r = solPost_(solBody_(SOL.FROM, SOL.TO, 3, 0));
  if (r.__rate) { Logger.log('rate limited — try again shortly'); return; }
  const rows = solRows_(r);
  Logger.log('totalCount (FY25-26 onward): ' + solNum_(r.totalCount));
  Logger.log('rows returned: ' + rows.length);

  if (rows.length) {
    Logger.log('');
    Logger.log('── one real invoice ──');
    Object.keys(rows[0]).forEach(k => Logger.log('   ' + k + ' = ' + JSON.stringify(rows[0][k])));
    const t = solNum_(rows[0].total), p = solNum_(rows[0].paidAmount);
    Logger.log('');
    Logger.log('   balance = total - paidAmount = ' + (t - p).toFixed(2));
  }

  Logger.log('');
  Logger.log('── invoices per financial year ──');
  const yrs = [2024, 2025, 2026];
  for (let i = 0; i < yrs.length; i++) {
    Utilities.sleep(solGap_());
    const y = yrs[i];
    try {
      const rr = solPost_(solBody_(y + '-04-01T00:00:00Z',
        (y + 1) + '-03-31T23:59:59Z', 1, 0));
      if (rr.__rate) { Logger.log('   FY ' + y + ' : rate limited'); continue; }
      Logger.log('   FY ' + y + '-' + ((y + 1) % 100) + ' : ' +
        solNum_(rr.totalCount) + ' invoices');
    } catch (e) { Logger.log('   FY ' + y + ' : ' + e.message); }
  }

  const total = solNum_(r.totalCount);
  const calls = Math.ceil(total / 500);
  Logger.log('');
  Logger.log('at 500/call = ' + calls + ' calls  ≈ ' + Math.round(calls * 30 / 60) + ' min');
  try { SpreadsheetApp.getUi().alert('Sales orders: ' + total +
    ' from FY25-26.\n\nSee the log, then run pullSalesInvoices().'); } catch (e) {}
}

/* ================= 2. pull ================= */

function solSheet_(reset) {
  const ss = txnBook_();                       // VT_Transactions, not the master
  let sh = vtSheet(SOL.SHEET);
  if (!sh) { sh = ss.insertSheet(SOL.SHEET); reset = true; }
  if (reset) {
    sh.clear();
    sh.getRange(1, 1, 1, SOL_COLS.length).setValues([SOL_COLS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SOL_COLS.length).setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
  }
  return sh;
}

function pullSalesInvoices() {
  const props = PropertiesService.getScriptProperties();
  const t0 = Date.now();
  let cursor = parseInt(props.getProperty(SOL.CURSOR) || '0', 10);
  let total = parseInt(props.getProperty(SOL.TOTAL) || '0', 10);
  const sh = solSheet_(cursor === 0);
  let wrote = 0;

  Logger.log('Resuming at ' + cursor + (total ? ' of ' + total : ''));

  while (true) {
    if (Date.now() - t0 > SOL.MAX_RUN_MS) {
      solQueueNext_();          // carry on by itself in a minute
      Logger.log('Time budget reached at ' + cursor + ' / ' + total +
        '. Auto-continuing in ~1 minute.');
      try { SpreadsheetApp.getUi().alert('Paused at ' + cursor + ' / ' + total +
        '.\nIt will continue automatically — you can close this.'); } catch (e) {}
      return cursor;
    }

    const r = solPost_(solBody_(SOL.FROM, SOL.TO, SOL.PAGE, cursor));
    if (r.__rate) {
      solQueueNext_(5);
      Logger.log('Rate limited at ' + cursor + '. Auto-retrying in ~5 minutes.');
      try { SpreadsheetApp.getUi().alert('Rate limited at ' + cursor +
        '.\nIt will retry automatically.'); } catch (e) {}
      return cursor;
    }
    if (!total) {
      total = solNum_(r.totalCount);
      props.setProperty(SOL.TOTAL, String(total));
      Logger.log('Total invoices: ' + total);
    }
    const rows = solRows_(r);
    if (!rows.length) break;

    const vals = rows.map(o => {
      const t = solNum_(o.total), p = solNum_(o.paidAmount);
      return [o.salesId, o.prefix || '', o.salesNo, o.orderNo || '',
        solDate_(o.salesDate), solDate_(o.dueDate),
        o.type || '', o.channelName || '', o.status || '', o.paymentType || '',
        (o.contactId === undefined || o.contactId === null) ? '' : o.contactId,
        o.customerName || '', t, p, Math.round((t - p) * 100) / 100];
    });
    sh.getRange(sh.getLastRow() + 1, 1, vals.length, SOL_COLS.length).setValues(vals);
    wrote += vals.length;
    cursor += rows.length;
    props.setProperty(SOL.CURSOR, String(cursor));
    Logger.log('  ' + cursor + ' / ' + total);

    if (cursor >= total) break;
    Utilities.sleep(solGap_());
  }

  props.deleteProperty(SOL.CURSOR);
  props.deleteProperty(SOL.TOTAL);
  solClearTriggers_();
  const msg = 'COMPLETE — ' + wrote + ' invoice(s) this run, ' + cursor + ' total.\n\n' +
    'Next: buildOutstanding()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return cursor;
}

/* ---- auto-continue plumbing ---- */
function solQueueNext_(mins) {
  solClearTriggers_();
  ScriptApp.newTrigger('pullSalesInvoices').timeBased()
    .after((mins || 1) * 60 * 1000).create();
}
function solClearTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'pullSalesInvoices') ScriptApp.deleteTrigger(t);
  });
}

/* ================= 3. outstanding ================= */

const OUT_COLS = ['contactId','customerName','lane','invoices','open_invoices',
  'total_billed','total_paid','outstanding',
  'age_0_30','age_31_60','age_61_90','age_90_plus',
  'oldest_open','oldest_days','last_invoice'];

function buildOutstanding(force) {
  const ss = txnBook_();

  /* invoices may be split across per-year workbooks after splitSalesByYear */
  let src = null;
  try { src = readSalesAcrossYears(SOL.SHEET); } catch (e) { src = null; }
  if (!src || !src.rows.length) {
    const sh = vtSheet(SOL.SHEET);
    if (!sh || sh.getLastRow() < 2) throw new Error('Pull invoices first.');
    const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const H0 = {}; hdr.forEach((h, i) => H0[String(h).trim()] = i);
    src = { H: H0, rows: sh.getRange(2, 1, sh.getLastRow() - 1,
      sh.getLastColumn()).getValues() };
  }
  const H = src.H;
  const v = src.rows;

  const today = new Date();
  const agg = {};
  let walkin = 0;

  v.forEach(r => {
    const cidRaw = r[H.contactId];
    const cid = String(cidRaw === '' || cidRaw === null ? 0 : cidRaw);
    const name = String(r[H.customerName] || '').trim();
    /* POS walk-ins carry contactId 0 and no name — no receivable */
    if (cid === '0' && !name) { walkin++; return; }
    const key = cid !== '0' ? cid : ('name:' + name);
    if (!agg[key]) agg[key] = { cid: cid, name: name, n: 0, open: 0,
      billed: 0, paid: 0, bal: 0, b: [0, 0, 0, 0],
      oldest: '', oldestDays: 0, last: '' };
    const a = agg[key];
    if (!a.name && name) a.name = name;

    const t = solNum_(r[H.total]), p = solNum_(r[H.paidAmount]), bal = solNum_(r[H.balance]);
    a.n++; a.billed += t; a.paid += p;
    const inv = String(r[H.salesDate] || '');
    if (inv > a.last) a.last = inv;
    if (bal <= 0.5) return;                     // settled

    a.open++; a.bal += bal;
    const due = String(r[H.dueDate] || r[H.salesDate] || '');
    let days = 0;
    if (due) {
      const d = new Date(due + 'T00:00:00');
      if (!isNaN(d.getTime())) days = Math.floor((today - d) / 86400000);
    }
    if (days <= 30) a.b[0] += bal;
    else if (days <= 60) a.b[1] += bal;
    else if (days <= 90) a.b[2] += bal;
    else a.b[3] += bal;
    if (!a.oldest || due < a.oldest) { a.oldest = due; a.oldestDays = days; }
  });

  const r2 = x => Math.round(x * 100) / 100;
  const out = Object.keys(agg).map(k => {
    const a = agg[k];
    const lane = a.name.charAt(0) === '.' ? 'WO' : 'W';
    return [a.cid, a.name, lane, a.n, a.open,
      r2(a.billed), r2(a.paid), r2(a.bal),
      r2(a.b[0]), r2(a.b[1]), r2(a.b[2]), r2(a.b[3]),
      a.oldest, a.oldestDays, a.last];
  }).filter(x => x[7] > 0.5).sort((x, y) => y[7] - x[7]);

  vtGuardRebuild_(SOL.OUT_SHEET, out.length, force);
  let os = vtSheet(SOL.OUT_SHEET);
  if (!os) os = ss.insertSheet(SOL.OUT_SHEET);
  os.clear();
  os.getRange(1, 1, 1, OUT_COLS.length).setValues([OUT_COLS]);
  os.setFrozenRows(1);
  os.getRange(1, 1, 1, OUT_COLS.length).setFontWeight('bold')
    .setBackground('#CC3018').setFontColor('#FFFFFF');
  if (out.length) os.getRange(2, 1, out.length, OUT_COLS.length).setValues(out);

  const tot = out.reduce((s, x) => s + x[7], 0);
  const b90 = out.reduce((s, x) => s + x[11], 0);
  const msg = 'OUTSTANDING BUILT\n\n' +
    'customers with a balance: ' + out.length + '\n' +
    'total outstanding: Rs ' + Math.round(tot).toLocaleString('en-IN') + '\n' +
    'over 90 days: Rs ' + Math.round(b90).toLocaleString('en-IN') +
    (tot ? '  (' + (b90 / tot * 100).toFixed(1) + '%)' : '') + '\n' +
    'walk-in rows skipped: ' + walkin + '\n\n' +
    'Invoice-level: balance = total - paidAmount, aged on dueDate.\n' +
    'Compare with your Vasy outstanding export — the gap is the\n' +
    'unallocated On Account / Advance money.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= status ================= */

function solStatus() {
  const p = PropertiesService.getScriptProperties();
  let rows = 0;
  try {
    const sh = vtSheet(SOL.SHEET);
    rows = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  } catch (e) {}
  const auto = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pullSalesInvoices').length;
  const msg = 'Sales invoices\n\nrows: ' + rows +
    '\ncursor: ' + (p.getProperty(SOL.CURSOR) || '(none)') +
    '\ntotal: ' + (p.getProperty(SOL.TOTAL) || 'unknown') +
    '\npace: ' + solGap_() + 'ms between calls' +
    '\nauto-continue: ' + (auto ? 'scheduled' : 'no');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function solReset() {
  const p = PropertiesService.getScriptProperties();
  p.deleteProperty(SOL.CURSOR); p.deleteProperty(SOL.TOTAL);
  try { SpreadsheetApp.getUi().alert('Reset — next pull starts fresh.'); } catch (e) {}
}

function solCancel() {
  solClearTriggers_();
  Logger.log('Auto-continue cancelled. The cursor is kept, so you can resume.');
  try { SpreadsheetApp.getUi().alert('Auto-continue cancelled.\nCursor kept — run again to resume.'); } catch (e) {}
}

function onOpenSalesOrders() {
  SpreadsheetApp.getUi()
    .createMenu('🧾 Sales Invoices')
    .addItem('1. Probe + counts', 'solProbe')
    .addItem('2. Pull invoices', 'pullSalesInvoices')
    .addItem('3. Build outstanding', 'buildOutstanding')
    .addSeparator()
    .addItem('Status', 'solStatus')
    .addItem('Reset cursor', 'solReset')
    .addItem('Cancel auto-continue', 'solCancel')
    .addToUi();
}