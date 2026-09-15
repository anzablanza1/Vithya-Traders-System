/**********************************************************************
 * VITHYA TRADERS — LIVE STOCK
 *
 * Globals declared here (check before pasting):
 *   LS, LS_COLS, pullStock, pullStockNow, stockStatus, stockFor, stockMap,
 *   installLiveStockTrigger, removeLiveStockTrigger, setupStockBook,
 *   stockMeta, resetStockCursor, lsStage_, lsStageRead_, lsStageWrite_,
 *   lsNum_, lsCanon_, lsSheet_, lsRead_, lsFetch_, lsProp_,
 *   lsBook_, onOpenStock
 *
 * ── WHY THIS EXISTS SEPARATELY ──
 *   Stock is the only number the counter cannot work without, and it was the
 *   one number that was wrong. Everything else in the system is analytical
 *   and can be a day old; this cannot.
 *
 * ── THE BUG IT REPLACES ──
 *   The nightly snapshot called products-inventory with fromDate, which
 *   filters on the product record's updatedDate — when the product was last
 *   EDITED. A sale changes qty but does not edit the product, so updatedDate
 *   never moves and the pull returned nothing:
 *
 *       21 Aug  0 changed      22 Aug  12 changed
 *       23 Aug  5 changed      24 Aug  0 changed
 *
 *   on roughly 500 sales lines a day. Those 12 and 5 were genuine product
 *   edits. The stock had been stale since the day it was built.
 *
 *   Stock therefore CANNOT be pulled incrementally. It must be pulled whole.
 *
 * ── WHY IT IS FAST ──
 *   Three columns instead of twenty-two. 13,560 products in 14 calls, about
 *   90 seconds. Small enough to run hourly and to refresh on demand from the
 *   counter, which is what "live" actually has to mean.
 *
 * ── W AND WO COMBINED ──
 *   Vasy holds the two lanes as separate SKUs. The counter does not care —
 *   they want to know whether the thing is on the shelf. So this stores the
 *   lanes AND the total, and the floor shows the total.
 *
 * ── RUN ──
 *   probeStock()            READ ONLY — one call, prints the response shape
 *   compareWindows()        READ ONLY — 2 calls, ~1,000 comparisons
 *   testPeriod()            READ ONLY — 3 calls, under a minute
 *   findCodeThisFy()        READ ONLY — chase one code in this FY
 *   diagnoseQty()           READ ONLY — why the numbers disagree
 *   stockReady()            READ ONLY — is the endpoint free right now
 *   probeCodeQuick()        READ ONLY — the fast one, run this
 *   probeCodeNow()          READ ONLY — the full walk, ~3 minutes
 *   probeOneCode('X')       the same, when you can pass an argument
 *   pullStockNow()          full refresh, ~90 seconds
 *   stockStatus()           how fresh it is
 *   installLiveStockTrigger()  hourly
 **********************************************************************/

const LS = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',
  PATH: '/api/v1/product/products-inventory',

  BOOK_PROP: 'VT_STOCK_BOOK_ID',
  SHEET: 'Stock_Live',
  META: 'LS_META',
  CURSOR: 'LS_CURSOR',

  PAGE: 1000,
  /* Measured, not guessed. At 7s the endpoint threw two 429s in a row after
     three pages. VasyApiPull_v3 has used 13s for months without a throttle,
     so the ceiling is about 5 requests a minute. */
  GAP: 13000,
  STAGE: 'Stock_Stage',
  GAP_429: 45000,
  MAX_RUN_MS: 280000,
  MANUAL_RUN_MS: 1500000,
  MANUAL: 'LS_MANUAL',

  /* a full pull that returns far less than last time is not a pull, it is a
     failure that would wipe the shelf figures */
  MIN_FRACTION: 0.8,
};

const LS_COLS = ['item_code', 'product_name', 'qty_w', 'qty_wo', 'qty_total',
  'skus_w', 'skus_wo', 'category', 'brand', 'updated_at'];

function lsNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function lsCanon_(code) { return String(code || '').replace(/\/+\s*$/, '').trim(); }

function lsProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function lsBook_() {
  const id = PropertiesService.getScriptProperties().getProperty(LS.BOOK_PROP);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  /* no separate book configured — keep it beside the other computed tables */
  try { return anaBook_(); } catch (e) { return SpreadsheetApp.getActiveSpreadsheet(); }
}

/**
 * Put stock in its own spreadsheet. Optional, but worth it: this file is
 * rewritten every hour, and a file that is rewritten every hour should not
 * share a version history with tables nobody wants rolled back.
 */
function setupStockBook() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty(LS.BOOK_PROP);
  if (existing) {
    try {
      const ss = SpreadsheetApp.openById(existing);
      try { SpreadsheetApp.getUi().alert('Already linked:\n\n' + ss.getName() +
        '\n' + ss.getUrl()); } catch (e) {}
      return existing;
    } catch (e) { /* stale */ }
  }
  const ss = SpreadsheetApp.create('VT_Stock');
  const f = ss.getSheets()[0];
  f.setName('README');
  f.getRange(1, 1, 7, 1).setValues([
    ['VT_Stock'], [''],
    ['Live stock, pulled whole from Vasy every hour.'],
    ['Three columns per product and nothing else, so it is fast enough to'],
    ['refresh on demand from the counter.'],
    [''],
    ['Rewritten completely on every pull. Nothing here is typed by hand.'],
  ]);
  f.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  props.setProperty(LS.BOOK_PROP, ss.getId());
  try { registerBook('stock', ss.getId()); } catch (e) {}
  const msg = 'Created VT_Stock\n\n' + ss.getUrl() + '\n\nNext: pullStockNow()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return ss.getId();
}

function lsSheet_() {
  const ss = lsBook_();
  let sh = ss.getSheetByName(LS.SHEET);
  if (!sh) sh = ss.insertSheet(LS.SHEET);

  /* Rewrite the header EVERY time, not only on creation.
     Two columns were added to LS_COLS and the existing tab kept its old
     8-column header, so everything after qty_total read one or two places
     out — updated_at came back as 904. A header that only gets written once
     is a header that goes stale the first time the shape changes. */
  if (sh.getMaxColumns() < LS_COLS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), LS_COLS.length - sh.getMaxColumns());
  }
  const cur = sh.getRange(1, 1, 1, LS_COLS.length).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  if (cur.join('|') !== LS_COLS.join('|')) {
    sh.getRange(1, 1, 1, LS_COLS.length).setValues([LS_COLS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, LS_COLS.length).setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
    /* the rows underneath were written to the old shape, so they are junk */
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, sh.getMaxColumns()).clearContent();
    }
  }
  return sh;
}

/**
 * One page, with the waiting built in.
 *
 * Every caller was handling 429 differently and the probes not at all — they
 * reported "not found" when the truth was "we were told to wait". The
 * endpoint allows about 5 requests a minute and asks for 60 seconds after a
 * refusal, so that is what this does.
 */
function lsFetchRetry_(offset, tries, fromDate, toDate) {
  const max = tries || 3;
  for (let i = 0; i < max; i++) {
    const r = lsFetch_(offset, fromDate, toDate);
    if (r.code !== 429) return r;
    if (i === max - 1) return r;
    Utilities.sleep(LS.GAP_429);
  }
  return { code: 429, text: 'rate limited' };
}

/**
 * ISO 8601 UTC — 2026-04-01T00:00:00Z.
 *
 * Plain yyyy-MM-dd returns HTTP 400. VasyApiPull_v3 has a comment on the very
 * line that builds this parameter saying "ISO 8601 UTC", and every working
 * sales call formats it the same way. I wrote the plain form without looking.
 */
function lsIso_(y, m, d, endOfDay) {
  const p = function (n) { return ('0' + n).slice(-2); };
  return y + '-' + p(m) + '-' + p(d) +
    (endOfDay ? 'T23:59:59Z' : 'T00:00:00Z');
}

/** 1 April of whichever financial year the given date falls in */
function lsFyStart_(d) {
  const dt = d || new Date();
  const y = dt.getFullYear(), m = dt.getMonth() + 1;   // 1-12
  return lsIso_(m >= 4 ? y : y - 1, 4, 1, false);
}
function lsToday_() {
  const n = new Date();
  return lsIso_(n.getFullYear(), n.getMonth() + 1, n.getDate(), true);
}
/** the label a human reads, from either form */
function lsDay_(iso) { return String(iso || '').slice(0, 10); }

function lsFetch_(offset, fromDate, toDate) {
  /* NO date window by default, and that is a decision rather than an
     oversight.

     Measured: with no window the endpoint returns 13,656 products; with the
     current financial year it returns 8,646. The 5,010 difference is
     products that have not moved this year — and they are still on the
     shelf. Meanwhile a product present in both windows reports the SAME
     qty either way.

     So the window costs 5,010 products and changes no quantity. It is only
     passed when a caller explicitly asks, which the probes do. */
  let url = lsProp_(LS.BASE).replace(/\/+$/, '') + LS.PATH +
    '?branchId=' + encodeURIComponent(lsProp_(LS.BRANCH)) +
    '&limit=' + LS.PAGE + '&offset=' + offset;
  if (fromDate) url += '&fromDate=' + encodeURIComponent(fromDate);
  if (toDate) url += '&toDate=' + encodeURIComponent(toDate);
  const r = UrlFetchApp.fetch(url, {
    method: 'get', headers: { 'api-token': lsProp_(LS.TOKEN) },
    muteHttpExceptions: true,
  });
  return { code: r.getResponseCode(), text: r.getContentText() };
}

/**
 * READ ONLY. One call, and it prints exactly what came back.
 *
 * The first pull returned nothing and I do not want to guess why a third
 * time. This shows the response keys, the item keys, and the first item — so
 * whatever the field is actually called, we will see it.
 */
function probeStock() {
  const res = lsFetchRetry_(0);
  const L = [];
  L.push('HTTP ' + res.code);
  L.push('');
  if (res.code !== 200) {
    L.push(res.text.slice(0, 800));
    Logger.log(L.join('\n'));
    try { SpreadsheetApp.getUi().alert(L.join('\n').slice(0, 1400)); } catch (e) {}
    return;
  }
  let j;
  try { j = JSON.parse(res.text); }
  catch (e) { Logger.log('non-JSON:\n' + res.text.slice(0, 800)); return; }

  L.push('top level keys : ' + Object.keys(j).join(', '));
  L.push('status         : ' + j.status);
  L.push('message        : ' + j.message);
  const resp = j.response || {};
  L.push('response keys  : ' + Object.keys(resp).join(', '));
  L.push('');

  /* find whichever key holds the array */
  let arrKey = '', arr = null;
  Object.keys(resp).forEach(function (k) {
    if (Array.isArray(resp[k]) && resp[k].length && !arr) { arrKey = k; arr = resp[k]; }
  });
  if (!arr) {
    L.push('NO ARRAY FOUND in response.');
    L.push('raw (first 900 chars):');
    L.push(res.text.slice(0, 900));
  } else {
    L.push('array is response.' + arrKey + '  (' + arr.length + ' items)');
    L.push('');
    L.push('keys on the first item:');
    L.push('   ' + Object.keys(arr[0]).join(', '));
    L.push('');
    L.push('first item:');
    Object.keys(arr[0]).forEach(function (k) {
      L.push('   ' + k + ' = ' + JSON.stringify(arr[0][k]));
    });
  }
  const msg = L.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return msg;
}

/**
 * READ ONLY. Chases one item code through the whole catalogue and prints
 * every raw row the API returns for it.
 *
 * The combined figure disagreed with the Vasy screen — 7,102 against 5,168,
 * and the WO lane missing. Either the endpoint returns more than one row per
 * item code, or the codes are not pairing the way I assumed. This shows which,
 * instead of me guessing a third time.
 *
 *   probeOneCode('STD10120S')
 */
function probeOneCode(code) {
  const want = String(code || '').replace(/\/+\s*$/, '').trim().toUpperCase();
  if (!want) throw new Error("probeOneCode('STD10120S')");
  const L = ['CHASING ' + want, ''];
  let offset = 0, total = 0, hits = 0, scanned = 0;

  while (true) {
    const res = lsFetchRetry_(offset);
    if (res.code === 429) {
      L.push('STILL RATE LIMITED after waiting. Try again in a few minutes.');
      break;
    }
    if (res.code !== 200) { L.push('HTTP ' + res.code + ' at ' + offset); break; }
    const j = JSON.parse(res.text);
    const resp = j.response || {};
    if (!total) total = lsNum_(resp.totalCount);
    const items = resp.items || [];
    if (!items.length) break;

    items.forEach(function (it) {
      scanned++;
      const raw = String(it.itemCode || '').trim();
      if (raw.replace(/\/+\s*$/, '').toUpperCase() !== want) return;
      hits++;
      L.push('  itemCode   ' + JSON.stringify(raw));
      L.push('     name    ' + JSON.stringify(it.productName));
      L.push('     qty     ' + JSON.stringify(it.qty) +
             '     productId ' + it.productId);
      L.push('     active  ' + it.active + '   type ' + it.productType);
      L.push('');
    });

    offset += LS.PAGE;
    if (total && offset >= total) break;
    if (items.length < LS.PAGE) break;
    Utilities.sleep(LS.GAP);
  }

  L.push('scanned ' + scanned.toLocaleString() + ' of ' + total.toLocaleString() +
    ' — ' + hits + ' row(s) matched');
  L.push('');
  L.push('If ONE row shows per code, the pairing is right and the qty is');
  L.push('simply what the API reports. If SEVERAL rows share a code, the API');
  L.push('is returning per-batch rows and summing them is wrong.');
  const msg = L.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return msg;
}

/**
 * Runnable from the dropdown, which only lists functions taking no arguments.
 *
 * Change the code below, or set the Script Property LS_PROBE_CODE and this
 * uses that instead — so you can chase a different product without editing.
 */
function probeCodeNow() {
  const set = PropertiesService.getScriptProperties().getProperty('LS_PROBE_CODE');
  return probeOneCode(set || 'STD10120S');
}

/**
 * Faster version: stops as soon as it has scanned far enough to be sure.
 * The full walk is 14 pages at 13 seconds, about three minutes. This one
 * gives up after the first page that contains a match plus one more, which
 * is enough to tell a single row from several.
 */
function probeCodeQuick() {
  const set = PropertiesService.getScriptProperties().getProperty('LS_PROBE_CODE');
  const want = String(set || 'STD10120S').replace(/\/+\s*$/, '').trim().toUpperCase();
  const L = ['CHASING ' + want + '   (quick — stops once it has seen enough)', ''];
  let offset = 0, total = 0, hits = 0, scanned = 0, sinceHit = 0;

  while (offset < 20000) {
    const res = lsFetchRetry_(offset);
    if (res.code === 429) {
      L.push('STILL RATE LIMITED after waiting.');
      L.push('');
      L.push('The endpoint allows about 5 requests a minute and the earlier');
      L.push('pulls used the allowance up. Leave it two or three minutes and');
      L.push('run this again — nothing is wrong with the code or the token.');
      const m = L.join('\n');
      Logger.log(m);
      try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
      return m;
    }
    if (res.code !== 200) { L.push('HTTP ' + res.code + ' at ' + offset); break; }
    const j = JSON.parse(res.text);
    const resp = j.response || {};
    if (!total) total = lsNum_(resp.totalCount);
    const items = resp.items || [];
    if (!items.length) break;

    let hitThisPage = 0;
    items.forEach(function (it) {
      scanned++;
      const raw = String(it.itemCode || '').trim();
      if (raw.replace(/\/+\s*$/, '').toUpperCase() !== want) return;
      hits++; hitThisPage++;
      L.push('  itemCode  ' + JSON.stringify(raw) +
             '    qty ' + JSON.stringify(it.qty));
      L.push('     ' + JSON.stringify(it.productName));
      L.push('     productId ' + it.productId + '   active ' + it.active +
             '   type ' + it.productType);
      L.push('');
    });

    if (hits) { sinceHit += hitThisPage ? 0 : 1; if (sinceHit >= 1) break; }
    offset += LS.PAGE;
    if (total && offset >= total) break;
    if (items.length < LS.PAGE) break;
    Utilities.sleep(LS.GAP);
  }

  L.push('scanned ' + scanned.toLocaleString() + ' of ' + total.toLocaleString() +
    ' — ' + hits + ' row(s) matched');
  L.push('');
  if (hits === 0 && scanned === 0) {
    L.push('NOTHING WAS SCANNED — no page came back, so this says nothing');
    L.push('about the code. Wait a few minutes and run it again.');
  } else if (hits === 0) {
    L.push('NOT FOUND in the ' + scanned.toLocaleString() + ' scanned. Either the');
    L.push('code is spelled differently, or it sits later in the list — use');
    L.push('probeCodeNow() for the full walk.');
  } else if (hits === 1) {
    L.push('ONE row. The pairing is right, and the qty above is what the API');
    L.push('reports. If that differs from the Vasy screen, the screen and the');
    L.push('API are showing different things — not a bug in the pull.');
  } else {
    L.push(hits + ' ROWS share this code. The endpoint returns a row per');
    L.push('BATCH, so summing them gives a number larger than the stock.');
    L.push('That is the 7,102 against 5,168.');
  }
  const msg = L.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return msg;
}

/**
 * Is the endpoint willing to talk right now?
 *
 * One call, two seconds. Worth running before a five-minute pull, because a
 * pull that starts while throttled wastes the whole window.
 */
function stockReady() {
  const r = lsFetch_(0);
  let msg;
  if (r.code === 429) {
    msg = 'RATE LIMITED right now.\n\n' +
      'The endpoint allows about 5 requests a minute. Wait two or three ' +
      'minutes and check again — a pull started now would stall part way.';
  } else if (r.code !== 200) {
    msg = 'HTTP ' + r.code + '\n\n' + r.text.slice(0, 300);
  } else {
    let n = 0;
    try { n = lsNum_((JSON.parse(r.text).response || {}).totalCount); } catch (e) {}
    msg = 'READY.\n\n' + n.toLocaleString() + ' products reported.\n\n' +
      'A full pull is ' + Math.ceil(n / LS.PAGE) + ' pages at ' +
      (LS.GAP / 1000) + 's apart — about ' +
      Math.ceil(Math.ceil(n / LS.PAGE) * (LS.GAP / 1000 + 8) / 60) + ' minutes.';
  }
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return r.code === 200;
}

/**
 * WHY THE QUANTITY DISAGREES — three tests, one function.
 *
 * The probe settled that there are exactly two rows per product, one per
 * lane, so the pairing is right. The numbers themselves are the problem:
 *
 *     API      STD10120S 4,876    STD10120S/ 5,872
 *     screen   STD10120S 5,168    STD10120S/   181
 *
 * No swap, no ratio, no common offset — so `qty` is not measuring what the
 * Product screen's Qty column measures. This tests the three candidates
 * rather than guessing between them:
 *
 *   1. branch scope   — same call with and without branchId, and with
 *                       branch_id, in case one aggregates every outlet
 *   2. a code filter  — if the endpoint can filter, probes stop walking
 *                       13,000 rows and everything gets faster
 *   3. product detail — /product/details is the endpoint Cost_Current uses;
 *                       if it reports a quantity, does THAT match the screen
 *
 * Takes about a minute. Reads only.
 */
function diagnoseQty() {
  const code = PropertiesService.getScriptProperties()
    .getProperty('LS_PROBE_CODE') || 'STD10120S';
  const base = lsProp_(LS.BASE).replace(/\/+$/, '');
  const token = lsProp_(LS.TOKEN);
  const branch = lsProp_(LS.BRANCH);
  const L = ['WHY THE QUANTITY DISAGREES  —  ' + code, ''];

  const call = function (label, url) {
    const r = UrlFetchApp.fetch(url, {
      method: 'get', headers: { 'api-token': token }, muteHttpExceptions: true,
    });
    if (r.getResponseCode() === 429) { L.push('  ' + label + ': rate limited'); return null; }
    if (r.getResponseCode() !== 200) {
      L.push('  ' + label + ': HTTP ' + r.getResponseCode() + '  ' +
        r.getContentText().slice(0, 120));
      return null;
    }
    let j = null;
    try { j = JSON.parse(r.getContentText()); } catch (e) {
      L.push('  ' + label + ': non-JSON'); return null;
    }
    return j;
  };

  /* ---- 2 first: if a filter works, tests 1 and 3 get much cheaper ---- */
  L.push('── can the endpoint filter by code? ──');
  let filterParam = '';
  const tryParams = ['search', 'itemCode', 'code', 'q', 'keyword', 'productName'];
  for (let i = 0; i < tryParams.length; i++) {
    const p = tryParams[i];
    const j = call(p, base + LS.PATH + '?branchId=' + encodeURIComponent(branch) +
      '&limit=50&offset=0&' + p + '=' + encodeURIComponent(code));
    if (j && j.response) {
      const n = (j.response.items || []).length;
      const tot = j.response.totalCount;
      const narrowed = tot && tot < 500;
      L.push('  ' + p + '= : ' + n + ' item(s), totalCount ' + tot +
        (narrowed ? '   <-- IT FILTERS' : '   (no effect)'));
      if (narrowed && !filterParam) filterParam = p;
    }
    Utilities.sleep(LS.GAP);
  }
  L.push('');

  /* ---- 1: does the branch parameter change the number? ---- */
  L.push('── does the branch scope change qty? ──');
  const variants = [
    ['branchId=' + branch, '?branchId=' + encodeURIComponent(branch)],
    ['branch_id=' + branch, '?branch_id=' + encodeURIComponent(branch)],
    ['no branch at all', '?'],
  ];
  variants.forEach(function (v) {
    let url = base + LS.PATH + v[1] + (v[1] === '?' ? '' : '&') + 'limit=50&offset=0';
    if (filterParam) url += '&' + filterParam + '=' + encodeURIComponent(code);
    const j = call(v[0], url);
    if (!j || !j.response) return;
    const items = j.response.items || [];
    const hits = items.filter(function (it) {
      return String(it.itemCode || '').replace(/\/+\s*$/, '').toUpperCase() ===
        code.replace(/\/+\s*$/, '').toUpperCase();
    });
    if (!hits.length) {
      L.push('  ' + v[0] + ' : total ' + j.response.totalCount +
        ', code not on the first page');
    } else {
      hits.forEach(function (h) {
        L.push('  ' + v[0] + ' : ' + h.itemCode + ' qty ' + h.qty);
      });
    }
    Utilities.sleep(LS.GAP);
  });
  L.push('');

  /* ---- 3: does the detail endpoint agree with the screen? ---- */
  L.push('── what does /product/details say? ──');
  L.push('  (this is the endpoint Cost_Current already uses)');
  const det = call('details', base + '/api/v1/product/details?branchId=' +
    encodeURIComponent(branch) + '&limit=10&offset=0');
  if (det && det.response) {
    const items = det.response.items || det.response.products || [];
    if (items.length) {
      L.push('  keys on a detail row:');
      L.push('     ' + Object.keys(items[0]).join(', '));
      const qtyKeys = Object.keys(items[0]).filter(function (k) {
        return /qty|quantity|stock|closing|balance/i.test(k);
      });
      L.push('  quantity-ish fields: ' + (qtyKeys.join(', ') || 'none'));
    } else {
      L.push('  no items returned');
    }
  }

  L.push('');
  L.push('── how to read this ──');
  L.push('If a branch variant returns 5,168 for STD10120S, the screen is');
  L.push('branch-scoped and we are asking for the wrong scope.');
  L.push('If none do, qty is a different measure — opening stock, or stock');
  L.push('across financial years — and the right source is a different field');
  L.push('or a different endpoint entirely.');

  const msg = L.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return msg;
}

/**
 * Proves the period is what was missing.
 *
 * Calls the same page three ways — no window, this financial year, last
 * financial year — and prints the quantity each returns for one product.
 * Against the screen we already know:
 *
 *     STD10120S    FY2025-26  4,466     FY2026-27  5,168
 *     STD10120S/   FY2025-26  4,889     FY2026-27    181
 *
 * If the FY2026-27 call returns those, the fix is settled.
 *
 * Starts near the end of the list because that is where the earlier probe
 * found the code — three pages instead of fourteen.
 */
/**
 * THREE CALLS. Under a minute.
 *
 * The previous version walked every page of three windows and ran past the
 * six-minute limit, so it logged nothing at all. It only ever needed to ask
 * one question: does a date window change how many products come back?
 *
 *   same 13,656 in every window -> the window only re-scopes the QUANTITY,
 *      so sending the current financial year is the entire fix.
 *   fewer with a window -> the window also filters WHICH products return,
 *      and a product that has not moved would vanish from the shelf.
 *
 * Everything is logged as it happens, so a timeout still leaves evidence.
 */
function testPeriod() {
  const fyY = parseInt(lsDay_(lsFyStart_()), 10);
  const variants = [
    ['no window', '', ''],
    ['this FY ' + lsDay_(lsFyStart_()) + '..' + lsDay_(lsToday_()),
      lsFyStart_(), lsToday_()],
    ['last FY ' + (fyY - 1) + '-04-01..' + fyY + '-03-31',
      lsIso_(fyY - 1, 4, 1, false), lsIso_(fyY, 3, 31, true)],
  ];

  Logger.log('DOES A DATE WINDOW CHANGE THE RESULT SET?');
  Logger.log('');
  const counts = [];

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const res = v[1] ? lsFetchRetry_(0, 2, v[1], v[2]) : lsFetchRetryNoWindow_(0);
    let line;
    if (res.code !== 200) {
      line = '  ' + v[0] + ' : HTTP ' + res.code + '  ' +
        String(res.text || '').slice(0, 120);
      counts.push(null);
    } else {
      let j = null;
      try { j = JSON.parse(res.text); } catch (e) {}
      const resp = (j && j.response) || {};
      const tot = lsNum_(resp.totalCount);
      const first = (resp.items || [])[0] || {};
      counts.push(tot);
      line = '  ' + v[0] + ' : ' + tot.toLocaleString() + ' products' +
        '   first item ' + JSON.stringify(first.itemCode) + ' qty ' + first.qty;
    }
    Logger.log(line);                      // logged NOW, not at the end
    if (i < variants.length - 1) Utilities.sleep(LS.GAP);
  }

  Logger.log('');
  const base = counts[0], fy = counts[1];
  let verdict;
  if (base && fy && Math.abs(base - fy) <= 5) {
    verdict = 'SAME COUNT — the window only re-scopes the quantity.\n' +
      '  Sending the current financial year is the whole fix.\n' +
      '  Next: resetStockCursor() then pullStockNow().';
  } else if (base && fy) {
    verdict = 'DIFFERENT — ' + base.toLocaleString() + ' against ' +
      fy.toLocaleString() + '.\n' +
      '  The window filters WHICH products return, so anything that has not\n' +
      '  moved this year would be missing from the shelf. The pull then needs\n' +
      '  the unwindowed list for the catalogue and the windowed one for the\n' +
      '  quantities. Tell me the two numbers and I will build that.';
  } else {
    verdict = 'One of the calls failed — see the lines above.';
  }
  Logger.log(verdict);
  try { SpreadsheetApp.getUi().alert(verdict); } catch (e) {}
  return counts;
}

/**
 * Find one item code inside a given window. Walks pages, so it is slow —
 * run it only once testPeriod has said which window is the right one.
 * Logs each page as it goes so a timeout still shows how far it got.
 */
function findCodeThisFy() {
  const code = (PropertiesService.getScriptProperties()
    .getProperty('LS_PROBE_CODE') || 'STD10120S')
    .replace(/\/+\s*$/, '').trim().toUpperCase();
  const from = lsFyStart_(), to = lsToday_();
  Logger.log('LOOKING FOR ' + code + '  in ' + lsDay_(from) + '..' + lsDay_(to));
  let found = 0, scanned = 0;
  for (let off = 0; off < 20000; off += LS.PAGE) {
    const res = lsFetchRetry_(off, 2, from, to);
    if (res.code !== 200) { Logger.log('  HTTP ' + res.code + ' at ' + off); break; }
    let j;
    try { j = JSON.parse(res.text); } catch (e) { break; }
    const resp = j.response || {};
    const items = resp.items || [];
    if (!items.length) break;
    items.forEach(function (it) {
      scanned++;
      const raw = String(it.itemCode || '').trim();
      if (raw.replace(/\/+\s*$/, '').toUpperCase() !== code) return;
      found++;
      Logger.log('  FOUND  ' + raw + '   qty ' + it.qty);
    });
    Logger.log('  scanned ' + scanned.toLocaleString() + ' of ' +
      lsNum_(resp.totalCount).toLocaleString());
    if (found >= 2) break;
    if (items.length < LS.PAGE) break;
    Utilities.sleep(LS.GAP);
  }
  const msg = found
    ? found + ' row(s) found. Compare with the screen: STD10120S 5,168 and ' +
      'STD10120S/ 181 for FY2026-27.'
    : 'Not found in ' + scanned.toLocaleString() + ' scanned.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/** the old behaviour, kept only so testPeriod can show the difference */
function lsFetchRetryNoWindow_(offset) {
  const url = lsProp_(LS.BASE).replace(/\/+$/, '') + LS.PATH +
    '?branchId=' + encodeURIComponent(lsProp_(LS.BRANCH)) +
    '&limit=' + LS.PAGE + '&offset=' + offset;
  for (let i = 0; i < 3; i++) {
    const r = UrlFetchApp.fetch(url, {
      method: 'get', headers: { 'api-token': lsProp_(LS.TOKEN) },
      muteHttpExceptions: true,
    });
    if (r.getResponseCode() !== 429) {
      return { code: r.getResponseCode(), text: r.getContentText() };
    }
    if (i < 2) Utilities.sleep(LS.GAP_429);
  }
  return { code: 429, text: 'rate limited' };
}

/**
 * TWO CALLS. Compares every product on the first page across both windows.
 *
 * PUMP01/ came back as -1 with and without a date window, which suggests the
 * window does not touch the quantity — but one product is thin. This checks
 * about a thousand pairs and reports how many differ.
 *
 *   none differ  -> the window is irrelevant to qty; the disagreement with
 *                   the Vasy screen is something else entirely
 *   many differ  -> the window does re-scope qty and I was right the first
 *                   time; the pull needs both calls
 */
function compareWindows() {
  Logger.log('COMPARING ONE PAGE, WITH AND WITHOUT THE WINDOW');
  Logger.log('');

  const a = lsFetchRetryNoWindow_(0);
  if (a.code !== 200) { Logger.log('no-window call: HTTP ' + a.code); return; }
  Logger.log('  no window   : fetched');
  Utilities.sleep(LS.GAP);

  const b = lsFetchRetry_(0, 2, lsFyStart_(), lsToday_());
  if (b.code !== 200) { Logger.log('windowed call: HTTP ' + b.code); return; }
  Logger.log('  this FY     : fetched');
  Logger.log('');

  const grab = function (res) {
    const out = {};
    let j;
    try { j = JSON.parse(res.text); } catch (e) { return out; }
    ((j.response || {}).items || []).forEach(function (it) {
      const c = String(it.itemCode || '').trim();
      if (c) out[c] = lsNum_(it.qty);
    });
    return out;
  };
  const A = grab(a), B = grab(b);

  let both = 0, same = 0, diff = 0;
  const examples = [];
  Object.keys(B).forEach(function (c) {
    if (A[c] === undefined) return;
    both++;
    if (A[c] === B[c]) same++;
    else {
      diff++;
      if (examples.length < 8) {
        examples.push('     ' + c + '   no window ' + A[c] + '   this FY ' + B[c]);
      }
    }
  });

  Logger.log('  products on both pages : ' + both);
  Logger.log('  same qty               : ' + same);
  Logger.log('  different qty          : ' + diff);
  if (examples.length) {
    Logger.log('');
    Logger.log('  examples that differ:');
    examples.forEach(function (x) { Logger.log(x); });
  }
  Logger.log('');

  let verdict;
  if (!both) {
    verdict = 'No overlap between the two pages — the windowed call returns a ' +
      'different slice, so compare by code across more pages.';
  } else if (diff === 0) {
    verdict = 'IDENTICAL on all ' + both + '.\n\n' +
      'The date window does NOT change qty. It only drops products that have ' +
      'not moved, so we should not send it.\n\n' +
      'That means the gap against the Vasy screen is something else. The next ' +
      'thing to settle is whether the API and the screen were even read at the ' +
      'same moment — see the note I will send.';
  } else {
    verdict = diff + ' of ' + both + ' differ.\n\n' +
      'The window DOES re-scope qty. The pull needs both calls: the ' +
      'unwindowed list for the catalogue, the windowed one for quantities.';
  }
  Logger.log(verdict);
  try { SpreadsheetApp.getUi().alert(verdict); } catch (e) {}
}

/* ================= the pull ================= */

function pullStockNow() {
  PropertiesService.getScriptProperties().setProperty(LS.MANUAL, '1');
  try { return pullStock(); }
  finally { PropertiesService.getScriptProperties().deleteProperty(LS.MANUAL); }
}

function pullStock() {
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();
  const manual = props.getProperty(LS.MANUAL) === '1';
  const budget = manual ? LS.MANUAL_RUN_MS : LS.MAX_RUN_MS;

  /* A full pass is ~5 minutes, which fits a manual run but not a triggered
     one. So pages accumulate in a staging tab and the live table is replaced
     only when the whole set has arrived — the counter never sees a half
     refreshed shelf. */
  const stage = lsStage_();
  let offset = parseInt(props.getProperty(LS.CURSOR) || '0', 10);
  const byCanon = offset > 0 ? lsStageRead_(stage) : {};
  let OFFSETS = {};
  try { OFFSETS = scOffsets() || {}; } catch (e) { OFFSETS = {}; }

  /* a cursor left behind by a run that stopped early is worse than no
     cursor — it makes the next run ask past the end and see nothing */
  if (offset > 0) {
    const stageRows = Object.keys(byCanon).length;
    if (!stageRows) {
      Logger.log('cursor at ' + offset + ' but the staging tab is empty — ' +
        'restarting from 0');
      offset = 0;
      props.deleteProperty(LS.CURSOR);
    }
  }
  if (offset === 0) stage.clear();

  let total = 0, seen = 0, pages = 0;
  let paused = false, noCode = 0;
  const staged = Object.keys(byCanon).length;
  Logger.log('pullStock: ' + Object.keys(OFFSETS).length +
    ' calibration offset(s) loaded' +
    (Object.keys(OFFSETS).length ? '' : '  — NOT CALIBRATED, figures will be ' +
      'the sum of every year'));
  Logger.log('pullStock: starting at offset ' + offset +
    (staged ? ', ' + staged + ' products already staged' : '') +
    ', budget ' + Math.round(budget / 1000) + 's');

  while (true) {
    if (Date.now() - t0 > budget - LS.GAP_429) { paused = true; break; }

    const res = lsFetchRetry_(offset);
    if (res.code === 429) { paused = true; break; }
    if (res.code !== 200) {
      throw new Error('HTTP ' + res.code + ' at offset ' + offset + '\n\n' +
        res.text.slice(0, 300));
    }
    let j;
    try { j = JSON.parse(res.text); }
    catch (e) { throw new Error('Non-JSON at offset ' + offset); }
    if (j.status === false) throw new Error(j.message || 'status false');

    const resp = j.response || {};
    if (!total) total = lsNum_(resp.totalCount) || lsNum_(resp.total);

    /* take whichever key holds the array rather than assuming 'items' */
    let items = resp.items || resp.products || resp.productList ||
                resp.data || resp.inventory || null;
    if (!items) {
      Object.keys(resp).forEach(function (k) {
        if (!items && Array.isArray(resp[k])) items = resp[k];
      });
    }
    items = items || [];
    if (!items.length) {
      if (!pages && offset > 0) {
        /* An empty first page with a real totalCount means we asked past the
           end — the cursor is stale from a run that stopped early. Reset and
           start again rather than failing every night with a shape error
           that has nothing to do with the shape. */
        Logger.log('empty page at offset ' + offset + ' of ' + total +
          ' — stale cursor, restarting from 0');
        props.deleteProperty(LS.CURSOR);
        try { lsStage_().clear(); } catch (e) {}
        offset = 0;
        Object.keys(byCanon).forEach(function (k) { delete byCanon[k]; });
        seen = 0;
        Utilities.sleep(LS.GAP);
        continue;
      }
      if (!pages) {
        throw new Error('The first page came back with no items.\n\n' +
          'response keys: ' + Object.keys(resp).join(', ') +
          '\ntotalCount: ' + (resp.totalCount === undefined ? '(absent)' : resp.totalCount) +
          '\n\nRun probeStock() — it prints the real response shape.');
      }
      break;
    }

    items.forEach(function (it) {
      /* the code field has been seen as itemCode; accept the near misses
         rather than silently dropping every row */
      const raw = String(it.itemCode || it.itemcode || it.item_code ||
        it.code || it.skuCode || '').trim();
      if (!raw) { noCode++; return; }
      const canon = lsCanon_(raw);
      const isWo = raw.slice(-1) === '/';
      if (!byCanon[canon]) byCanon[canon] = {
        code: canon, name: String(it.productName || '').replace(/\s*\/$/, ''),
        w: 0, wo: 0, nw: 0, nwo: 0,
        cat: String(it.category || ''), brand: String(it.brand || ''),
      };
      const b = byCanon[canon];
      if (!b.name) b.name = String(it.productName || '');
      /* The year-end rollover was never run, so the API returns the sum of
         every financial year's closing balance. StockCalibrate measured the
         historical part once; subtracting it leaves this year's true stock,
         and the pull stays live. */
      const q = lsNum_(it.qty) - (OFFSETS[raw] || 0);
      /* count how many SKU rows land on each lane — more than one means the
         endpoint is returning per-batch rows and a sum would double count */
      if (isWo) { b.wo += q; b.nwo = (b.nwo || 0) + 1; }
      else { b.w += q; b.nw = (b.nw || 0) + 1; }
    });

    seen += items.length;
    pages++;
    Logger.log('  page ' + pages + ': offset ' + offset + ', ' + items.length +
      ' items, ' + Object.keys(byCanon).length + ' products so far' +
      (total ? ' (of ' + total + ' SKUs)' : ''));
    offset += LS.PAGE;
    props.setProperty(LS.CURSOR, String(offset));
    if (total && offset >= total) break;
    if (items.length < LS.PAGE) break;
    Utilities.sleep(LS.GAP);
  }

  /* Completeness is about how many products are IN HAND, not where the
     cursor got to. A stale cursor once let a single 645-item page pass as a
     finished 13,655-product pull, and 419 rows overwrote the live table. */
  const held = Object.keys(byCanon).length;
  const reachedEnd = total > 0 && offset >= total;
  const enough = total > 0 && (seen + staged * 2) >= total * LS.MIN_FRACTION;
  const done = reachedEnd && enough && !paused;
  Logger.log('pullStock: ' + seen + ' SKUs this run, ' + staged + ' staged, ' +
    held + ' products held; reachedEnd=' + reachedEnd + ' enough=' + enough +
    ' paused=' + paused);

  if (reachedEnd && !enough) {
    /* the cursor says finished but the data says otherwise — start again */
    props.deleteProperty(LS.CURSOR);
    try { lsStage_().clear(); } catch (e) {}
    throw new Error('The cursor was ahead of the data.\n\nOnly ' +
      seen.toLocaleString() + ' of ' + total.toLocaleString() +
      ' products were read, but the cursor had already reached the end — so a ' +
      'part of the catalogue was skipped.\n\nNothing was written and the ' +
      'cursor has been reset. Run pullStockNow() again for a clean pass.');
  }
  if (!done) {
    /* keep what we have and carry on next time rather than throwing it away */
    lsStageWrite_(stage, byCanon);
    const got = Object.keys(byCanon).length;
    const msg = 'STOCK — PART WAY THROUGH\n\n' +
      got.toLocaleString() + ' products held so far, at offset ' +
      offset.toLocaleString() + ' of ' + total.toLocaleString() + '.\n\n' +
      'The live table is untouched and still shows the last complete pull.\n' +
      'Run pullStockNow() again to finish — it carries on from here.';
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
    return got;
  }

  const codes = Object.keys(byCanon);
  if (!codes.length) {
    throw new Error('Read ' + seen + ' item(s) across ' + pages +
      ' page(s) but none had a usable item code' +
      (noCode ? ' (' + noCode + ' had no code field)' : '') +
      '.\n\nNothing was written. Run probeStock() — it prints the field names ' +
      'the API is really using.');
  }

  /* a short pull must never overwrite a good one */
  const sh = lsSheet_();
  const had = Math.max(0, sh.getLastRow() - 1);
  if (had > 500 && codes.length < had * LS.MIN_FRACTION) {
    throw new Error('REFUSING TO WRITE.\n\nThe pull produced ' +
      codes.length.toLocaleString() + ' products against ' + had.toLocaleString() +
      ' already stored. That is too large a drop to be real. Nothing changed.');
  }

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm');
  const rows = codes.map(function (k) {
    const b = byCanon[k];
    return [b.code, b.name, b.w, b.wo, b.w + b.wo,
      b.nw || 0, b.nwo || 0, b.cat, b.brand, stamp];
  }).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });

  if (sh.getMaxRows() < rows.length + 10) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length + 10 - sh.getMaxRows());
  }
  if (had) sh.getRange(2, 1, had, LS_COLS.length).clearContent();
  const B = 5000;
  for (let i = 0; i < rows.length; i += B) {
    const blk = rows.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, LS_COLS.length).setValues(blk);
  }

  let neg = 0, zero = 0, pos = 0, multi = 0;
  rows.forEach(function (r) {
    if (r[4] < 0) neg++; else if (r[4] === 0) zero++; else pos++;
    if (r[5] > 1 || r[6] > 1) multi++;
  });
  props.deleteProperty(LS.CURSOR);
  try { lsStage_().clear(); } catch (e) {}
  props.setProperty(LS.META, JSON.stringify({
    at: stamp, products: rows.length, seen: seen, total: total,
    positive: pos, zero: zero, negative: neg,
    seconds: Math.round((Date.now() - t0) / 1000),
  }));

  try { vtInvalidate(); } catch (e) {}

  const msg = 'STOCK REFRESHED  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'SKUs read      : ' + seen.toLocaleString() +
      (total ? ' of ' + total.toLocaleString() : '') + '\n' +
    'products (W+WO): ' + rows.length.toLocaleString() + '\n' +
    'pages          : ' + pages + '\n\n' +
    '   on the shelf : ' + pos.toLocaleString() + '\n' +
    '   at zero      : ' + zero.toLocaleString() + '\n' +
    '   negative     : ' + neg.toLocaleString() + '\n' +
    (multi ? '\n\u26a0 ' + multi.toLocaleString() + ' product(s) had MORE THAN ONE ' +
      'SKU row on a lane.\n   The endpoint is returning per-batch rows and the ' +
      'totals for those\n   products are sums, not stock levels. ' +
      'Run probeOneCode() on one.\n' : '') +
    '\nas at ' + stamp +
    (Object.keys(OFFSETS).length
      ? '\ncalibrated against the Stock Register'
      : '\n\n\u26a0 NOT CALIBRATED — these are the sum of every financial ' +
        'year.\n   Run calibrateStock() or the counter will see roughly double.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return rows.length;
}

/* ---------- staging, so a long pull can finish across two runs ---------- */

function lsStage_() {
  const ss = lsBook_();
  let sh = ss.getSheetByName(LS.STAGE);
  if (!sh) {
    sh = ss.insertSheet(LS.STAGE);
    sh.getRange(1, 1, 1, 7).setValues([['code', 'name', 'w', 'wo', 'cat', 'brand', 'x']]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function lsStageRead_(sh) {
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().forEach(function (r) {
    const c = String(r[0] || '').trim();
    if (!c) return;
    out[c] = { code: c, name: String(r[1] || ''), w: lsNum_(r[2]), wo: lsNum_(r[3]),
      cat: String(r[4] || ''), brand: String(r[5] || '') };
  });
  return out;
}

function lsStageWrite_(sh, byCanon) {
  const rows = Object.keys(byCanon).map(function (k) {
    const b = byCanon[k];
    return [b.code, b.name, b.w, b.wo, b.cat, b.brand, ''];
  });
  sh.clear();
  sh.getRange(1, 1, 1, 7).setValues([['code', 'name', 'w', 'wo', 'cat', 'brand', 'x']]);
  if (!rows.length) return;
  if (sh.getMaxRows() < rows.length + 5) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length + 5 - sh.getMaxRows());
  }
  const B = 5000;
  for (let i = 0; i < rows.length; i += B) {
    const blk = rows.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, 7).setValues(blk);
  }
}

/* ================= read ================= */

function lsRead_() {
  let sh = null;
  try { sh = vtSheet(LS.SHEET); } catch (e) {}
  if (!sh) { try { sh = lsBook_().getSheetByName(LS.SHEET); } catch (e) {} }
  if (!sh || sh.getLastRow() < 2) return null;
  return sh.getRange(2, 1, sh.getLastRow() - 1, LS_COLS.length).getValues();
}

/** { canonical_code: {w, wo, total} } — what the floor overlays onto its list */
function stockMap() {
  const v = lsRead_();
  if (!v) return {};
  const out = {};
  v.forEach(function (r) {
    const c = String(r[0] || '').trim();
    if (!c) return;
    out[c] = { w: lsNum_(r[2]), wo: lsNum_(r[3]), total: lsNum_(r[4]) };
  });
  return out;
}

function stockFor(code) {
  const m = stockMap();
  return m[lsCanon_(code)] || null;
}

/** freshness, for the counter to see and for the refresh button to report */
function stockMeta() {
  const raw = PropertiesService.getScriptProperties().getProperty(LS.META);
  if (!raw) return { at: '', products: 0, age_min: null };
  let m;
  try { m = JSON.parse(raw); } catch (e) { return { at: '', products: 0 }; }
  if (m.at) {
    const d = new Date(m.at.replace(' ', 'T') + ':00');
    if (!isNaN(d.getTime())) m.age_min = Math.round((Date.now() - d.getTime()) / 60000);
  }
  return m;
}

/** forget where the last pull got to and start the next one from the top */
function resetStockCursor() {
  PropertiesService.getScriptProperties().deleteProperty(LS.CURSOR);
  try { lsStage_().clear(); } catch (e) {}
  try { SpreadsheetApp.getUi().alert('Next pull starts from the beginning.'); } catch (e) {}
}

function stockStatus() {
  const m = stockMeta();
  const msg = 'LIVE STOCK\n\n' +
    (m.products ? 'products: ' + m.products.toLocaleString() + '\n' +
      'as at   : ' + m.at + (m.age_min !== null ? '   (' + m.age_min + ' min ago)' : '') + '\n' +
      'took    : ' + (m.seconds || '?') + 's\n\n' +
      '   on the shelf : ' + (m.positive || 0).toLocaleString() + '\n' +
      '   at zero      : ' + (m.zero || 0).toLocaleString() + '\n' +
      '   negative     : ' + (m.negative || 0).toLocaleString()
      : 'Never pulled. Run pullStockNow().');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= schedule ================= */

/**
 * Every 30 minutes.
 *
 * A full pass is 14 pages at the 13-second pace the endpoint tolerates, which
 * is about 280 seconds — just over what a triggered run gets. So one run
 * stages 12 pages and the next finishes the remaining 2 and swaps. At half
 * hourly that lands a COMPLETE refresh roughly every hour, and the live table
 * is only ever replaced by a whole set.
 */
function installLiveStockTrigger() {
  removeLiveStockTrigger();
  ScriptApp.newTrigger('pullStock').timeBased().everyMinutes(30).create();
  const msg = 'Stock refreshes every 30 minutes.\n\n' +
    'A full pass takes two runs, so a complete refresh lands about hourly — ' +
    'and the counter can force one in five minutes with the button.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function removeLiveStockTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pullStock') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

function onOpenStock() {
  SpreadsheetApp.getUi()
    .createMenu('📦 Live Stock')
    .addItem('Is the endpoint free?', 'stockReady')
    .addItem('Why does qty disagree?', 'diagnoseQty')
    .addItem('Does the period fix it?', 'testPeriod')
    .addItem('Compare with and without window', 'compareWindows')
    .addItem('Find one code in this FY', 'findCodeThisFy')
    .addItem('Probe the endpoint', 'probeStock')
    .addItem('Chase one item code', 'probeCodeQuick')
    .addItem('Refresh now', 'pullStockNow')
    .addItem('Status', 'stockStatus')
    .addItem('Start the next pull from scratch', 'resetStockCursor')
    .addSeparator()
    .addItem('Put stock in its own file', 'setupStockBook')
    .addItem('Refresh every hour', 'installLiveStockTrigger')
    .addItem('Stop hourly refresh', 'removeLiveStockTrigger')
    .addToUi();
}