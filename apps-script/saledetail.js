/**********************************************************************
 * VITHYA TRADERS — SALES ORDER DETAIL
 *
 * The documented parameters are:
 *      salesId    (path)
 *      branch_id  (query)   <- underscore, not branchId
 *
 * That was the missing piece. The docs also state the response carries
 * "Receipt Information" and "Payment Details" — which is what decides
 * whether customer outstanding can be built on fact rather than inference.
 *
 * READ ONLY.
 *
 * RUN  saleDetail()            uses 28315158
 *      saleDetailFor(id)       any other sales id
 *      salesListProbe()        finds the Sales Order List endpoint that
 *                              supplies salesId values in bulk
 **********************************************************************/

const SD = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',
};

function sdProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function sdCall_(method, path, query, body) {
  let url = sdProp_(SD.BASE).replace(/\/+$/, '') + path;
  if (query) {
    const qs = Object.keys(query)
      .filter(k => query[k] !== '' && query[k] !== undefined && query[k] !== null)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&');
    if (qs) url += '?' + qs;
  }
  const opts = { method: method, headers: { 'api-token': sdProp_(SD.TOKEN) },
    muteHttpExceptions: true };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch(url, opts);
  return { code: r.getResponseCode(), text: r.getContentText(), url: url };
}

/* ---------- the detail call ---------- */

function saleDetail() { saleDetailFor(28315158); }

function saleDetailFor(salesId) {
  const id = String(salesId);
  const b = sdProp_(SD.BRANCH);
  Logger.log('════════ SALES ORDER DETAIL  ' + id + ' ════════');

  const r = sdCall_('GET', '/api/v1/sales/' + id, { branch_id: b });
  Logger.log('GET /api/v1/sales/' + id + '?branch_id=' + b + '   ->   ' + r.code);

  if (r.code !== 200) {
    Logger.log(r.text.slice(0, 600));
    Logger.log('');
    Logger.log('If this is still 400, the salesId may not exist for this branch.');
    Logger.log('Run salesListProbe() to get valid salesId values first.');
    return;
  }

  let j;
  try { j = JSON.parse(r.text); }
  catch (e) { Logger.log('non-JSON: ' + r.text.slice(0, 500)); return; }
  if (j.status === false) { Logger.log('status=false :: ' + j.message); return; }

  const d = (j.response !== undefined) ? j.response : j;

  /* top-level shape first, so the structure is obvious */
  Logger.log('');
  Logger.log('── top-level keys ──');
  Object.keys(d).forEach(k => {
    const v = d[k];
    const t = Array.isArray(v) ? ('array[' + v.length + ']') :
      (v === null ? 'null' : typeof v);
    Logger.log('   ' + k + '   (' + t + ')');
  });

  /* the receipt / payment block — the reason we are here */
  Logger.log('');
  Logger.log('════════ RECEIPT / PAYMENT ════════');
  let found = false;
  Object.keys(d).forEach(k => {
    if (!/receipt|payment|paid|settle|adjust/i.test(k)) return;
    found = true;
    Logger.log('');
    Logger.log('── ' + k + ' ──');
    sdDump_(d[k], k + '.', 0);
  });
  if (!found) Logger.log('   no key matching receipt/payment at the top level');

  /* everything else, nested */
  Logger.log('');
  Logger.log('════════ FULL RESPONSE ════════');
  sdDump_(d, '', 0);

  Logger.log('');
  Logger.log('>> KEY QUESTIONS');
  Logger.log('   1. Is there a receipt id (not just mode + amount)?');
  Logger.log('   2. Can one receipt settle SEVERAL invoices? If a receipt id');
  Logger.log('      repeats across sales, outstanding can be built on fact.');
  Logger.log('   3. Is there a balance / due / outstanding amount per order?');

  try { SpreadsheetApp.getUi().alert('Sale ' + id + ' fetched. See the Execution log.'); }
  catch (e) {}
}

function sdDump_(o, prefix, depth) {
  if (depth > 5) { Logger.log('   ' + prefix + ' …deeper'); return; }
  if (Array.isArray(o)) {
    Logger.log('   ' + prefix + '  [array of ' + o.length + ']');
    for (let i = 0; i < Math.min(o.length, 3); i++) sdDump_(o[i], prefix + '[' + i + '].', depth + 1);
    if (o.length > 3) Logger.log('   ' + prefix + '  …and ' + (o.length - 3) + ' more');
    return;
  }
  if (o === null || typeof o !== 'object') {
    Logger.log('   ' + prefix + ' = ' + JSON.stringify(o));
    return;
  }
  Object.keys(o).forEach(k => {
    const v = o[k];
    if (v !== null && typeof v === 'object') sdDump_(v, prefix + k + '.', depth + 1);
    else Logger.log('   ' + prefix + k + ' = ' + JSON.stringify(v));
  });
}

/* ---------- find the Sales Order List endpoint ---------- */

/**
 * The detail call needs a salesId. This finds the list endpoint that supplies
 * them in bulk — which is also the likely source for invoice-level outstanding.
 */
function salesListProbe() {
  const b = sdProp_(SD.BRANCH);
  Logger.log('════════ SALES ORDER LIST ════════');

  const tries = [
    ['POST', '/api/v1/sales', null, { branch_id: b, limit: 3, offset: 0,
      from_date: '2026-04-01T00:00:00Z', to_date: '2030-03-31T00:00:00Z' }],
    ['POST', '/api/v1/sales/all', null, { branch_id: b, limit: 3, offset: 0 }],
    ['POST', '/api/v1/sales/list', null, { branch_id: b, limit: 3, offset: 0 }],
    ['GET',  '/api/v1/sales/all', { branch_id: b, limit: 3, offset: 0 }, null],
    ['GET',  '/api/v1/sales/list', { branch_id: b, limit: 3, offset: 0 }, null],
  ];

  for (let i = 0; i < tries.length; i++) {
    const t = tries[i];
    let r;
    try { r = sdCall_(t[0], t[1], t[2], t[3]); }
    catch (e) { Logger.log('  ERR ' + t[0] + ' ' + t[1] + ' :: ' + e.message); continue; }

    if (r.code === 200) {
      let j = null;
      try { j = JSON.parse(r.text); } catch (e) {}
      if (j && j.status !== false) {
        Logger.log('✅ ' + t[0] + ' ' + t[1]);
        const d = (j.response !== undefined) ? j.response : j;
        Logger.log('');
        sdDump_(d, '', 0);
        Logger.log('');
        Logger.log('>> use the salesId values above with saleDetailFor(<id>)');
        return;
      }
      Logger.log('   200 but status=false : ' + t[0] + ' ' + t[1] +
        ' :: ' + (j ? j.message : ''));
    } else {
      let hint = '';
      try { const e = JSON.parse(r.text); hint = e.message || e.error || ''; } catch (e) {}
      Logger.log('   ' + r.code + '  ' + t[0] + ' ' + t[1] + (hint ? '  :: ' + hint : ''));
    }
    Utilities.sleep(2500);
  }
  Logger.log('');
  Logger.log('None worked. Open "Get All Sales Data" in the Vasy docs and paste me');
  Logger.log('its Information Required table, as you did for the detail endpoint.');
}

function onOpenSaleDetail() {
  SpreadsheetApp.getUi()
    .createMenu('🧾 Sale Detail')
    .addItem('Fetch sale 28315158', 'saleDetail')
    .addItem('Find sales list endpoint', 'salesListProbe')
    .addToUi();
}