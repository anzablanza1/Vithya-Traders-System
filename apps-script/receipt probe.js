/**********************************************************************
 * VITHYA TRADERS — RECEIPT ENDPOINT PROBE
 *
 * Globals declared here (check before pasting):
 *   RP, findReceiptEndpoint, probeOneReceipt, rpTry_, rpDump_
 *
 * READ ONLY. ~30 quick calls. Writes nothing.
 *
 * ── WHY ──
 *   Getting invoice↔receipt links one sale at a time is 4 calls a minute,
 *   which is 15+ hours. If Vasy exposes a RECEIPT-side endpoint — a receipt
 *   register, or receipt-by-id with its bill allocations — the same data
 *   comes back in a few dozen calls instead of thousands.
 *
 *   One receipt row naturally carries which bills it settled. That is the
 *   right direction to ask the question from.
 *
 * ── WHAT IT TRIES ──
 *   Report-style endpoints first (bulk, paged, most likely to exist),
 *   then list endpoints, then receipt-by-id.
 *
 * ── RUN ──
 *   findReceiptEndpoint()      try them all, report what answers
 *   probeOneReceipt(27961902)  inspect one receipt once a path is known
 **********************************************************************/

const RP = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',
  GAP: 2500,
  FROM: '2025-04-01T00:00:00Z',
  TO: '2030-03-31T23:59:59Z',
};

function rpProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function rpTry_(method, path, query, body) {
  let url = rpProp_(RP.BASE).replace(/\/+$/, '') + path;
  if (query) {
    const qs = Object.keys(query)
      .filter(function (k) { return query[k] !== '' && query[k] !== undefined; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); })
      .join('&');
    if (qs) url += '?' + qs;
  }
  const opts = { method: method, headers: { 'api-token': rpProp_(RP.TOKEN) },
    muteHttpExceptions: true };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const r = UrlFetchApp.fetch(url, opts);
  return { code: r.getResponseCode(), text: r.getContentText() };
}

function findReceiptEndpoint() {
  const b = rpProp_(RP.BRANCH);
  Logger.log('════════ LOOKING FOR A RECEIPT ENDPOINT ════════');
  Logger.log('A bulk receipt source would replace ~7,000 calls with ~30.');
  Logger.log('');

  const rep = { branch_list: b, from_date: RP.FROM, to_date: RP.TO, limit: 5, offset: 0 };
  const rep2 = { branch_id: b, from_date: RP.FROM, to_date: RP.TO, limit: 5, offset: 0 };
  const qry = { branch_id: b, limit: 5, offset: 0 };

  const attempts = [
    /* report style — bulk and paged, the shape we want */
    ['POST', '/api/v1/report/receipt-register', null, rep],
    ['POST', '/api/v1/report/receipt-register/invoice', null, rep],
    ['POST', '/api/v1/report/receipts', null, rep],
    ['POST', '/api/v1/report/receipt', null, rep],
    ['POST', '/api/v1/report/payment-register', null, rep],
    ['POST', '/api/v1/report/customer-outstanding', null, rep],
    ['POST', '/api/v1/report/outstanding', null, rep],
    ['POST', '/api/v1/report/bill-wise-outstanding', null, rep],
    ['POST', '/api/v1/report/ledger', null, rep],
    ['POST', '/api/v1/report/party-ledger', null, rep],
    ['POST', '/api/v1/report/receipt-against-bill', null, rep],
    ['POST', '/api/v1/report/sales-receipt', null, rep],
    /* list style */
    ['POST', '/api/v1/receipt/get-all-receipts', null, rep],
    ['POST', '/api/v1/receipts/get-all-receipts', null, rep],
    ['POST', '/api/v1/sales/get-all-receipts', null, rep],
    ['POST', '/api/v1/receipt/get-all', null, rep],
    ['GET', '/api/v1/receipts', qry, null],
    ['GET', '/api/v1/receipt', qry, null],
    /* the same, with branch_id rather than branch_list */
    ['POST', '/api/v1/report/receipt-register', null, rep2],
    ['POST', '/api/v1/receipt/get-all-receipts', null, rep2],
  ];

  const wins = [];
  attempts.forEach(function (a, i) {
    let r;
    try { r = rpTry_(a[0], a[1], a[2], a[3]); }
    catch (e) { Logger.log('  ERR   ' + a[0] + ' ' + a[1] + ' :: ' + e.message); return; }

    const label = a[0] + ' ' + a[1] +
      (a[3] ? '  [' + Object.keys(a[3])[0] + ']' : '');
    if (r.code === 200) {
      let j = null, ok = true, note = '';
      try { j = JSON.parse(r.text); if (j.status === false) { ok = false; note = j.message || ''; } }
      catch (e) { ok = false; note = 'non-JSON'; }
      if (ok) {
        Logger.log('✅ 200   ' + label);
        wins.push({ label: label, text: r.text, a: a });
      } else {
        Logger.log('   200*  ' + label + '   ' + note);
      }
    } else {
      let hint = '';
      try { const e = JSON.parse(r.text); hint = e.message || e.error || ''; } catch (e) {}
      Logger.log('   ' + r.code + '   ' + label + (hint ? '  :: ' + hint : ''));
    }
    if (i < attempts.length - 1) Utilities.sleep(RP.GAP);
  });

  Logger.log('');
  if (!wins.length) {
    Logger.log('════════ NOTHING ANSWERED ════════');
    Logger.log('No bulk receipt endpoint on the paths tried. The alternatives,');
    Logger.log('cheapest first:');
    Logger.log('');
    Logger.log('  1. A VASY REPORT. Look in the reports list for anything named');
    Logger.log('     "Receipt Against Bill", "Bill-wise Outstanding", "Party');
    Logger.log('     Ledger" or "Bill Adjustment". Any of those carries the');
    Logger.log('     invoice each receipt was applied to. Download it and we');
    Logger.log('     import it — one file, no API at all.');
    Logger.log('');
    Logger.log('  2. PARTY LEDGER export for the ~190 parties that matter.');
    Logger.log('     A ledger lists invoices and receipts in sequence with a');
    Logger.log('     running balance, which is enough to pair them.');
    Logger.log('');
    Logger.log('  3. Ask Vasy support for the receipt endpoint. If the receipt');
    Logger.log('     array exists on a sale, the reverse view almost certainly');
    Logger.log('     exists too — it may just not be documented.');
    Logger.log('');
    Logger.log('  4. Carry on with the per-sale pull, scoped to parties that');
    Logger.log('     need it. Slow, but it works unattended.');
    try { SpreadsheetApp.getUi().alert('No receipt endpoint found — see the log ' +
      'for four alternatives, cheapest first.'); } catch (e) {}
    return;
  }

  Logger.log('════════ FOUND ' + wins.length + ' ════════');
  wins.forEach(function (w) {
    Logger.log('');
    Logger.log('── ' + w.label + ' ──');
    try { rpDump_(JSON.parse(w.text), '', 0); }
    catch (e) { Logger.log(w.text.slice(0, 1500)); }
  });
  Logger.log('');
  Logger.log('>> LOOK FOR: a field naming the invoice or bill a receipt was');
  Logger.log('   applied to — salesId, billNo, invoiceNo, adjustment[] or');
  Logger.log('   billDetails[]. That is the link, in bulk.');
  try { SpreadsheetApp.getUi().alert(wins.length + ' endpoint(s) answered — ' +
    'see the log.'); } catch (e) {}
}

function rpDump_(o, prefix, depth) {
  if (depth > 4) return;
  if (Array.isArray(o)) {
    Logger.log('   ' + prefix + '  [array of ' + o.length + ']');
    if (o.length) rpDump_(o[0], prefix + '[0].', depth + 1);
    return;
  }
  if (o === null || typeof o !== 'object') {
    Logger.log('   ' + prefix + ' = ' + JSON.stringify(o));
    return;
  }
  Object.keys(o).forEach(function (k) {
    const v = o[k];
    if (v !== null && typeof v === 'object') rpDump_(v, prefix + k + '.', depth + 1);
    else Logger.log('   ' + prefix + k + ' = ' + JSON.stringify(v));
  });
}

/** once a receipt id is known, see what a single receipt carries */
function probeOneReceipt(receiptId) {
  const id = receiptId || 27961902;
  const b = rpProp_(RP.BRANCH);
  Logger.log('════════ RECEIPT ' + id + ' ════════');
  const paths = [
    ['GET', '/api/v1/receipt/' + id, { branch_id: b }],
    ['GET', '/api/v1/receipts/' + id, { branch_id: b }],
    ['GET', '/api/v1/sales/receipt/' + id, { branch_id: b }],
  ];
  for (let i = 0; i < paths.length; i++) {
    const r = rpTry_(paths[i][0], paths[i][1], paths[i][2], null);
    if (r.code === 200) {
      let j = null;
      try { j = JSON.parse(r.text); } catch (e) {}
      if (j && j.status !== false) {
        Logger.log('OK via ' + paths[i][1]);
        rpDump_(j.response !== undefined ? j.response : j, '', 0);
        return;
      }
    }
    Logger.log('   ' + r.code + '  ' + paths[i][1]);
    Utilities.sleep(RP.GAP);
  }
  Logger.log('No receipt-by-id path answered.');
}