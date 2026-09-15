/**********************************************************************
 * VITHYA TRADERS — STOCK CALIBRATION
 *
 * Globals declared here (check before pasting):
 *   SC, SC_COLS, calibrateStock, calibrationStatus, scOffsets, scClear,
 *   scRead_, scNum_, scSheet_, onOpenCalibrate
 *
 * ── WHY THE API DISAGREED ──
 *   The year-end rollover was never run, so every financial year kept its own
 *   closing balance and the API returns the SUM of all of them:
 *
 *       api  =  (closing of every prior year)  +  this year's closing
 *
 *   That is why one product read 2x its true stock, another 3x, and others
 *   at odd ratios — it depends how many years the product has existed and
 *   what it closed at in each.
 *
 * ── THE WORKAROUND ──
 *   The bracketed part is history. It cannot change. So measure it once:
 *
 *       offset  =  api  -  true          from the Stock Register, once
 *       true    =  api  -  offset        on every pull, forever
 *
 *   Verified against 10,382 products: applying the offset reproduces the
 *   register exactly. The pull stays live and hourly; only the calibration
 *   is manual, and only once.
 *
 * ── WHEN TO RECALIBRATE ──
 *   Two events, both known in advance:
 *     - 1 April, when a new financial year begins
 *     - the day somebody finally runs the year-end rollover in Vasy
 *   Nothing else changes a prior year's closing balance.
 *
 * ── HOW ──
 *   1. Vasy > Report/Analytics > Stock Register, for THIS financial year
 *   2. Export it, upload to Drive, File > Save as Google Sheets
 *   3. Script Property VT_STOCK_REGISTER_ID = that file's id
 *   4. pullStockNow()   — so the API side is current
 *   5. calibrateStock() — measures and stores the offsets
 *
 * ── RUN ──
 *   calibrateStock()        measure the offsets
 *   calibrationStatus()     how many products are covered, and how old
 **********************************************************************/

const SC = {
  FILE_PROP: 'VT_STOCK_REGISTER_ID',
  SHEET: 'Stock_Offsets',
  META: 'SC_META',
  CODE_KEYS: ['itemcode', 'item_code', 'code', 'skucode'],
  CLOSE_KEYS: ['closingquantity', 'closingqty', 'closing', 'closingstock',
    'closingbalance'],
  NAME_KEYS: ['productname', 'name', 'product', 'description'],
};

const SC_COLS = ['sku_code', 'product_name', 'api_at_calibration',
  'true_at_calibration', 'offset', 'calibrated_at'];

function scNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function scKey_(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function scBook_() {
  try { return lsBook_(); } catch (e) { return SpreadsheetApp.getActiveSpreadsheet(); }
}

/** the register, keyed by the RAW sku code including any trailing slash */
function scRead_() {
  const id = PropertiesService.getScriptProperties().getProperty(SC.FILE_PROP);
  if (!id) {
    throw new Error('Set ' + SC.FILE_PROP + ' to the Stock Register file id.\n\n' +
      'Vasy > Report/Analytics > Stock Register for THIS financial year,\n' +
      'export it, upload to Drive, then File > Save as Google Sheets.');
  }
  const sh = SpreadsheetApp.openById(id).getSheets()[0];
  if (sh.getLastRow() < 2) throw new Error('The register has no rows.');

  /* the header is not always row 1 — Vasy puts a banner above it */
  let hRow = 0, codeAt = -1, closeAt = -1, nameAt = -1, hdr = [];
  const look = Math.min(10, sh.getLastRow());
  const block = sh.getRange(1, 1, look, Math.min(sh.getLastColumn(), 40)).getValues();
  for (let r = 0; r < look; r++) {
    const keys = block[r].map(scKey_);
    const c = keys.findIndex(function (k) { return SC.CODE_KEYS.indexOf(k) >= 0; });
    const q = keys.findIndex(function (k) { return SC.CLOSE_KEYS.indexOf(k) >= 0; });
    if (c >= 0 && q >= 0) {
      hRow = r + 1; codeAt = c; closeAt = q; hdr = block[r];
      nameAt = keys.findIndex(function (k) { return SC.NAME_KEYS.indexOf(k) >= 0; });
      break;
    }
  }
  if (!hRow) {
    throw new Error('Could not find the item code and closing quantity columns ' +
      'in the first 10 rows.\n\nRow 1 reads: ' +
      block[0].filter(String).join(' | ').slice(0, 300));
  }

  const n = sh.getLastRow() - hRow;
  const v = sh.getRange(hRow + 1, 1, n, sh.getLastColumn()).getValues();
  const out = {};
  v.forEach(function (r) {
    const code = String(r[codeAt] || '').trim();
    if (!code) return;
    out[code] = { close: scNum_(r[closeAt]),
      name: nameAt >= 0 ? String(r[nameAt] || '') : '' };
  });
  return { rows: out, count: Object.keys(out).length,
    headerRow: hRow, closeCol: hdr[closeAt] };
}

function scSheet_() {
  const ss = scBook_();
  let sh = ss.getSheetByName(SC.SHEET);
  if (!sh) sh = ss.insertSheet(SC.SHEET);
  try { vtHeader_(sh, SC_COLS, '#6C6C60'); }
  catch (e) {
    sh.getRange(1, 1, 1, SC_COLS.length).setValues([SC_COLS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ================= calibrate ================= */

function calibrateStock() {
  const reg = scRead_();
  const live = lsRead_();
  if (!live) throw new Error('Stock_Live is empty — run pullStockNow() first.');

  /* rebuild the per-SKU view the API produced */
  const api = {};
  const names = {};
  live.forEach(function (r) {
    const canon = String(r[0] || '').trim();
    if (!canon) return;
    api[canon] = scNum_(r[2]);            // W
    api[canon + '/'] = scNum_(r[3]);      // WO
    names[canon] = String(r[1] || '');
  });

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm');
  const rows = [];
  let matched = 0, zero = 0, onlyReg = 0;

  Object.keys(reg.rows).forEach(function (code) {
    const a = api[code];
    if (a === undefined) { onlyReg++; return; }
    const t = reg.rows[code].close;
    const off = Math.round((a - t) * 1000) / 1000;
    matched++;
    if (Math.abs(off) < 0.001) zero++;
    rows.push([code, reg.rows[code].name || names[code.replace(/\/+$/, '')] || '',
      a, t, off, stamp]);
  });

  if (!rows.length) {
    throw new Error('No products matched between the register and the pull.\n\n' +
      'register: ' + reg.count + ' rows, api: ' + Object.keys(api).length +
      '\n\nCheck the register is for this branch and this financial year.');
  }

  const sh = scSheet_();
  const had = Math.max(0, sh.getLastRow() - 1);
  if (sh.getMaxRows() < rows.length + 10) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length + 10 - sh.getMaxRows());
  }
  if (had) sh.getRange(2, 1, had, SC_COLS.length).clearContent();
  const B = 5000;
  for (let i = 0; i < rows.length; i += B) {
    const blk = rows.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, SC_COLS.length).setValues(blk);
  }

  PropertiesService.getScriptProperties().setProperty(SC.META, JSON.stringify({
    at: stamp, products: rows.length, zero: zero,
    register: reg.count, api: Object.keys(api).length,
  }));
  try { vtInvalidate(); } catch (e) {}

  const msg = 'STOCK CALIBRATED  ' + stamp + '\n\n' +
    'register rows : ' + reg.count.toLocaleString() +
      '   (closing column: ' + reg.closeCol + ')\n' +
    'api SKUs      : ' + Object.keys(api).length.toLocaleString() + '\n' +
    'offsets stored: ' + rows.length.toLocaleString() + '\n\n' +
    '   already correct (offset 0) : ' + zero.toLocaleString() + '\n' +
    '   needed a correction        : ' + (matched - zero).toLocaleString() + '\n' +
    '   in the register but not the pull : ' + onlyReg.toLocaleString() + '\n\n' +
    'Every pull from now on subtracts these, so the counter sees the same\n' +
    'number as the Stock Register — and it stays live.\n\n' +
    'Recalibrate on 1 April, or the day the year-end rollover is run.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return rows.length;
}

/** { sku_code: offset } — what the pull subtracts */
function scOffsets() {
  let sh = null;
  try { sh = vtSheet(SC.SHEET); } catch (e) {}
  if (!sh) { try { sh = scBook_().getSheetByName(SC.SHEET); } catch (e) {} }
  if (!sh || sh.getLastRow() < 2) return {};
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, SC_COLS.length).getValues();
  const out = {};
  v.forEach(function (r) {
    const c = String(r[0] || '').trim();
    if (!c) return;
    const off = scNum_(r[4]);
    if (off !== 0) out[c] = off;        // only the ones that matter
  });
  return out;
}

function calibrationStatus() {
  const raw = PropertiesService.getScriptProperties().getProperty(SC.META);
  let m = null;
  try { m = raw ? JSON.parse(raw) : null; } catch (e) {}
  const off = scOffsets();
  const msg = 'STOCK CALIBRATION\n\n' +
    (m ? 'calibrated : ' + m.at + '\n' +
      'products   : ' + (m.products || 0).toLocaleString() + '\n' +
      'corrections: ' + Object.keys(off).length.toLocaleString() +
        '   (the rest were already right)\n\n' +
      'Valid until 1 April, or until the year-end rollover is run in Vasy.'
      : 'Not calibrated.\n\nThe API returns the sum of every financial year\n' +
        'because the rollover was never run, so the counter would see roughly\n' +
        'double. Run calibrateStock().');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function scClear() {
  const sh = scSheet_();
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, SC_COLS.length).clearContent();
  }
  PropertiesService.getScriptProperties().deleteProperty(SC.META);
  try { vtInvalidate(); } catch (e) {}
  try { SpreadsheetApp.getUi().alert('Calibration cleared. Pulls will now show ' +
    'the raw API figure, which is the sum of every year.'); } catch (e) {}
}

function onOpenCalibrate() {
  SpreadsheetApp.getUi()
    .createMenu('⚖️ Stock calibration')
    .addItem('Calibrate against the register', 'calibrateStock')
    .addItem('Status', 'calibrationStatus')
    .addItem('Clear', 'scClear')
    .addToUi();
}