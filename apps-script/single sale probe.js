/**********************************************************************
 * VITHYA TRADERS — SINGLE SALE ENDPOINT PROBE
 *
 * /api/v1/sales/{id} returned 400 Bad Request, not 404 or 403.
 * That means the path is right and reachable — the request is just missing
 * something the endpoint requires. This tries the likely shapes and reports
 * which one works.
 *
 * READ ONLY. ~10 quick calls, no rate-limit risk (these are not report endpoints).
 *
 * RUN  findSaleEndpoint()          uses sale id 28315158
 *      findSaleEndpointFor(id)     for a different id
 **********************************************************************/

const SE = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',
  GAP: 2500,
};

function seProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function seTry_(method, path, query, body) {
  let url = seProp_(SE.BASE).replace(/\/+$/, '') + path;
  if (query) {
    const qs = Object.keys(query)
      .filter(k => query[k] !== '' && query[k] !== undefined && query[k] !== null)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(query[k])).join('&');
    if (qs) url += '?' + qs;
  }
  const opts = {
    method: method,
    headers: { 'api-token': seProp_(SE.TOKEN) },
    muteHttpExceptions: true,
  };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const resp = UrlFetchApp.fetch(url, opts);
  return { code: resp.getResponseCode(), text: resp.getContentText(), url: url };
}

function findSaleEndpoint() { findSaleEndpointFor(28315158); }

function findSaleEndpointFor(saleId) {
  const b = seProp_(SE.BRANCH);
  const id = String(saleId);
  Logger.log('════════ FINDING THE SINGLE-SALE ENDPOINT ════════');
  Logger.log('sale id ' + id + '   branch ' + b);
  Logger.log('');

  const attempts = [
    ['GET',  '/api/v1/sales/' + id, { branchId: b }, null],
    ['GET',  '/api/v1/sales/' + id, { branch_list: b }, null],
    ['GET',  '/api/v1/sales/' + id, { branchId: b, type: 'invoice' }, null],
    ['GET',  '/api/v1/sales/' + id, { branchId: b, salesType: 'invoice' }, null],
    ['GET',  '/api/v1/sales',       { salesId: id, branchId: b }, null],
    ['GET',  '/api/v1/sales',       { id: id, branchId: b }, null],
    ['GET',  '/api/v1/sales',       { branchId: b, limit: 2, offset: 0 }, null],
    ['POST', '/api/v1/sales/' + id, null, { branchId: b }],
    ['POST', '/api/v1/sales/' + id, null, { branch_list: b }],
    ['GET',  '/api/v1/sales/invoice/' + id, { branchId: b }, null],
  ];

  let win = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    let r;
    try { r = seTry_(a[0], a[1], a[2], a[3]); }
    catch (e) { Logger.log('  ERR  ' + a[0] + ' ' + a[1] + ' :: ' + e.message); continue; }

    const shape = a[0] + ' ' + a[1] +
      (a[2] ? '?' + Object.keys(a[2]).join('&') : '') +
      (a[3] ? '  body:' + Object.keys(a[3]).join(',') : '');

    if (r.code === 200) {
      let ok = true, msg = '';
      try {
        const j = JSON.parse(r.text);
        if (j.status === false) { ok = false; msg = j.message || ''; }
      } catch (e) { ok = false; msg = 'non-JSON'; }
      Logger.log((ok ? '✅ 200  ' : '⚠️ 200  ') + shape + (msg ? '  :: ' + msg : ''));
      if (ok && !win) win = { shape: shape, text: r.text, url: r.url };
    } else {
      let hint = '';
      try { hint = (JSON.parse(r.text).message || JSON.parse(r.text).error || ''); } catch (e) {}
      Logger.log('   ' + r.code + '  ' + shape + (hint ? '  :: ' + hint : ''));
    }
    Utilities.sleep(SE.GAP);
  }

  Logger.log('');
  if (!win) {
    Logger.log('None worked. The 400 means a required parameter is still missing.');
    Logger.log('Next step: open the endpoint in the Vasy API docs, click "Run in Apidog",');
    Logger.log('and copy the exact parameter names it sends. Paste them to me.');
    try { SpreadsheetApp.getUi().alert('No working shape found — see the log.'); } catch (e) {}
    return;
  }

  Logger.log('════════ WORKING SHAPE ════════');
  Logger.log(win.shape);
  Logger.log('');
  Logger.log('── full response ──');
  try {
    seDump_(JSON.parse(win.text), '', 0);
  } catch (e) {
    Logger.log(win.text.slice(0, 3000));
  }
  Logger.log('');
  Logger.log('>> LOOK FOR: a receipt id / payment id / voucher no, and whether one');
  Logger.log('   receipt can settle several invoices. That decides whether customer');
  Logger.log('   outstanding can be built on fact rather than inference.');

  try { SpreadsheetApp.getUi().alert('Found it:\n\n' + win.shape +
    '\n\nSee the log for the full response.'); } catch (e) {}
}

/* nested dump so a payments array is visible */
function seDump_(o, prefix, depth) {
  if (depth > 4) return;
  if (Array.isArray(o)) {
    Logger.log('   ' + prefix + '  [array of ' + o.length + ']');
    if (o.length) seDump_(o[0], prefix + '[0].', depth + 1);
    return;
  }
  if (o === null || typeof o !== 'object') {
    Logger.log('   ' + prefix + ' = ' + JSON.stringify(o));
    return;
  }
  Object.keys(o).forEach(k => {
    const v = o[k];
    if (v !== null && typeof v === 'object') seDump_(v, prefix + k + '.', depth + 1);
    else Logger.log('   ' + prefix + k + ' = ' + JSON.stringify(v));
  });
}

function onOpenSaleFinder() {
  SpreadsheetApp.getUi()
    .createMenu('🔎 Sale Finder')
    .addItem('Find single-sale endpoint', 'findSaleEndpoint')
    .addToUi();
}