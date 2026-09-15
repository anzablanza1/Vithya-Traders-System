/**********************************************************************
 * VITHYA TRADERS — STOCK COUNT
 *
 * Globals declared here (check before pasting):
 *   SVER, SVER_COLS, SVER_LOG_COLS, buildCountBatch, deferCountTask,
 *   blockCountTask, detectCounts, recordManualCount, countProgress,
 *   countAccuracy, openCountTasks, countBatchStatus, onOpenStockCount,
 *   sverNum_, sverNow_, sverToday_, sverDate_, sverDaysSince_, sverRead_,
 *   sverSheet_, sverLogSheet_, sverSoldSince_
 *
 * ── HOW THIS WORKS ──
 *   Counts are entered in VASY, not here. Stock moves all day, so a figure
 *   sitting in a sheet overnight is already wrong by morning.
 *
 *   This system therefore ASSIGNS counts and DETECTS completion:
 *
 *     1. buildCountBatch()  hands out the next 50, skipping anything already
 *                           open or deferred
 *     2. the team counts and corrects the quantity in Vasy
 *     3. the nightly ERP pull brings the new quantity back
 *     4. detectCounts()     works out whether a correction happened
 *
 *   Detection is exact, because sales in the window are known:
 *
 *        expected  = qty_at_assignment - units_sold_since
 *        actual    = what Vasy shows now
 *        adjustment = actual - expected
 *
 *   A non-zero adjustment means someone changed the stock. Where a purchase
 *   also landed in the window, the row is marked UNCLEAR rather than counted —
 *   a purchase raises stock too, and claiming otherwise would be a guess.
 *
 * ── DEFERRAL ──
 *   deferCountTask(code, reason, untilDate) parks an item without losing it.
 *   The next batch skips deferred rows until their date, so 20 items waiting
 *   on a rack rearrangement do not block the other 30.
 *
 * ── RUN ──
 *   buildCountBatch(50)                    hand out the next batch
 *   deferCountTask(code, why, 'yyyy-MM-dd')
 *   blockCountTask(code, why)              cannot be counted at all
 *   detectCounts()                         after the nightly pull
 *   recordManualCount(code, qty, by)       fallback when Vasy is not updated
 *   countBatchStatus() / countProgress() / countAccuracy()
 **********************************************************************/

const SVER = {
  TASKS: 'Count_Tasks',
  LOG: 'Count_Log',
  ANALYTICS: 'Product_Analytics',
  ITEMS: 'Sales_Items',
  LATEST: 'Stock_Latest',
  BATCH_SIZE: 50,
  MIN_VALUE: 2000,        // B-class below this is not worth a trip to the rack
  HIGH_VALUE: 10000,      // any product holding this much gets counted
  CYCLE_A: 30,
  CYCLE_B: 90,
  CYCLE_C: 365,
};

const SVER_COLS = ['batch_id', 'assigned_at', 'priority', 'reason',
  'item_code', 'product_name', 'category', 'brand', 'abc',
  'qty_at_assign', 'stock_value', 'units_365d',
  'status', 'status_note', 'defer_until', 'updated_at',
  'qty_now', 'sold_since', 'expected_qty', 'adjustment', 'value_impact'];

const SVER_LOG_COLS = ['detected_at', 'batch_id', 'item_code', 'product_name',
  'source', 'qty_at_assign', 'sold_since', 'expected_qty', 'qty_now',
  'adjustment', 'value_impact', 'note'];

/* status values */
const SVER_OPEN = 'pending';

function sverNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function sverNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}
function sverToday_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
function sverDate_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : String(v).slice(0, 10);
}
function sverDaysSince_(d) {
  const s = sverDate_(d);
  if (!s) return null;
  const dt = new Date(s + 'T00:00:00');
  if (isNaN(dt.getTime())) return null;
  return Math.floor((new Date() - dt) / 86400000);
}

function sverRead_(ss, name, key) {
  const sh = vtSheet(name) || ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return null;
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k) H[k] = i; });
  if (key && H[key] === undefined) return null;
  return { sh: sh, H: H,
    rows: sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues() };
}

/* Creates the sheet, or adopts an existing one.
   An earlier version of this script used a DIFFERENT column set for both
   tabs (16 and 10 columns; now 21 and 12). Writing wide rows into a narrow
   sheet would misalign every value, so a schema mismatch archives the old
   tab under a dated name rather than trying to merge it. */
function sverEnsure_(ss, name, cols, headBg) {
  let sh = ss.getSheetByName(name);

  if (sh) {
    const width = sh.getLastColumn();
    const hdr = width ? sh.getRange(1, 1, 1, width).getValues()[0]
      .map(function (x) { return String(x).trim(); }) : [];
    const same = hdr.length === cols.length &&
      cols.every(function (c, i) { return hdr[i] === c; });
    if (same) return sh;
    if (sh.getLastRow() <= 1) {
      sh.clear();
    } else {
      const archive = name + '_old_' +
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
      sh.setName(archive);
      Logger.log('Archived the old ' + name + ' (different columns) as ' + archive);
      sh = null;
    }
  }

  if (!sh) {
    try {
      sh = ss.insertSheet(name);
    } catch (e) {
      sh = ss.getSheetByName(name);
      if (!sh) throw e;
      sh.clear();
    }
  }

  sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold')
    .setBackground(headBg).setFontColor('#FFFFFF').setWrap(true);
  return sh;
}

function sverSheet_() {
  const sh = sverEnsure_(txnBook_(), SVER.TASKS, SVER_COLS, '#CC3018');
  sh.setColumnWidth(4, 220);
  sh.setColumnWidth(6, 280);
  [2, 15, 16].forEach(function (c) {
    sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  return sh;
}

function sverLogSheet_() {
  const sh = sverEnsure_(txnBook_(), SVER.LOG, SVER_LOG_COLS, '#6C6C60');
  sh.setColumnWidth(4, 280);
  return sh;
}

/* units sold for a code (both lanes) since a date */
function sverSoldSince_(sinceDate) {
  const out = {};
  /* sales lines may be split across per-year workbooks — read them all, so
     a count assigned in March is still matched against April's sales */
  let si = null;
  try { si = readSalesAcrossYears(SVER.ITEMS, sinceDate); } catch (e) { si = null; }
  if (!si || !si.rows || !si.rows.length) {
    si = sverRead_(txnBook_(), SVER.ITEMS, 'itemCode');
  }
  if (!si) return out;
  const H = si.H;
  si.rows.forEach(r => {
    const d = sverDate_(r[H.salesDate]);
    if (!d || d < sinceDate) return;
    const code = String(r[H.itemCode] || '').trim();
    if (!code) return;
    const canon = code.replace(/\/+$/, '');
    out[canon] = (out[canon] || 0) + sverNum_(r[H.qty]);
  });
  return out;
}

/* ================= 1. hand out a batch ================= */

function buildCountBatch(size) {
  const n = size || SVER.BATCH_SIZE;
  const txn = txnBook_();
  const pa = sverRead_(txn, SVER.ANALYTICS, 'item_code');
  if (!pa) throw new Error('Product_Analytics is empty — build it first.');
  const H = pa.H;
  const today = sverToday_();

  /* ensure the tab exists with the CURRENT columns before reading it —
     an older schema is archived here rather than half-read */
  sverSheet_();

  /* what is already open, deferred or done */
  const state = {};
  const t = sverRead_(txn, SVER.TASKS, 'item_code');
  if (t) {
    t.rows.forEach(r => {
      const c = String(r[t.H.item_code] || '').trim();
      if (!c) return;
      const st = String(r[t.H.status] || '').trim();
      const until = sverDate_(r[t.H.defer_until]);
      const prev = state[c];
      const at = sverDate_(r[t.H.assigned_at]);
      if (!prev || at >= prev.at) state[c] = { status: st, until: until, at: at };
    });
  }

  const cand = [];
  pa.rows.forEach(r => {
    const code = String(r[H.item_code] || '').trim();
    if (!code) return;
    const s = state[code];
    if (s) {
      if (s.status === SVER_OPEN) return;                       // already out
      if (s.status === 'blocked') return;                       // cannot count
      if (s.status === 'deferred' && (!s.until || s.until > today)) return;
      if (s.status === 'counted') {
        const since = sverDaysSince_(s.at);
        const abcC = String(r[H.abc_revenue] || 'C');
        const cyc = abcC === 'A' ? SVER.CYCLE_A : (abcC === 'B' ? SVER.CYCLE_B : SVER.CYCLE_C);
        if (since !== null && since < cyc) return;              // counted recently
      }
    }

    const qty = sverNum_(r[H.qty_total]);
    const val = sverNum_(r[H.stock_value]);
    const abc = String(r[H.abc_revenue] || 'C');
    const u365 = sverNum_(r[H.units_365d]);

    /* Only queue a count if the answer could change a decision.
       Counting a C-class item that shows zero stock and has not sold in a
       year confirms zero and teaches nothing — and queuing the whole
       catalogue (6,923 items at 50/day = 138 working days) produces a list
       nobody works through. */
    let pri = 0, why = '';
    if (qty < 0 && u365 > 0) { pri = 1; why = 'negative stock, still selling'; }
    else if (qty < 0) { pri = 2; why = 'negative stock'; }
    else if (qty === 0 && u365 > 0) { pri = 3; why = 'shows zero but still selling'; }
    else if (abc === 'A') { pri = 4; why = s ? 'A-class, cycle due' : 'A-class, never counted'; }
    else if (abc === 'B' && Math.abs(val) >= SVER.MIN_VALUE) {
      pri = 5; why = 'B-class, value at risk';
    }
    else if (Math.abs(val) >= SVER.HIGH_VALUE) { pri = 6; why = 'high stock value'; }
    else if (qty > 0 && u365 > 0) { pri = 7; why = 'active stock, cycle due'; }
    else return;                 /* zero stock, no demand — nothing to learn */

    cand.push({ pri: pri, val: Math.abs(val),
      row: ['', '', pri, why, code, String(r[H.product_name] || ''),
        r[H.category] || '', r[H.brand] || '', abc,
        qty, val, u365, SVER_OPEN, '', '', sverNow_(),
        '', '', '', '', ''] });
  });

  cand.sort((a, b) => (a.pri - b.pri) || (b.val - a.val));
  const take = cand.slice(0, n);
  if (!take.length) {
    try { SpreadsheetApp.getUi().alert('Nothing due for counting.'); } catch (e) {}
    return 0;
  }

  const batchId = 'CNT-' + Utilities.formatDate(new Date(),
    Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
  take.forEach(x => { x.row[0] = batchId; x.row[1] = sverToday_(); });

  const sh = sverSheet_();
  sh.getRange(sh.getLastRow() + 1, 1, take.length, SVER_COLS.length)
    .setValues(take.map(x => x.row));

  const byPri = {};
  take.forEach(x => byPri[x.pri] = (byPri[x.pri] || 0) + 1);
  const names = { 1: 'negative + selling', 2: 'negative', 3: 'zero but selling',
    4: 'A-class', 5: 'B-class, value at risk', 6: 'high stock value',
    7: 'active stock, cycle due' };

  const msg = 'COUNT BATCH ' + batchId + '\n\n' +
    take.length + ' item(s) assigned\n' +
    'still waiting overall: ' + (cand.length - take.length) + '\n\n' +
    Object.keys(byPri).sort().map(k =>
      '   ' + names[k] + ': ' + byPri[k]).join('\n') +
    '\n\nvalue in this batch: Rs ' +
    Math.round(take.reduce(function (a, x) { return a + x.val; }, 0)).toLocaleString('en-IN') +
    '\n\nCount these and correct the quantity IN VASY.\n' +
    'The nightly pull brings it back; detectCounts() then confirms them.\n\n' +
    'If something cannot be counted now:\n' +
    "   deferCountTask('CODE', 'why', '2026-08-20')\n" +
    "   blockCountTask('CODE', 'why')\n" +
    'then run buildCountBatch() again for replacements.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return take.length;
}

/* ================= 2. status changes ================= */

function sverSetStatus_(code, status, note, until) {
  const txn = txnBook_();
  const t = sverRead_(txn, SVER.TASKS, 'item_code');
  if (!t) throw new Error('No count tasks yet.');
  const c = String(code || '').trim();
  let found = -1;
  for (let i = t.rows.length - 1; i >= 0; i--) {
    if (String(t.rows[i][t.H.item_code]).trim() === c &&
        String(t.rows[i][t.H.status]).trim() === SVER_OPEN) { found = i; break; }
  }
  if (found < 0) throw new Error('No open count task for ' + c);
  const row = found + 2;
  t.sh.getRange(row, t.H.status + 1).setValue(status);
  t.sh.getRange(row, t.H.status_note + 1).setValue(note || '');
  t.sh.getRange(row, t.H.defer_until + 1).setValue(until || '');
  t.sh.getRange(row, t.H.updated_at + 1).setValue(sverNow_());
  return String(t.rows[found][t.H.product_name] || '');
}

function deferCountTask(itemCode, reason, untilDate) {
  if (!itemCode || !reason) {
    throw new Error("deferCountTask('CODE', 'why it cannot be counted now', '2026-08-20')");
  }
  const name = sverSetStatus_(itemCode, 'deferred', reason, untilDate || '');
  const msg = itemCode + '  ' + name + '\ndeferred' +
    (untilDate ? ' until ' + untilDate : '') + '\nreason: ' + reason +
    '\n\nRun buildCountBatch() to pull a replacement into the batch.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function blockCountTask(itemCode, reason) {
  if (!itemCode || !reason) throw new Error("blockCountTask('CODE', 'why')");
  const name = sverSetStatus_(itemCode, 'blocked', reason, '');
  const msg = itemCode + '  ' + name + '\nblocked — will not be reassigned\nreason: ' + reason;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= 3. detect counts from the nightly pull ================= */

function detectCounts() {
  const txn = txnBook_();
  const t = sverRead_(txn, SVER.TASKS, 'item_code');
  if (!t) throw new Error('No count tasks yet.');
  const pa = sverRead_(txn, SVER.ANALYTICS, 'item_code');
  if (!pa) throw new Error('Product_Analytics is empty — rebuild it after the pull.');

  const now = {}, cost = {}, lastBuy = {};
  pa.rows.forEach(r => {
    const c = String(r[pa.H.item_code] || '').trim();
    if (!c) return;
    now[c] = sverNum_(r[pa.H.qty_total]);
    cost[c] = sverNum_(r[pa.H.unit_cost]);
    lastBuy[c] = sverDate_(r[pa.H.last_purchase]);
  });

  /* the oldest open assignment sets how far back we need sales */
  let earliest = sverToday_();
  t.rows.forEach(r => {
    if (String(r[t.H.status]).trim() !== SVER_OPEN) return;
    const d = sverDate_(r[t.H.assigned_at]);
    if (d && d < earliest) earliest = d;
  });
  const sold = sverSoldSince_(earliest);

  const log = [];
  let counted = 0, unclear = 0, unchanged = 0;
  const updates = [];

  t.rows.forEach((r, i) => {
    if (String(r[t.H.status]).trim() !== SVER_OPEN) return;
    const code = String(r[t.H.item_code] || '').trim();
    if (!code || now[code] === undefined) return;

    const at = sverDate_(r[t.H.assigned_at]);
    const was = sverNum_(r[t.H.qty_at_assign]);
    const soldSince = sverNum_(sold[code]);
    const expected = was - soldSince;
    const actual = now[code];
    const adj = Math.round((actual - expected) * 1000) / 1000;

    /* a purchase in the window also raises stock — do not call that a count */
    const boughtSince = lastBuy[code] && at && lastBuy[code] >= at;

    if (Math.abs(adj) < 0.001) { unchanged++; return; }

    const status = boughtSince ? 'unclear' : 'counted';
    if (boughtSince) unclear++; else counted++;

    const impact = Math.round(adj * sverNum_(cost[code]) * 100) / 100;
    updates.push({ row: i + 2, status: status, actual: actual,
      sold: soldSince, expected: expected, adj: adj, impact: impact,
      note: boughtSince ? 'a purchase landed after assignment — change is not proof of a count' : '' });

    log.push([sverNow_(), String(r[t.H.batch_id] || ''), code,
      String(r[t.H.product_name] || ''),
      boughtSince ? 'vasy (unclear)' : 'vasy', was, soldSince, expected, actual,
      adj, impact, boughtSince ? 'purchase in window' : '']);
  });

  updates.forEach(u => {
    t.sh.getRange(u.row, t.H.status + 1).setValue(u.status);
    t.sh.getRange(u.row, t.H.updated_at + 1).setValue(sverNow_());
    t.sh.getRange(u.row, t.H.qty_now + 1, 1, 4)
      .setValues([[u.actual, u.sold, u.expected, u.adj]]);
    t.sh.getRange(u.row, t.H.value_impact + 1).setValue(u.impact);
    if (u.note) t.sh.getRange(u.row, t.H.status_note + 1).setValue(u.note);
  });
  if (log.length) {
    sverLogSheet_().getRange(sverLogSheet_().getLastRow() + 1, 1,
      log.length, SVER_LOG_COLS.length).setValues(log);
  }

  const impact = log.reduce((s, r) => s + Math.abs(sverNum_(r[10])), 0);
  const msg = 'COUNT DETECTION\n\n' +
    'confirmed counted : ' + counted + '\n' +
    'unclear           : ' + unclear + '   (a purchase also landed in the window)\n' +
    'no change yet     : ' + unchanged + '\n\n' +
    'stock value corrected: Rs ' + Math.round(impact).toLocaleString('en-IN') + '\n\n' +
    'Detection compares what Vasy shows now against\n' +
    '   qty at assignment minus units sold since.\n' +
    'A difference means someone adjusted the stock.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return counted;
}

/* ================= 4. manual fallback ================= */

function recordManualCount(itemCode, countedQty, countedBy, note) {
  const code = String(itemCode || '').trim();
  const qty = Number(countedQty);
  if (!code || !isFinite(qty)) {
    throw new Error("recordManualCount('CODE', 42, 'name')");
  }
  const txn = txnBook_();
  const pa = sverRead_(txn, SVER.ANALYTICS, 'item_code');
  let sysQty = null, name = '', unitCost = 0;
  for (let i = 0; pa && i < pa.rows.length; i++) {
    if (String(pa.rows[i][pa.H.item_code]).trim() === code) {
      sysQty = sverNum_(pa.rows[i][pa.H.qty_total]);
      name = String(pa.rows[i][pa.H.product_name] || '');
      unitCost = sverNum_(pa.rows[i][pa.H.unit_cost]);
      break;
    }
  }
  if (sysQty === null) throw new Error('Not found: ' + code);

  const adj = Math.round((qty - sysQty) * 1000) / 1000;
  const impact = Math.round(adj * unitCost * 100) / 100;
  let batch = '';
  try { batch = sverSetStatus_(code, 'counted', 'manual: ' + (note || ''), '') ? '' : ''; }
  catch (e) { /* no open task is fine — a manual count can be ad hoc */ }

  sverLogSheet_().appendRow([sverNow_(), batch, code, name,
    'manual (' + (countedBy || 'unknown') + ')',
    sysQty, '', sysQty, qty, adj, impact, note || '']);

  const msg = code + '  ' + name + '\n\nsystem: ' + sysQty + '\ncounted: ' + qty +
    '\nadjustment: ' + (adj > 0 ? '+' : '') + adj +
    '\nvalue: Rs ' + impact.toLocaleString('en-IN') +
    '\n\nThis is recorded here only. Correct it in Vasy too, or the next\n' +
    'pull will overwrite it.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return { system: sysQty, counted: qty, adjustment: adj, impact: impact };
}

/* ================= 5. views ================= */

function openCountTasks() {
  const txn = txnBook_();
  const t = sverRead_(txn, SVER.TASKS, 'item_code');
  if (!t) { try { SpreadsheetApp.getUi().alert('No tasks yet.'); } catch (e) {} return; }
  const open = t.rows.filter(r => String(r[t.H.status]).trim() === SVER_OPEN);
  const def = t.rows.filter(r => String(r[t.H.status]).trim() === 'deferred');
  const today = sverToday_();
  const due = def.filter(r => {
    const u = sverDate_(r[t.H.defer_until]);
    return u && u <= today;
  });
  const lines = open.slice(0, 20).map(r =>
    '   ' + String(r[t.H.item_code]) + '  ' +
    String(r[t.H.product_name] || '').slice(0, 34) +
    '   qty ' + r[t.H.qty_at_assign]);
  const msg = 'OPEN COUNTS\n\n' +
    'awaiting count: ' + open.length + '\n' +
    'deferred: ' + def.length + (due.length ? '   (' + due.length + ' now due again)' : '') +
    '\n\n' + (lines.length ? lines.join('\n') : '   none') +
    (open.length > 20 ? '\n   …and ' + (open.length - 20) + ' more' : '');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function countBatchStatus() {
  const txn = txnBook_();
  const t = sverRead_(txn, SVER.TASKS, 'item_code');
  if (!t) { try { SpreadsheetApp.getUi().alert('No tasks yet.'); } catch (e) {} return; }
  const b = {};
  t.rows.forEach(r => {
    const id = String(r[t.H.batch_id] || '?');
    const st = String(r[t.H.status] || '?').trim();
    if (!b[id]) b[id] = { n: 0, s: {} };
    b[id].n++;
    b[id].s[st] = (b[id].s[st] || 0) + 1;
  });
  const ids = Object.keys(b).sort().reverse().slice(0, 8);
  const msg = 'COUNT BATCHES\n\n' + ids.map(id =>
    '   ' + id + '  (' + b[id].n + ')\n      ' +
    Object.keys(b[id].s).sort().map(k => k + ': ' + b[id].s[k]).join(', ')
  ).join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function countProgress() {
  const txn = txnBook_();
  const pa = sverRead_(txn, SVER.ANALYTICS, 'item_code');
  if (!pa) throw new Error('Product_Analytics is empty.');
  const t = sverRead_(txn, SVER.TASKS, 'item_code');

  const done = {};
  if (t) t.rows.forEach(r => {
    const st = String(r[t.H.status] || '').trim();
    if (st === 'counted') done[String(r[t.H.item_code]).trim()] = 1;
  });

  let total = 0, verified = 0, neg = 0, negDone = 0, valTot = 0, valDone = 0;
  pa.rows.forEach(r => {
    const c = String(r[pa.H.item_code] || '').trim();
    if (!c) return;
    const q = sverNum_(r[pa.H.qty_total]);
    const v = Math.abs(sverNum_(r[pa.H.stock_value]));
    total++; valTot += v;
    if (done[c]) { verified++; valDone += v; }
    if (q < 0) { neg++; if (done[c]) negDone++; }
  });

  const msg = 'COUNT PROGRESS\n\n' +
    'products verified: ' + verified + ' of ' + total +
    '  (' + (total ? (verified / total * 100).toFixed(1) : 0) + '%)\n' +
    'stock value verified: ' + (valTot ? (valDone / valTot * 100).toFixed(1) : 0) + '%\n\n' +
    'negative stock: ' + negDone + ' of ' + neg + ' resolved\n\n' +
    (neg > negDone ?
      'Reorder points and excess figures are not meaningful for the\n' +
      (neg - negDone) + ' products still showing negative stock.' :
      'No negative stock remains — the inventory analysis can be trusted\n' +
      'across the catalogue.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function countAccuracy() {
  const txn = txnBook_();
  const log = sverRead_(txn, SVER.LOG, 'item_code');
  if (!log) { try { SpreadsheetApp.getUi().alert('No counts detected yet.'); } catch (e) {} return; }
  let n = 0, big = 0, impact = 0;
  const bySrc = {};
  log.rows.forEach(r => {
    const a = sverNum_(r[log.H.adjustment]);
    const im = Math.abs(sverNum_(r[log.H.value_impact]));
    const src = String(r[log.H.source] || '?');
    bySrc[src] = (bySrc[src] || 0) + 1;
    n++; impact += im;
    if (Math.abs(a) > 5) big++;
  });
  const msg = 'COUNT ACCURACY\n\n' +
    'counts recorded: ' + n + '\n' +
    'adjustments over 5 units: ' + big + '\n' +
    'stock value corrected: Rs ' + Math.round(impact).toLocaleString('en-IN') + '\n\n' +
    '── by source ──\n' +
    Object.keys(bySrc).sort().map(k => '   ' + k + ': ' + bySrc[k]).join('\n') +
    '\n\nLarge adjustments early are expected — they are the backlog of\n' +
    'unrecorded purchases being cleared. If they persist after a full\n' +
    'cycle, the problem is entry discipline, not counting.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenStockCount() {
  SpreadsheetApp.getUi()
    .createMenu('📋 Stock Count')
    .addItem('Hand out next batch', 'buildCountBatch')
    .addItem('Open counts', 'openCountTasks')
    .addSeparator()
    .addItem('Detect counts from Vasy', 'detectCounts')
    .addItem('Batch status', 'countBatchStatus')
    .addSeparator()
    .addItem('Progress', 'countProgress')
    .addItem('Accuracy', 'countAccuracy')
    .addToUi();
}