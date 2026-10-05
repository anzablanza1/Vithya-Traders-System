/**
 * VITHYA TRADERS — LIVE PURCHASE REGISTER API
 * ────────────────────────────────────────────
 * VERSION: v3 "Amaravathi" (2026-08) — sinceId incremental pull + ISO date normalisation
 *          (auto-detects whether text dates are DD/MM or MM/DD across the whole column)
 *
 * Adds ONE endpoint (api=register) to the PO Request script project so the
 * Purchase Intelligence dashboard can PULL the live purchase register instead
 * of uploading an Excel file every time.
 *
 * WHY IT LIVES HERE
 *  - The register sheet itself is left completely untouched (read-only access).
 *  - Nothing is copied into the PO Request sheet, so that sheet stays light.
 *  - The dashboard already knows how to parse these exact column names, so the
 *    rows are handed over as-is and the existing parser does the rest.
 *
 * INSTALL
 *  1. Open the SAME Apps Script project as Code.gs / LiveApi.gs (the PO Request sheet).
 *  2. File > New > Script file, name it  RegisterApi  , paste this whole file.
 *  3. Deploy > Manage deployments > (your web app) > Edit > New version > Deploy.
 *  4. In the dashboard: Management mode > Upload screen > "Pull live register".
 *
 * SECURITY
 *  - Uses the same API_TOKEN as LiveApi. Management mode only in the dashboard.
 *  - Read-only: this file never writes to the register.
 */

var REG_SHEET_ID = '1uBS4vD24jihfjrHH2OFoBerRASpytmqjQK-_H-Y0XdU';
var REG_TAB      = 'Purchase_Register';
var REG_PAGE     = 6000;   // rows per request — keeps each call well inside the 6-min limit
var REG_ID_COL   = 'purchaseId';   // used for the incremental (sinceId) pull
var REG_DATE_COL = 'billDate';     // normalised to ISO yyyy-MM-dd before it leaves the server

/**
 * api=register
 *   &meta=1        row count + headers + the highest purchaseId (no data)
 *   &from=0        first data row to return (0-based, excludes the header)
 *   &limit=6000    how many rows
 *   &sinceId=123   ONLY rows with purchaseId > 123  → the fast incremental top-up
 * Returns { ok, total, from, count, done, maxId, headers, rows:[{header:value,...}] }
 */
function apiRegister_(params) {
  params = params || {};
  var ss, sh;
  try {
    ss = SpreadsheetApp.openById(REG_SHEET_ID);
  } catch (e) {
    return { ok: false, error: 'Cannot open the register sheet. Share it with this script\'s account. (' + e.message + ')' };
  }
  sh = ss.getSheetByName(REG_TAB);
  if (!sh) {
    var names = ss.getSheets().map(function (s) { return s.getName(); });
    return { ok: false, error: 'Tab "' + REG_TAB + '" not found. Tabs present: ' + names.join(', ') };
  }

  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return { ok: true, total: 0, from: 0, count: 0, done: true, headers: [], rows: [] };

  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (x) { return String(x).trim(); });
  var total = lastRow - 1;

  var idIx = headers.indexOf(REG_ID_COL);

  if (String(params.meta || '') === '1') {
    var maxId = 0;
    if (idIx >= 0 && total > 0) {
      var ids = sh.getRange(2, idIx + 1, total, 1).getValues();
      for (var m = 0; m < ids.length; m++) { var iv = Number(ids[m][0]) || 0; if (iv > maxId) maxId = iv; }
    }
    return { ok: true, total: total, from: 0, count: 0, done: true, maxId: maxId,
      dateOrder: regDateOrder_(sh, headers), headers: headers, rows: [] };
  }

  // ---- incremental: only rows newer than the id the dashboard already has ----
  var sinceId = Number(params.sinceId) || 0;
  if (sinceId > 0 && idIx >= 0) {
    var allIds = sh.getRange(2, idIx + 1, total, 1).getValues();
    var firstNew = -1;
    for (var s2 = 0; s2 < allIds.length; s2++) { if ((Number(allIds[s2][0]) || 0) > sinceId) { firstNew = s2; break; } }
    if (firstNew < 0) return { ok: true, total: total, from: total, count: 0, done: true, maxId: sinceId, headers: headers, rows: [], upToDate: true };
    // rows are appended in id order, so everything from here on is new
    var startAt = Math.max(firstNew, Number(params.from) || firstNew);
    var take = Math.min(REG_PAGE, total - startAt);
    return regSlice_(sh, headers, total, startAt, take, idIx);
  }

  var from  = Math.max(0, parseInt(params.from, 10) || 0);
  var limit = Math.min(REG_PAGE, Math.max(1, parseInt(params.limit, 10) || REG_PAGE));
  if (from >= total) return { ok: true, total: total, from: from, count: 0, done: true, headers: headers, rows: [] };
  var n = Math.min(limit, total - from);

  return regSlice_(sh, headers, total, from, n, idIx);
}

/**
 * Work out whether TEXT dates in this column are DD/MM or MM/DD.
 * Deterministic: if any row has a first component > 12 it must be DD/MM;
 * if any has a second component > 12 it must be MM/DD. Ties default to DD/MM (Indian).
 * Returns 'dmy' | 'mdy' | 'iso' | 'none'.
 */
function regDateOrder_(sh, headers) {
  var ix = headers.indexOf(REG_DATE_COL);
  if (ix < 0) return 'none';
  var last = sh.getLastRow(); if (last < 2) return 'none';
  var vals = sh.getRange(2, ix + 1, last - 1, 1).getValues();
  var firstBig = 0, secondBig = 0, texts = 0, isos = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i][0];
    if (Object.prototype.toString.call(v) === '[object Date]') continue;
    var s = String(v || '').trim(); if (!s) continue;
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) { isos++; continue; }
    var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (!m) continue;
    texts++;
    if (Number(m[1]) > 12) firstBig++;
    if (Number(m[2]) > 12) secondBig++;
  }
  if (!texts) return isos ? 'iso' : 'none';
  if (firstBig && !secondBig) return 'dmy';
  if (secondBig && !firstBig) return 'mdy';
  return 'dmy';
}
/** Any cell value -> 'yyyy-MM-dd' (or '' if unreadable), using the detected text order. */
function regDate_(v, tz, order) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  }
  var s = String(v).trim(); if (!s) return '';
  var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return iso[1] + '-' + ('0' + iso[2]).slice(-2) + '-' + ('0' + iso[3]).slice(-2);
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    var a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    if (y < 100) y += (y < 70 ? 2000 : 1900);
    var day, mon;
    if (order === 'mdy') { mon = a; day = b; } else { day = a; mon = b; }
    if (mon > 12 && day <= 12) { var t = mon; mon = day; day = t; }   // obvious swap, fix it
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return '';
    return y + '-' + ('0' + mon).slice(-2) + '-' + ('0' + day).slice(-2);
  }
  var d2 = new Date(s);
  if (!isNaN(d2) && /\b(19|20)\d{2}\b/.test(s)) return Utilities.formatDate(d2, tz, 'yyyy-MM-dd');
  return '';
}

/** Read n rows starting at data-row `from` (0-based) and shape them for the dashboard. */
function regSlice_(sh, headers, total, from, n, idIx, order) {
  order = order || regDateOrder_(sh, headers);
  var dIx = headers.indexOf(REG_DATE_COL);
  var vals = sh.getRange(2 + from, 1, n, headers.length).getValues();
  var tz = Session.getScriptTimeZone();
  var rows = [], maxId = 0, badDates = 0, minD = '', maxD = '';
  for (var i = 0; i < vals.length; i++) {
    var o = {}, blank = true;
    for (var c = 0; c < headers.length; c++) {
      var hname = headers[c]; if (!hname) continue;
      var v = vals[i][c];
      if (c === dIx) {
        var iso = regDate_(v, tz, order);
        if (!iso) badDates++;
        v = iso;                                          // ALWAYS ISO — the dashboard never has to guess
      } else if (Object.prototype.toString.call(v) === '[object Date]') {
        v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
      }
      if (v !== '' && v != null) blank = false;
      o[hname] = v;
    }
    if (idIx >= 0) { var iv = Number(vals[i][idIx]) || 0; if (iv > maxId) maxId = iv; }
    if (dIx >= 0 && o[REG_DATE_COL]) { var ds = o[REG_DATE_COL];
      if (!minD || ds < minD) minD = ds; if (!maxD || ds > maxD) maxD = ds; }
    if (!blank) rows.push(o);
  }
  return { ok: true, total: total, from: from, count: rows.length, done: (from + n) >= total, maxId: maxId,
    dateOrder: order, badDates: badDates, minDate: minD, maxDate: maxD, headers: headers, rows: rows };
}

/** Quick check from the editor: confirms access, tab name and row count. */
function testRegisterAccess() {
  var r = apiRegister_({ meta: '1' });
  Logger.log(JSON.stringify(r).slice(0, 900));
  return r;
}