/**********************************************************************
 * VITHYA TRADERS — STOCK RECONCILIATION
 *
 * Globals declared here (check before pasting):
 *   SR, compareWithExport, stockExportSetup, stockFromExport,
 *   srRead_, srHeader_, srCanon_, srNum_, srKey_, onOpenStockRecon
 *
 * ── WHAT THIS SETTLES ──
 *   The API and the Vasy Product screen disagree:
 *
 *       STD10120S    screen 5,168    API 4,876
 *       STD10120S/   screen   181    API 5,872
 *
 *   We have ruled out the date window (1,000 of 1,000 products identical
 *   with and without it) and batch rows (exactly two rows, one per lane).
 *   What remains is either a timing difference or a different definition of
 *   quantity — and comparing two readings taken hours apart cannot tell them
 *   apart.
 *
 *   So: export the product list from Vasy, pull from the API within a few
 *   minutes of it, and compare every product. 13,000 comparisons taken at
 *   the same moment answers in one run what guessing has not.
 *
 * ── AND IF THE API IS WRONG ──
 *   This is also the fallback. If the export is the truth, the same file can
 *   feed Stock_Live directly — hourly is not possible, but a twice-daily
 *   upload beats a number nobody trusts.
 *
 * ── HOW ──
 *   1. Vasy > Items > Product > Export > Excel
 *   2. Upload it to Drive and open it as a Google Sheet
 *      (File > Save as Google Sheets — the API cannot read .xlsx)
 *   3. Put its id in the Script Property VT_STOCK_EXPORT_ID
 *   4. Run pullStockNow(), then compareWithExport()
 *
 * ── RUN ──
 *   stockExportSetup()     tells you what is missing
 *   compareWithExport()    the comparison
 **********************************************************************/

const SR = {
  FILE_PROP: 'VT_STOCK_EXPORT_ID',
  /* the export's own column names, lower-cased and stripped of spaces */
  CODE_KEYS: ['itemcode', 'item_code', 'code', 'skucode'],
  QTY_KEYS: ['qty', 'quantity', 'stock', 'closingqty', 'closingstock', 'balance'],
  NAME_KEYS: ['name', 'productname', 'product', 'description'],
  TOLERANCE: 0.01,
};

function srNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function srCanon_(c) { return String(c || '').replace(/\/+\s*$/, '').trim(); }
function srKey_(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function stockExportSetup() {
  const id = PropertiesService.getScriptProperties().getProperty(SR.FILE_PROP);
  const L = ['STOCK EXPORT', ''];
  if (!id) {
    L.push('Not set up yet.');
    L.push('');
    L.push('1. In Vasy: Items > Product > Export > Excel');
    L.push('2. Upload to Drive, then File > Save as Google Sheets');
    L.push('   (a .xlsx cannot be read directly)');
    L.push('3. Copy the id from its URL — the long code between /d/ and /edit');
    L.push('4. Project Settings > Script Properties > add');
    L.push('      ' + SR.FILE_PROP + ' = that id');
  } else {
    try {
      const ss = SpreadsheetApp.openById(id);
      const sh = ss.getSheets()[0];
      L.push('Linked: ' + ss.getName());
      L.push('rows: ' + Math.max(0, sh.getLastRow() - 1).toLocaleString());
      L.push('');
      const H = srHeader_(sh);
      if (H.row) {
        L.push('header found on row ' + H.row +
          (H.row > 1 ? '   (rows above it are a banner)' : ''));
        L.push('');
        L.push('columns: ' + H.hdr.filter(String).join(', ').slice(0, 500));
        L.push('');
        L.push('item code column: ' + H.hdr[H.codeAt]);
        L.push('quantity column : ' + H.hdr[H.qtyAt]);
        L.push('data rows       : ' + (sh.getLastRow() - H.row).toLocaleString());
        L.push('');
        L.push('Ready. Run pullStockNow() then compareWithExport().');
      } else {
        L.push('No header row found in the first 10.');
        L.push('');
        L.push('These are the first rows as they read —');
        const look = Math.min(6, sh.getLastRow());
        const blk = sh.getRange(1, 1, look, Math.min(sh.getLastColumn(), 20)).getValues();
        for (let r = 0; r < look; r++) {
          L.push('  row ' + (r + 1) + ': ' +
            blk[r].map(function (x) { return String(x); })
              .filter(String).join(' | ').slice(0, 160));
        }
        L.push('');
        L.push('Tell me which row is the header and which two columns hold the');
        L.push('item code and the quantity.');
      }
    } catch (e) {
      L.push('Could not open ' + id);
      L.push(e.message);
      L.push('');
      L.push('If it is still an .xlsx, open it in Drive and use');
      L.push('File > Save as Google Sheets, then use the NEW id.');
    }
  }
  const msg = L.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
}

/**
 * Find the real header row.
 *
 * The export opens with a branch banner — "Vithya Traders-Main branch" — so
 * row 1 is a title, not a header. Your Pricing sheet does the same thing with
 * its legend rows. So rather than assuming row 1, look down the first several
 * rows for one that actually contains an item-code column.
 */
function srHeader_(sh) {
  const look = Math.min(10, sh.getLastRow());
  const wide = Math.min(sh.getLastColumn(), 60);
  const block = sh.getRange(1, 1, look, wide).getValues();
  for (let r = 0; r < look; r++) {
    const keys = block[r].map(srKey_);
    const codeAt = keys.findIndex(function (k) { return SR.CODE_KEYS.indexOf(k) >= 0; });
    const qtyAt = keys.findIndex(function (k) { return SR.QTY_KEYS.indexOf(k) >= 0; });
    if (codeAt >= 0 && qtyAt >= 0) {
      const nameAt = keys.findIndex(function (k) { return SR.NAME_KEYS.indexOf(k) >= 0; });
      return { row: r + 1, hdr: block[r], codeAt: codeAt, qtyAt: qtyAt, nameAt: nameAt };
    }
  }
  /* nothing matched — hand back the widest row so the caller can show it */
  let best = 0, bestN = 0;
  for (let r = 0; r < look; r++) {
    const n = block[r].filter(String).length;
    if (n > bestN) { bestN = n; best = r; }
  }
  return { row: 0, hdr: block[best] || [], codeAt: -1, qtyAt: -1, nameAt: -1 };
}

function srRead_() {
  const id = PropertiesService.getScriptProperties().getProperty(SR.FILE_PROP);
  if (!id) throw new Error('Set ' + SR.FILE_PROP + ' first — run stockExportSetup().');
  const sh = SpreadsheetApp.openById(id).getSheets()[0];
  if (sh.getLastRow() < 2) throw new Error('The export has no rows.');
  const H = srHeader_(sh);
  if (H.codeAt < 0 || H.qtyAt < 0) {
    throw new Error('Could not find the code and quantity columns in the ' +
      'first 10 rows.\n\nWidest row seen: ' +
      H.hdr.filter(String).join(', ').slice(0, 400) +
      '\n\nTell me which two columns to use and I will add them.');
  }
  const hdr = H.hdr;
  const codeAt = H.codeAt, qtyAt = H.qtyAt, nameAt = H.nameAt;
  const n = sh.getLastRow() - H.row;
  if (n < 1) throw new Error('No rows below the header.');
  const v = sh.getRange(H.row + 1, 1, n, sh.getLastColumn()).getValues();
  const out = {};
  v.forEach(function (r) {
    const raw = String(r[codeAt] || '').trim();
    if (!raw) return;
    out[raw] = { qty: srNum_(r[qtyAt]),
      name: nameAt >= 0 ? String(r[nameAt] || '') : '' };
  });
  return { rows: out, count: Object.keys(out).length,
    codeCol: hdr[codeAt], qtyCol: hdr[qtyAt], headerRow: H.row };
}

/**
 * Every product, both sources, side by side.
 *
 * Compares per SKU — the raw code including the trailing slash — because
 * that is what both sides actually hold. Combining lanes would hide a
 * disagreement in one of them.
 */
function compareWithExport() {
  const exp = srRead_();
  const live = lsRead_();
  if (!live) throw new Error('Stock_Live is empty — run pullStockNow() first.');

  /* the pull stores canonical codes with the lanes split, so rebuild the
     per-SKU view to compare like with like */
  const api = {};
  live.forEach(function (r) {
    const canon = String(r[0] || '').trim();
    if (!canon) return;
    api[canon] = srNum_(r[2]);            // W
    api[canon + '/'] = srNum_(r[3]);      // WO
  });

  let both = 0, same = 0, diff = 0, onlyExp = 0, onlyApi = 0;
  let sumExp = 0, sumApi = 0;
  const examples = [];

  Object.keys(exp.rows).forEach(function (code) {
    const e = exp.rows[code].qty;
    const a = api[code];
    if (a === undefined) { onlyExp++; return; }
    both++;
    sumExp += e; sumApi += a;
    if (Math.abs(e - a) <= SR.TOLERANCE) same++;
    else {
      diff++;
      if (examples.length < 12) {
        examples.push('   ' + code.padEnd(16) + ' export ' +
          String(e).padStart(10) + '   api ' + String(a).padStart(10) +
          '   ' + (a - e > 0 ? '+' : '') + Math.round(a - e));
      }
    }
  });
  Object.keys(api).forEach(function (c) {
    if (exp.rows[c] === undefined && api[c] !== 0) onlyApi++;
  });

  const pct = both ? Math.round(same / both * 1000) / 10 : 0;
  const L = ['STOCK: EXPORT vs API', ''];
  L.push('export : ' + exp.count.toLocaleString() + ' SKUs   (' +
    exp.codeCol + ' / ' + exp.qtyCol + ')');
  L.push('api    : ' + Object.keys(api).length.toLocaleString() + ' SKUs');
  L.push('');
  L.push('compared      : ' + both.toLocaleString());
  L.push('   agree      : ' + same.toLocaleString() + '   (' + pct + '%)');
  L.push('   disagree   : ' + diff.toLocaleString());
  L.push('only in export: ' + onlyExp.toLocaleString());
  L.push('only in api   : ' + onlyApi.toLocaleString());
  L.push('');
  L.push('total units   export ' + Math.round(sumExp).toLocaleString() +
    '   api ' + Math.round(sumApi).toLocaleString());
  if (examples.length) {
    L.push('');
    L.push('where they disagree:');
    examples.forEach(function (x) { L.push(x); });
  }
  L.push('');
  if (pct >= 99) {
    L.push('THE API IS RIGHT. The earlier gap was two readings taken hours');
    L.push('apart, not a wrong field. pullStockNow() can be trusted and the');
    L.push('half-hourly trigger is all you need.');
  } else if (pct >= 80) {
    L.push('MOSTLY AGREES. The disagreements above are the ones to look at —');
    L.push('if they share a pattern (a category, a product type, all negative)');
    L.push('that will name the cause.');
  } else {
    L.push('THEY DO NOT AGREE. The API qty is not the number the counter sees,');
    L.push('so we should feed Stock_Live from this export instead. Say the');
    L.push('word and I will switch it — twice-daily truth beats hourly fiction.');
  }
  const msg = L.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return { agree: pct, diff: diff };
}

/**
 * Build Stock_Live from the Vasy export instead of the API.
 *
 * The export matched the Vasy screen exactly on every product checked, which
 * is more than the API can currently claim. It is not live — it is as fresh
 * as the last export — but a number the counter trusts twice a day beats one
 * that is available hourly and wrong.
 *
 * The floor reads Stock_Live either way, so nothing downstream changes.
 *
 *   1. In Vasy, make sure the FINANCIAL YEAR selector says 2026-2027
 *   2. Items > Product > Export > Excel
 *   3. Upload to Drive, File > Save as Google Sheets
 *   4. Keep the SAME file id in VT_STOCK_EXPORT_ID and re-run this
 */
function stockFromExport() {
  const exp = srRead_();
  if (!exp.count) throw new Error('The export has no rows.');

  /* combine the lanes, exactly as the API path does */
  const byCanon = {};
  Object.keys(exp.rows).forEach(function (raw) {
    const canon = srCanon_(raw);
    if (!canon) return;
    const isWo = raw.slice(-1) === '/';
    if (!byCanon[canon]) byCanon[canon] = {
      code: canon, name: '', w: 0, wo: 0, nw: 0, nwo: 0,
    };
    const b = byCanon[canon];
    const q = srNum_(exp.rows[raw].qty);
    if (isWo) { b.wo += q; b.nwo++; } else { b.w += q; b.nw++; }
    if (!b.name) b.name = String(exp.rows[raw].name || '').replace(/\s*\/$/, '');
  });

  const codes = Object.keys(byCanon);
  if (!codes.length) throw new Error('Nothing usable in the export.');

  /* the same refusal the API path has — a short file must not wipe a good one */
  const sh = lsSheet_();
  const had = Math.max(0, sh.getLastRow() - 1);
  if (had > 500 && codes.length < had * 0.8) {
    throw new Error('REFUSING TO WRITE.\n\nThe export gives ' +
      codes.length.toLocaleString() + ' products against ' +
      had.toLocaleString() + ' already stored. Too large a drop to be real.');
  }

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm');
  const rows = codes.map(function (k) {
    const b = byCanon[k];
    return [b.code, b.name, b.w, b.wo, b.w + b.wo, b.nw, b.nwo, '', '', stamp];
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

  let pos = 0, zero = 0, neg = 0;
  rows.forEach(function (r) {
    if (r[4] > 0) pos++; else if (r[4] === 0) zero++; else neg++;
  });
  PropertiesService.getScriptProperties().setProperty('LS_META', JSON.stringify({
    at: stamp, products: rows.length, seen: exp.count,
    positive: pos, zero: zero, negative: neg, source: 'export',
  }));
  try { vtInvalidate(); } catch (e) {}

  const msg = 'STOCK FROM THE EXPORT\n\n' +
    'SKUs in the file : ' + exp.count.toLocaleString() + '\n' +
    'products (W+WO)  : ' + rows.length.toLocaleString() + '\n\n' +
    '   on the shelf : ' + pos.toLocaleString() + '\n' +
    '   at zero      : ' + zero.toLocaleString() + '\n' +
    '   negative     : ' + neg.toLocaleString() + '\n\n' +
    'as at ' + stamp + '\n\n' +
    'The counter reads this the same way it reads an API pull. Re-export and\n' +
    're-run whenever it needs refreshing.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return rows.length;
}

function onOpenStockRecon() {
  SpreadsheetApp.getUi()
    .createMenu('🔍 Stock check')
    .addItem('Set up the export', 'stockExportSetup')
    .addItem('Export vs API', 'compareWithExport')
    .addSeparator()
    .addItem('Build stock FROM the export', 'stockFromExport')
    .addToUi();
}