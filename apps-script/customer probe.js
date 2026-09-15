/**********************************************************************
 * VITHYA TRADERS — CUSTOMER ENDPOINT PROBE
 *
 * Globals declared here (check before pasting):
 *   CPB, probeCustomerEndpoints, cpbTry_, cpbDump_
 *
 * READ ONLY. ~12 quick calls.
 *
 * ── WHY PROBE FIRST ──
 *   Three candidates were named. /api/v1/customers with a branch id is the
 *   one worth having — one paged call instead of thousands. But the last four
 *   endpoints all needed a different parameter shape than the docs implied,
 *   so this checks before anything is built on top.
 *
 * ── WHAT MATTERS IN THE OUTPUT ──
 *   contactId · name · mobile · gstin · and whether it pages.
 *   contactId is the join key to Sales_Invoices, which is what makes a
 *   customer's own price history reliable rather than name-matched.
 *
 * ── RUN ──
 *   probeCustomerEndpoints()
 **********************************************************************/

const CPB = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',
  GAP: 2500,
};

function cpbProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function cpbTry_(method, path, query, body) {
  let url = cpbProp_(CPB.BASE).replace(/\/+$/, '') + path;
  if (query) {
    const qs = Object.keys(query)
      .filter(function (k) { return query[k] !== '' && query[k] !== undefined; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); })
      .join('&');
    if (qs) url += '?' + qs;
  }
  const opts = { method: method, headers: { 'api-token': cpbProp_(CPB.TOKEN) },
    muteHttpExceptions: true };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch(url, opts);
  return { code: r.getResponseCode(), text: r.getContentText() };
}

function cpbDump_(o, prefix, depth) {
  if (depth > 3) return;
  if (Array.isArray(o)) {
    Logger.log('   ' + prefix + '  [array of ' + o.length + ']');
    if (o.length) cpbDump_(o[0], prefix + '[0].', depth + 1);
    return;
  }
  if (o === null || typeof o !== 'object') {
    Logger.log('   ' + prefix + ' = ' + JSON.stringify(o));
    return;
  }
  Object.keys(o).forEach(function (k) {
    const v = o[k];
    if (v !== null && typeof v === 'object') cpbDump_(v, prefix + k + '.', depth + 1);
    else Logger.log('   ' + prefix + k + ' = ' + JSON.stringify(v));
  });
}

function probeCustomerEndpoints() {
  const b = cpbProp_(CPB.BRANCH);
  Logger.log('════════ CUSTOMER ENDPOINTS ════════');
  Logger.log('Looking for a LIST endpoint — one paged call beats thousands.');
  Logger.log('');

  const attempts = [
    ['GET',  '/api/v1/customers', { branch_id: b, limit: 5, offset: 0 }, null],
    ['GET',  '/api/v1/customers', { branchId: b, limit: 5, offset: 0 }, null],
    ['GET',  '/api/v1/customers', { branch_list: b, limit: 5, offset: 0 }, null],
    ['GET',  '/api/v1/customers', { branch_id: b }, null],
    ['POST', '/api/v1/customers', null, { branch_id: b, limit: 5, offset: 0 }],
    ['POST', '/api/v1/customers', null, { branch_list: b, limit: 5, offset: 0 }],
    ['GET',  '/api/v1/customer/0', { branch_id: b }, null],
    ['GET',  '/api/v1/customer/0', { branch_id: b, mobileNo: '' }, null],
  ];

  const wins = [];
  attempts.forEach(function (a, i) {
    let r;
    try { r = cpbTry_(a[0], a[1], a[2], a[3]); }
    catch (e) { Logger.log('  ERR   ' + a[0] + ' ' + a[1] + ' :: ' + e.message); return; }
    const label = a[0] + ' ' + a[1] +
      (a[2] ? '?' + Object.keys(a[2]).join('&') : '') +
      (a[3] ? '  body:' + Object.keys(a[3]).join(',') : '');
    if (r.code === 200) {
      let j = null, ok = true, note = '';
      try { j = JSON.parse(r.text); if (j.status === false) { ok = false; note = j.message || ''; } }
      catch (e) { ok = false; note = 'non-JSON'; }
      if (ok) { Logger.log('OK     ' + label); wins.push({ label: label, text: r.text }); }
      else Logger.log('  200*  ' + label + '   ' + note);
    } else {
      let hint = '';
      try { const e = JSON.parse(r.text); hint = e.message || e.error || ''; } catch (e) {}
      Logger.log('  ' + r.code + '   ' + label + (hint ? '  :: ' + hint : ''));
    }
    if (i < attempts.length - 1) Utilities.sleep(CPB.GAP);
  });

  Logger.log('');
  if (!wins.length) {
    Logger.log('════════ NONE ANSWERED ════════');
    Logger.log('That is not fatal. The quotation system is built on SALES');
    Logger.log('HISTORY, not on the customer master — every price a customer');
    Logger.log('has actually paid is already in Sales_Items.');
    Logger.log('');
    Logger.log('The customer master would only add phone numbers and a stable');
    Logger.log('contactId. Worth asking Vasy to enable the scope, the same way');
    Logger.log('as the receipt endpoints — a 403 means it exists.');
    try { SpreadsheetApp.getUi().alert('No customer endpoint answered — see the log. ' +
      'The quotation build does not depend on it.'); } catch (e) {}
    return;
  }

  wins.forEach(function (w) {
    Logger.log('════════ ' + w.label + ' ════════');
    try { cpbDump_(JSON.parse(w.text), '', 0); }
    catch (e) { Logger.log(w.text.slice(0, 2000)); }
    Logger.log('');
  });
  Logger.log('>> LOOK FOR: contactId, name, mobileNo, gstIn, and a totalCount');
  Logger.log('   that proves it pages. contactId is the join key to');
  Logger.log('   Sales_Invoices — that is what makes price history reliable.');
  try { SpreadsheetApp.getUi().alert(wins.length + ' endpoint(s) answered — see the log.'); } catch (e) {}
}
