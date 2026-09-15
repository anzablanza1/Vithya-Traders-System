/**********************************************************************
 * VITHYA TRADERS — STOCK HISTORY  +  INVENTORY CONFIG
 *
 * ── WHY THIS EXISTS ──
 *   ERP_Snapshot says what is on hand TODAY. Nothing says what was on hand on
 *   1 May. Without that you cannot compute true inventory turns, stockout days
 *   or fill rate — and none of it is recoverable later. It can only be started.
 *
 * ── WHY DELTA STORAGE, NOT A FULL DAILY SNAPSHOT ──
 *   A full snapshot of ~7,000 SKUs every night is 2.5M rows a year. That alone
 *   would fill a workbook.
 *   Most SKUs do not move on most days, so this stores only the rows where qty
 *   CHANGED since the last snapshot, plus one full anchor snapshot on the 1st
 *   of each month.
 *   From an anchor plus the deltas after it, stock on any date is exactly
 *   reconstructable. Expect roughly 500-1,500 rows a night instead of 7,000.
 *
 * ── WHAT IT WRITES (VT_Transactions) ──
 *   Stock_History      date | item_code | lane | qty | cost | value | kind
 *                      kind = 'anchor' (monthly full) or 'delta' (changed only)
 *   Inventory_Config   the settings every inventory calculation reads
 *   Supplier_Leadtime  lead days per supplier, filled by hand until the PO
 *                      dashboard join exists
 *
 * ── RUN ──
 *   1. setupInventoryConfig()     creates the two config tabs with defaults
 *   2. snapshotStock()            take one now — this becomes the first anchor
 *   3. installStockTrigger()      nightly at 23:00, unattended from then on
 *      stockHistoryStatus()       coverage and size any time
 **********************************************************************/

const SH = {
  SNAP: 'ERP_Snapshot',
  PRICING: 'Pricing',
  HIST: 'Stock_History',
  CONFIG: 'Inventory_Config',
  LEADTIME: 'Supplier_Leadtime',
  LATEST: 'Stock_Latest',     // last known qty per SKU — the delta baseline
};

const SH_COLS = ['date', 'item_code', 'lane', 'qty', 'cost', 'value', 'kind'];

function shNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function shToday_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ================= config ================= */

const SH_DEFAULTS = [
  ['holding_cost_pct', 22, 'Annual cost of holding stock: capital + storage + obsolescence + insurance + handling. Capital cost is most of it — if you borrow at 13%, 22% total is a fair start. EOQ is insensitive to this, so a rough figure is fine.'],
  ['service_level_A', 97, 'Target availability % for A-class items. Z = 1.88'],
  ['service_level_B', 95, 'B-class. Z = 1.65'],
  ['service_level_C', 90, 'C-class. Z = 1.28. Holding C items at 99% ties up cash for no benefit.'],
  ['reserve_qty', 2, 'Keep this many units of a slow item purely for reference/display. Not counted as dead.'],
  ['slow_days', 180, 'No sale in this many days = SLOW. A warning, not a write-off.'],
  ['dead_days', 365, 'No sale in this many days = DEAD. Beyond reserve_qty, this is capital to release.'],
  ['excess_cover_days', 90, 'Stock cover beyond this many days = EXCESS.'],
  ['default_lead_days', 15, 'Used when a supplier has no entry in Supplier_Leadtime.'],
  ['order_cost', 250, 'Cost of placing one purchase order (time, follow-up, paperwork). Used by EOQ.'],
  ['abc_a_pct', 80, 'Cumulative revenue % defining A class.'],
  ['abc_b_pct', 95, 'Cumulative revenue % defining B class (A + B).'],
  ['xyz_x_cv', 0.5, 'Demand coefficient of variation below this = X (stable).'],
  ['xyz_y_cv', 1.0, 'Below this = Y (variable). Above = Z (erratic).'],
  ['anchor_day', 1, 'Day of month for a full anchor snapshot. Other nights store only changes.'],
];

function setupInventoryConfig() {
  const ss = txnBook_();

  let cf = vtSheet(SH.CONFIG);
  if (!cf) {
    cf = ss.insertSheet(SH.CONFIG);
    cf.getRange(1, 1, 1, 3).setValues([['setting', 'value', 'what it means']]);
    cf.setFrozenRows(1);
    cf.getRange(1, 1, 1, 3).setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
    cf.getRange(2, 1, SH_DEFAULTS.length, 3).setValues(SH_DEFAULTS);
    cf.setColumnWidth(1, 180);
    cf.setColumnWidth(2, 90);
    cf.setColumnWidth(3, 620);
    cf.getRange(2, 3, SH_DEFAULTS.length, 1).setWrap(true).setFontColor('#6C6C60');
    cf.getRange(2, 2, SH_DEFAULTS.length, 1).setBackground('#E9F0F9').setFontWeight('bold');
  }

  let lt = vtSheet(SH.LEADTIME);
  if (!lt) {
    lt = ss.insertSheet(SH.LEADTIME);
    lt.getRange(1, 1, 1, 5).setValues([['supplier_name', 'lead_days',
      'reliability', 'min_order_value', 'note']]);
    lt.setFrozenRows(1);
    lt.getRange(1, 1, 1, 5).setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
    lt.setColumnWidth(1, 260);
    lt.getRange(2, 1).setValue('(fill from your purchase experience)');
    lt.getRange(2, 1).setFontStyle('italic').setFontColor('#8A8A7E');
    /* seed the supplier list from the purchase register, if it is reachable */
    try {
      const master = SpreadsheetApp.getActiveSpreadsheet();
      const pr = master.getSheetByName('Purchase_Register');
      if (pr && pr.getLastRow() > 1) {
        const v = pr.getDataRange().getValues();
        const H = {}; v[0].forEach((h, i) => H[String(h).trim()] = i);
        const seen = {};
        for (let i = 1; i < v.length; i++) {
          const p = String(v[i][H.partyName] || '').trim();
          if (p) seen[p] = 1;
        }
        const names = Object.keys(seen).sort();
        if (names.length) {
          lt.getRange(2, 1, 1, 5).clearContent();
          lt.getRange(2, 1, names.length, 1).setValues(names.map(n => [n]));
        }
      }
    } catch (e) { /* seeding is a convenience, not a requirement */ }
  }

  const msg = 'INVENTORY CONFIG READY\n\n' +
    SH.CONFIG + '  — ' + SH_DEFAULTS.length + ' settings with defaults and\n' +
    '   an explanation of each. Change the blue value column.\n\n' +
    SH.LEADTIME + ' — lead days per supplier. Fill what you know;\n' +
    '   anything blank falls back to default_lead_days.\n\n' +
    'Next: snapshotStock(), then installStockTrigger().';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function invConfig_() {
  const ss = txnBook_();
  const cf = vtSheet(SH.CONFIG);
  const out = {};
  SH_DEFAULTS.forEach(d => out[d[0]] = d[1]);
  if (!cf || cf.getLastRow() < 2) return out;
  const v = cf.getRange(2, 1, cf.getLastRow() - 1, 2).getValues();
  v.forEach(r => {
    const k = String(r[0]).trim();
    if (!k) return;
    const n = Number(r[1]);
    out[k] = isFinite(n) ? n : r[1];
  });
  return out;
}

/* ================= the snapshot ================= */

function shHistSheet_() {
  const ss = txnBook_();
  let sh = vtSheet(SH.HIST);
  if (!sh) {
    sh = ss.insertSheet(SH.HIST);
    sh.getRange(1, 1, 1, SH_COLS.length).setValues([SH_COLS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SH_COLS.length).setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
  }
  return sh;
}

/* cost per item code, from the master Pricing tab */
function shCosts_() {
  const out = {};
  try {
    const pg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.PRICING);
    if (!pg) return out;
    let hRow = 1;
    for (let r = 1; r <= 8; r++) {
      if (String(pg.getRange(r, 1).getValue()).trim() === 'product_id') { hRow = r; break; }
    }
    const hdr = pg.getRange(hRow, 1, 1, pg.getLastColumn()).getValues()[0];
    const H = {}; hdr.forEach((h, i) => H[String(h).trim()] = i);
    if (H.item_code === undefined) return out;
    const n = pg.getLastRow() - hRow;
    if (n < 1) return out;
    const v = pg.getRange(hRow + 1, 1, n, pg.getLastColumn()).getValues();
    v.forEach(r => {
      const c = String(r[H.item_code] || '').trim();
      if (!c) return;
      out[c] = {
        w: H.cost_w_exGST !== undefined ? shNum_(r[H.cost_w_exGST]) : 0,
        wo: H.cost_wo !== undefined ? shNum_(r[H.cost_wo]) : 0,
      };
    });
  } catch (e) { /* costs are a bonus; qty history is the point */ }
  return out;
}

/* ---- the delta baseline, stored as a sheet ---- */

function shLatestSheet_() {
  const ss = txnBook_();
  let sh = vtSheet(SH.LATEST);
  if (!sh) {
    sh = ss.insertSheet(SH.LATEST);
    sh.getRange(1, 1, 1, 3).setValues([['item_code', 'qty', 'as_of']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 3).setFontWeight('bold')
      .setBackground('#6C6C60').setFontColor('#FFFFFF');
  }
  return sh;
}

function shLoadLatest_() {
  const sh = shLatestSheet_();
  const out = {};
  const n = sh.getLastRow() - 1;
  if (n < 1) return out;
  const v = sh.getRange(2, 1, n, 2).getValues();
  v.forEach(r => {
    const c = String(r[0] || '').trim();
    if (c) out[c] = shNum_(r[1]);
  });
  return out;
}

function shSaveLatest_(qtyMap) {
  const sh = shLatestSheet_();
  const today = shToday_();
  const codes = Object.keys(qtyMap);

  /* This rewrites the whole tab. If ERP_Snapshot were empty or half-written
     when the snapshot ran, that would wipe the delta baseline — the same
     shape of mistake that cost 188,000 sales rows. Refuse instead. */
  const had = Math.max(0, sh.getLastRow() - 1);
  if (had > 100 && codes.length < had * 0.5) {
    throw new Error('REFUSING TO REWRITE Stock_Latest.\n\n' +
      'It holds ' + had.toLocaleString() + ' SKUs but ERP_Snapshot only ' +
      'produced ' + codes.length.toLocaleString() + '. That looks like a ' +
      'partial or failed product pull, not a real change.\n\n' +
      'Nothing was written. Check ERP_Snapshot, then run snapshotStock() again.');
  }

  const rows = codes.map(c => [c, qtyMap[c], today]);
  sh.clear();
  sh.getRange(1, 1, 1, 3).setValues([['item_code', 'qty', 'as_of']]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold')
    .setBackground('#6C6C60').setFontColor('#FFFFFF');
  const B = 5000;
  for (let i = 0; i < rows.length; i += B) {
    const blk = rows.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, 3).setValues(blk);
  }
}

/* one-time cleanup for the property that blew the quota */
function shClearOldProperty() {
  const p = PropertiesService.getScriptProperties();
  let removed = 0;
  ['SH_LAST_QTY'].forEach(k => {
    if (p.getProperty(k) !== null) { p.deleteProperty(k); removed++; }
  });
  const all = p.getProperties();
  const big = Object.keys(all).filter(k => String(all[k]).length > 5000);
  const msg = 'Removed ' + removed + ' oversized propert(ies).\n\n' +
    'Properties still stored: ' + Object.keys(all).length +
    (big.length ? '\nStill large: ' + big.join(', ') : '\nNone are oversized now.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function snapshotStock() {
  const t0 = Date.now();
  const master = SpreadsheetApp.getActiveSpreadsheet();
  const snap = vtSheet(SH.SNAP);
  if (!snap || snap.getLastRow() < 2) throw new Error('ERP_Snapshot is empty.');
  /* a snapshot taken mid-refresh records wrong quantities for every product */
  if (snap.getLastRow() < 1000) {
    throw new Error('ERP_Snapshot has only ' + (snap.getLastRow() - 1) +
      ' rows — that looks like a partial pull. Snapshot skipped so the ' +
      'history is not polluted with wrong quantities.');
  }

  const hdr = snap.getRange(1, 1, 1, snap.getLastColumn()).getValues()[0];
  const H = {}; hdr.forEach((h, i) => H[String(h).trim()] = i);
  const v = snap.getRange(2, 1, snap.getLastRow() - 1, snap.getLastColumn()).getValues();

  const costs = shCosts_();
  const cfg = invConfig_();
  const today = shToday_();
  const dom = new Date().getDate();
  const isAnchor = (dom === Math.round(cfg.anchor_day || 1));

  /* previous quantities, so we can store only what moved.
     Kept in a SHEET, not Script Properties — 13,548 codes is ~300KB of JSON
     and Script Properties cap at ~500KB total, which blew the quota. */
  const prev = shLoadLatest_();

  const rows = [];
  const nowQty = {};
  v.forEach(r => {
    const code = String(r[H.itemCode] || '').trim();
    if (!code) return;
    const qty = shNum_(r[H.qty]);
    nowQty[code] = qty;
    if (!isAnchor) {
      const was = prev[code];
      if (was !== undefined && Math.abs(was - qty) < 0.0001) return;   // unchanged
      if (was === undefined && qty === 0) return;                      // never held, still none
    } else if (qty === 0) return;                                      // anchor: only what we hold
    const canon = code.replace(/\/+$/, '');
    const lane = code.slice(-1) === '/' ? 'WO' : 'W';
    const c = costs[canon] || {};
    const cost = lane === 'WO' ? shNum_(c.wo) : shNum_(c.w);
    rows.push([today, code, lane, qty, cost, Math.round(qty * cost * 100) / 100,
      isAnchor ? 'anchor' : 'delta']);
  });

  const sh = shHistSheet_();
  if (rows.length) {
    const B = 5000;
    for (let i = 0; i < rows.length; i += B) {
      const blk = rows.slice(i, i + B);
      sh.getRange(sh.getLastRow() + 1, 1, blk.length, SH_COLS.length).setValues(blk);
    }
  }
  shSaveLatest_(nowQty);

  const value = rows.reduce((s, r) => s + r[5], 0);
  const msg = 'STOCK SNAPSHOT ' + today + (isAnchor ? '  [ANCHOR — full]' : '  [delta]') +
    '\n\nrows written: ' + rows.length +
    '\nSKUs tracked: ' + Object.keys(nowQty).length +
    (isAnchor ? '\nstock value: Rs ' + Math.round(value).toLocaleString('en-IN') : '') +
    '\n(' + Math.round((Date.now() - t0) / 1000) + 's)';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return rows.length;
}

/* ================= trigger ================= */

function installStockTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'snapshotStock') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('snapshotStock').timeBased().everyDays(1).atHour(23).create();
  const msg = 'Nightly stock snapshot installed for 23:00.\n\n' +
    'It runs AFTER the day\'s trading and BEFORE the 01:00 ERP refresh,\n' +
    'so each snapshot reflects a complete trading day.\n\n' +
    'Full anchor on the 1st of each month; changed rows only on other nights.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function removeStockTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'snapshotStock') { ScriptApp.deleteTrigger(t); n++; }
  });
  try { SpreadsheetApp.getUi().alert('Removed ' + n + ' stock trigger(s).'); } catch (e) {}
}

function stockHistoryStatus() {
  const ss = txnBook_();
  const sh = vtSheet(SH.HIST);
  if (!sh || sh.getLastRow() < 2) {
    try { SpreadsheetApp.getUi().alert('No stock history yet.\nRun snapshotStock().'); } catch (e) {}
    return;
  }
  const n = sh.getLastRow() - 1;
  const dates = sh.getRange(2, 1, n, 1).getValues();
  const kinds = sh.getRange(2, 7, n, 1).getValues();
  const uniq = {}; let anchors = 0;
  dates.forEach((d, i) => {
    uniq[String(d[0])] = 1;
    if (String(kinds[i][0]) === 'anchor') anchors++;
  });
  const days = Object.keys(uniq).sort();
  const on = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'snapshotStock').length;
  const msg = 'STOCK HISTORY\n\n' +
    'rows: ' + n.toLocaleString() + '\n' +
    'days covered: ' + days.length + '\n' +
    'first: ' + days[0] + '\nlast:  ' + days[days.length - 1] + '\n' +
    'anchor rows: ' + anchors + '\n' +
    'nightly trigger: ' + (on ? 'ON (23:00)' : 'OFF') + '\n\n' +
    (days.length < 30 ?
      'True turns and fill rate need about 90 days. ' + (90 - days.length) +
      ' to go.' :
      'Enough history for turns and service-level analysis.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= reconstruct stock on any date ================= */

/**
 * Stock as at a date, rebuilt from the last anchor on or before it plus every
 * delta after it. This is what makes average-inventory and turns possible.
 * stockAsAt('2026-06-30') -> { itemCode: qty }
 */
function stockAsAt(dateStr) {
  const ss = txnBook_();
  const sh = vtSheet(SH.HIST);
  if (!sh || sh.getLastRow() < 2) throw new Error('No stock history yet.');
  const n = sh.getLastRow() - 1;
  const v = sh.getRange(2, 1, n, SH_COLS.length).getValues();
  const target = String(dateStr);

  let anchorDate = '';
  v.forEach(r => {
    const d = String(r[0]);
    if (r[6] === 'anchor' && d <= target && d > anchorDate) anchorDate = d;
  });
  if (!anchorDate) throw new Error('No anchor snapshot on or before ' + target);

  const qty = {};
  v.forEach(r => {
    const d = String(r[0]);
    if (d < anchorDate || d > target) return;
    qty[String(r[1])] = shNum_(r[3]);
  });
  Logger.log('Stock at ' + target + ' rebuilt from anchor ' + anchorDate +
    ': ' + Object.keys(qty).length + ' SKUs');
  return qty;
}

function onOpenStockHistory() {
  SpreadsheetApp.getUi()
    .createMenu('📈 Stock History')
    .addItem('1. Set up inventory config', 'setupInventoryConfig')
    .addItem('2. Take a snapshot now', 'snapshotStock')
    .addItem('3. Install nightly trigger', 'installStockTrigger')
    .addSeparator()
    .addItem('Status', 'stockHistoryStatus')
    .addItem('Remove nightly trigger', 'removeStockTrigger')
    .addItem('Clear old oversized property', 'shClearOldProperty')
    .addToUi();
}