/**********************************************************************
 * VITHYA TRADERS — SALES REGISTER SIZING PROBE
 *
 * READ ONLY. Makes ~12 API calls. Writes nothing, changes nothing.
 *
 * ANSWERS
 *   1. How many sales lines exist, per financial year
 *   2. What every field actually contains for YOUR data (not the demo)
 *   3. What receiptData really holds  — mode:amount, or a receipt ID?
 *   4. Is purchasePrice populated, or null as in the demo?
 *   5. Does "pos = WO / invoice = W" hold?  Tested against the item-code
 *      suffix and the tax amount, not assumed.
 *   6. What /api/v1/sales/{id} returns — and whether it carries a receipt ID
 *      that the register does not.
 *
 * SETUP  none. Uses the Script Properties already set:
 *        VASY_BASE_URL, VASY_API_TOKEN, VASY_BRANCH_ID
 *
 * RUN    probeSalesRegister()      then send me the Execution log.
 *        probeOneSale(28315158)    to look at a single invoice in full.
 **********************************************************************/

const SP = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',
  SLEEP: 30000,          // report endpoints rate-limit hard; 30s between calls
  BACKOFF: [60000, 120000, 180000],
};

function spProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

/* POST helper with 429 backoff */
function spPost_(path, body) {
  const url = spProp_(SP.BASE).replace(/\/+$/, '') + path;
  for (let a = 0; a <= SP.BACKOFF.length; a++) {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'api-token': spProp_(SP.TOKEN) },
      payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    const txt = resp.getContentText();
    if (code === 200) {
      const j = JSON.parse(txt);
      if (j.status === false) throw new Error('status=false :: ' + (j.message || ''));
      return j.response || {};
    }
    if (code === 429) {
      if (a === SP.BACKOFF.length) throw new Error('rate limited after retries');
      Logger.log('   429 — waiting ' + (SP.BACKOFF[a] / 1000) + 's');
      Utilities.sleep(SP.BACKOFF[a]);
      continue;
    }
    throw new Error('HTTP ' + code + ' :: ' + txt.slice(0, 250));
  }
}

/* GET helper */
function spGet_(path, q) {
  let url = spProp_(SP.BASE).replace(/\/+$/, '') + path;
  if (q) {
    const s = Object.keys(q).filter(k => q[k] !== '' && q[k] !== undefined)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
    if (s) url += '?' + s;
  }
  const resp = UrlFetchApp.fetch(url, {
    method: 'get', headers: { 'api-token': spProp_(SP.TOKEN) }, muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  const txt = resp.getContentText();
  if (code !== 200) return { __error: 'HTTP ' + code + ' :: ' + txt.slice(0, 300) };
  try {
    const j = JSON.parse(txt);
    if (j.status === false) return { __error: 'status=false :: ' + (j.message || '') };
    return j.response !== undefined ? j.response : j;
  } catch (e) { return { __error: 'non-JSON :: ' + txt.slice(0, 200) }; }
}

function spSales_(from, to, limit, offset) {
  return spPost_('/api/v1/report/sales-item-register/invoice', {
    branch_list: spProp_(SP.BRANCH),
    from_date: from, to_date: to,
    limit: limit, offset: offset || 0,
  });
}

/* ================= main probe ================= */

function probeSalesRegister() {
  Logger.log('════════ SALES REGISTER SIZING PROBE ════════');
  Logger.log('branch ' + spProp_(SP.BRANCH) + '   base ' + spProp_(SP.BASE));

  /* ---- 1. total, all time ---- */
  const all = spSales_('2015-04-01T00:00:00Z', '2030-03-31T00:00:00Z', 1, 0);
  const total = Number(all.totalCount || 0);
  Logger.log('');
  Logger.log('TOTAL SALES LINES (all time): ' + total);
  Utilities.sleep(SP.SLEEP);

  /* ---- 2. per financial year (Apr–Mar) ---- */
  Logger.log('');
  Logger.log('── by financial year ──');
  const years = [2023, 2024, 2025, 2026];
  for (let i = 0; i < years.length; i++) {
    const y = years[i];
    try {
      const r = spSales_(y + '-04-01T00:00:00Z', (y + 1) + '-03-31T23:59:59Z', 1, 0);
      Logger.log('  FY ' + y + '-' + ((y + 1) % 100) + ' : ' + Number(r.totalCount || 0) + ' lines');
    } catch (e) {
      Logger.log('  FY ' + y + ' : FAILED ' + e.message);
    }
    if (i < years.length - 1) Utilities.sleep(SP.SLEEP);
  }
  Utilities.sleep(SP.SLEEP);

  /* ---- 3. a real sample page ---- */
  Logger.log('');
  Logger.log('── sample of 200 recent lines ──');
  const smp = spSales_('2026-04-01T00:00:00Z', '2030-03-31T00:00:00Z', 200, 0);
  const rows = smp.salesItemRegisterData || [];
  Logger.log('returned ' + rows.length + ' rows');

  if (!rows.length) {
    Logger.log('No rows in that window — try an earlier date range.');
    return;
  }

  /* full field dump of one row */
  Logger.log('');
  Logger.log('── every field on one real line ──');
  const one = rows[0];
  Object.keys(one).forEach(k => Logger.log('   ' + k + ' = ' + JSON.stringify(one[k])));

  /* ---- 4. receiptData: what does it really hold? ---- */
  Logger.log('');
  Logger.log('── receiptData: 12 distinct values ──');
  const seenR = {}, listR = [];
  rows.forEach(r => {
    const v = String(r.receiptData === null || r.receiptData === undefined ? '(null)' : r.receiptData);
    if (!seenR[v] && listR.length < 12) { seenR[v] = 1; listR.push(v); }
  });
  listR.forEach(v => Logger.log('   ' + v));
  const nullR = rows.filter(r => r.receiptData === null || r.receiptData === '').length;
  Logger.log('   null/blank: ' + nullR + ' of ' + rows.length);
  Logger.log('   >> does any of the above contain a receipt ID, or only mode:amount?');

  /* ---- 5. purchasePrice / landingCost availability ---- */
  const ppNull = rows.filter(r => r.purchasePrice === null || r.purchasePrice === '').length;
  const lcNull = rows.filter(r => r.landingCost === null || r.landingCost === '').length;
  const prNull = rows.filter(r => r.profit === null || r.profit === '').length;
  Logger.log('');
  Logger.log('── cost fields on sales lines ──');
  Logger.log('   purchasePrice null : ' + ppNull + ' / ' + rows.length);
  Logger.log('   landingCost null   : ' + lcNull + ' / ' + rows.length);
  Logger.log('   profit null        : ' + prNull + ' / ' + rows.length);
  Logger.log('   batchNo blank      : ' +
    rows.filter(r => !r.batchNo).length + ' / ' + rows.length);

  /* ---- 6. TEST THE CLAIM: pos = WO, invoice = W ---- */
  Logger.log('');
  Logger.log('── testing "pos = WO, invoice = W" ──');
  const grid = {};
  let taxOnWo = 0, noTaxOnW = 0;
  rows.forEach(r => {
    const type = String(r.type || '?');
    const code = String(r.itemCode || '');
    const lane = code.slice(-1) === '/' ? 'WO' : 'W';
    const k = type + ' + ' + lane;
    grid[k] = (grid[k] || 0) + 1;
    const tax = Number(r.taxAmount) || 0;
    if (lane === 'WO' && tax > 0) taxOnWo++;
    if (lane === 'W' && tax === 0) noTaxOnW++;
  });
  Object.keys(grid).sort().forEach(k =>
    Logger.log('   ' + k + ' : ' + grid[k] + ' (' + (grid[k] / rows.length * 100).toFixed(1) + '%)'));
  Logger.log('   WO item WITH tax    : ' + taxOnWo);
  Logger.log('   W item WITHOUT tax  : ' + noTaxOnW);
  Logger.log('   >> if pos+WO and invoice+W dominate, the claim holds');

  /* orderType too */
  const ot = {};
  rows.forEach(r => { const k = String(r.orderType || '?'); ot[k] = (ot[k] || 0) + 1; });
  Logger.log('   orderType: ' + JSON.stringify(ot));

  /* ---- 7. customer coverage ---- */
  const noCust = rows.filter(r => !r.customerName || !String(r.customerName).trim()).length;
  const gst = rows.filter(r => r.billingGstIn && String(r.billingGstIn).trim()).length;
  Logger.log('');
  Logger.log('── customer coverage ──');
  Logger.log('   blank customerName : ' + noCust + ' / ' + rows.length);
  Logger.log('   has billingGstIn   : ' + gst + ' / ' + rows.length);

  /* ---- 8. one salesNo, to fetch by id next ---- */
  const sn = rows[0].salesNo;
  Logger.log('');
  Logger.log('── next step ──');
  Logger.log('   a salesNo from your data: ' + sn);
  Logger.log('   run probeOneSale(<numeric sales id>) to inspect a single invoice');

  /* ---- 9. planning maths ---- */
  const calls = Math.ceil(total / 500);
  Logger.log('');
  Logger.log('════════ PLAN ════════');
  Logger.log('lines: ' + total + '   at 500/call = ' + calls + ' calls');
  Logger.log('at 30s spacing  ≈ ' + Math.round(calls * 30 / 60) + ' minutes of API time');
  Logger.log('at 60s spacing  ≈ ' + Math.round(calls * 60 / 60) + ' minutes');
  Logger.log('cells if stored raw: ' + (total * 43).toLocaleString() +
    '   (Sheets limit 10,000,000)');

  try {
    SpreadsheetApp.getUi().alert('Sales probe complete: ' + total +
      ' lines, ~' + calls + ' calls.\n\nSee the Execution log for the full report.');
  } catch (e) {}
  return total;
}

/* ================= single invoice ================= */

/**
 * Looks at one sale in full. This is where a receipt ID would live if the
 * register does not carry one.
 * Pass the numeric sales id, e.g. probeOneSale(28315158)
 */
function probeOneSale(salesId) {
  if (!salesId) throw new Error('Pass a sales id, e.g. probeOneSale(28315158)');
  Logger.log('════════ SINGLE SALE ' + salesId + ' ════════');

  const paths = ['/api/v1/sales/' + salesId, '/api/v1/sale/' + salesId];
  let got = null, used = '';
  for (let i = 0; i < paths.length; i++) {
    const r = spGet_(paths[i]);
    if (!r.__error) { got = r; used = paths[i]; break; }
    Logger.log(paths[i] + '  ->  ' + r.__error);
    Utilities.sleep(3000);
  }
  if (!got) { Logger.log('Could not fetch the sale on either path.'); return; }

  Logger.log('OK via ' + used);
  Logger.log('');
  dumpKeys_(got, '', 0);

  Logger.log('');
  Logger.log('>> LOOK FOR: a receipt id / payment id / voucher no, and whether');
  Logger.log('   several invoices can share one receipt. That decides whether');
  Logger.log('   customer outstanding can be built on fact or only inference.');
}

/* recursive but shallow key dump, so nested payment objects are visible */
function dumpKeys_(o, prefix, depth) {
  if (depth > 3) return;
  if (Array.isArray(o)) {
    Logger.log(prefix + '  [array of ' + o.length + ']');
    if (o.length) dumpKeys_(o[0], prefix + '[0].', depth + 1);
    return;
  }
  if (o === null || typeof o !== 'object') {
    Logger.log(prefix + ' = ' + JSON.stringify(o));
    return;
  }
  Object.keys(o).forEach(k => {
    const v = o[k];
    if (v !== null && typeof v === 'object') dumpKeys_(v, prefix + k + '.', depth + 1);
    else Logger.log('   ' + prefix + k + ' = ' + JSON.stringify(v));
  });
}

/* ================= invoice-level list ================= */

/** The lighter invoice-level endpoint — may carry payment status for outstanding. */
function probeAllSales() {
  Logger.log('════════ GET ALL SALES DATA ════════');
  const tries = [
    { p: '/api/v1/sales', q: { branchId: spProp_(SP.BRANCH), limit: 5, offset: 0 } },
    { p: '/api/v1/sales/all', q: { branchId: spProp_(SP.BRANCH), limit: 5, offset: 0 } },
  ];
  for (let i = 0; i < tries.length; i++) {
    const r = spGet_(tries[i].p, tries[i].q);
    if (r.__error) { Logger.log(tries[i].p + '  ->  ' + r.__error); Utilities.sleep(3000); continue; }
    Logger.log('OK via ' + tries[i].p);
    const items = r.items || r.salesData || (Array.isArray(r) ? r : null);
    if (items && items.length) {
      Logger.log('totalCount: ' + (r.totalCount === undefined ? '(not given)' : r.totalCount));
      Logger.log('');
      Logger.log('── one invoice ──');
      dumpKeys_(items[0], '', 0);
    } else {
      dumpKeys_(r, '', 0);
    }
    return;
  }
  Logger.log('Neither path worked — the endpoint may need different parameters.');
}

function onOpenSalesProbe() {
  SpreadsheetApp.getUi()
    .createMenu('🔎 Sales Probe')
    .addItem('Size the sales register', 'probeSalesRegister')
    .addItem('Inspect all-sales list', 'probeAllSales')
    .addToUi();
}

function runMySale() {
  probeOneSale(28315158);
}
