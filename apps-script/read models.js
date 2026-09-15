/**********************************************************************
 * VITHYA TRADERS — READ MODELS
 *
 * Globals declared here (check before pasting):
 *   RM, RM_SPECS, buildReadModels, rmRead, rmStatus, rmClear, rmMarkStale,
 *   vtInvalidate, anaBook_, setupAnalyticsBook, linkAnalyticsBook,
 *   rmSheet_, rmSrc_, rmNum_, rmSafe_, onOpenReadModels
 *
 * ── THE PROBLEM ──
 *   Every time a dashboard warms its cache it reads the whole source table.
 *   Product_Analytics is 6,973 x 48 = 334,704 cells. Apps Script pulls that
 *   across the wire, converts it, JSON-encodes it, then chops it into cache
 *   chunks. That is 10-25 seconds before a single row is drawn — and it
 *   happens again every time the cache expires.
 *
 * ── THE FIX ──
 *   Do that work ONCE, nightly, and store the finished JSON as text.
 *   A Google Sheets cell holds 50,000 characters, so ~1.4MB of JSON is about
 *   30 cells. The API then reads 30 cells instead of 334,704.
 *
 *   Same data, same shape, ~1000x less to read.
 *
 * ── AND THE OTHER HALF ──
 *   vtInvalidate() clears every dashboard cache AND marks the read models
 *   stale. Call it from any write path. Without it an edit updates the sheet
 *   but the dashboard keeps serving the old copy until the TTL expires —
 *   which is exactly the "my change did not appear" problem.
 *
 * ── RUN ──
 *   setupAnalyticsBook() once — creates VT_Analytics
 *   buildReadModels()   build them all (already in the 22:00 job)
 *   rmStatus()          sizes, ages, and whether anything is stale
 **********************************************************************/

const RM = {
  BOOK_ID: 'VT_ANALYTICS_BOOK_ID',
  SHEET: 'Read_Models',
  CHUNK: 45000,          // cell limit is 50,000 characters; leave headroom
  STALE_PROP: 'RM_STALE',
};

/**
 * Each spec says: where the data lives, which columns to carry, and what to
 * call the result. Narrow is the point — the floor model carries 9 columns,
 * not 48, so nothing the floor cannot see is ever in its payload.
 */
const RM_SPECS = [
  { name: 'office', book: 'txn', sheet: 'Product_Analytics', key: 'item_code',
    fields: ['item_code', 'product_name', 'category', 'sub_category', 'brand',
  'abc_revenue', 'abc_margin', 'xyz', 'movement',
  'qty_total', 'qty_w', 'qty_wo', 'unit_cost', 'stock_value',
  'units_30d', 'units_90d', 'units_365d', 'avg_daily', 'demand_cv', 'trend',
  'revenue_365d', 'margin_365d', 'margin_pct', 'days_cover', 'turns', 'gmroi',
  'safety_stock', 'reorder_point', 'suggested_order',
  'w_share', 'wo_share', 'last_sale', 'last_purchase',
  'sell_price_w', 'sell_price_wo', 'true_margin_w', 'true_margin_wo',
  /* both ERP opinions of cost and price, so the product card can show them
     side by side and flag where they disagree (VT-024) */
  'sell_master_w', 'sell_master_wo', 'cost_current_w', 'cost_current_wo',
  'cost_frozen', 'cost_source', 'price_gap', 'gst_rate',
  'cost_bill_w', 'cost_bill_wo', 'cost_bill_date', 'landing_w', 'landing_wo',
  'cat_median_margin', 'margin_vs_cat',
  'flags', 'action'] },

  { name: 'floor', book: 'txn', sheet: 'Product_Analytics', key: 'item_code',
    /* must stay in step with FLR_FIELDS in FloorAPI.gs — operational columns
       only. No cost, margin, GMROI or supplier: the floor model is narrow by
       construction, not by filtering. */
    fields: ['item_code', 'product_name', 'category', 'sub_category',
  'brand', 'gst_rate',
  'qty_total', 'sell_price_w', 'sell_price_wo', 'movement', 'last_sale',
  'units_30d', 'units_365d', 'avg_daily', 'days_cover', 'reorder_point',
  'suggested_order', 'xyz', 'trend'] },

  { name: 'pricing', book: 'master', sheet: 'Dash_Data', key: 'item_code',
    fields: null },      // null = every column

  /* VT-026b: the office grid payload, stored EXACTLY as the browser wants it.
     Built once a night, then served as a string with no parse and no
     re-stringify on the way out. Keeps every field — the saving comes from
     not converting the same data three times per request. */
  { name: 'office_raw', book: 'txn', sheet: 'Product_Analytics', key: 'item_code',
    fields: null, raw: true },
];

function rmNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function rmSafe_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (typeof v === 'number') return isFinite(v) ? v : '';
  return String(v);
}

function rmSrc_(spec) {
  /* the registry finds the source wherever it lives — spec.book is only a
     hint for the first look */
  const sh = vtSheet(spec.sheet) ||
    (spec.book === 'txn' ? txnBook_() : SpreadsheetApp.getActiveSpreadsheet())
      .getSheetByName(spec.sheet);
  if (!sh || sh.getLastRow() < 2) return null;
  let hRow = 1;
  for (let r = 1; r <= 6; r++) {
    const v = sh.getRange(r, 1, 1, Math.min(sh.getLastColumn(), 40)).getValues()[0];
    if (v.some(function (x) { return String(x).trim() === spec.key; })) { hRow = r; break; }
  }
  const hdr = sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  const n = sh.getLastRow() - hRow;
  if (n < 1) return null;
  return { H: H, hdr: hdr,
    rows: sh.getRange(hRow + 1, 1, n, sh.getLastColumn()).getValues() };
}

/**
 * Read models live in their OWN workbook.
 *
 * VT_Transactions is at its 10,000,000-cell limit — Sales_Items alone is
 * 5.58M — so inserting another tab there fails outright. This is also the
 * first, safest piece of the workbook split: no transaction data moves, and
 * computed read models are exactly what belongs in an analytics book.
 *
 * Falls back to VT_Transactions if the property is unset, so nothing breaks
 * before setupAnalyticsBook() is run.
 */
function anaBook_() {
  const id = PropertiesService.getScriptProperties().getProperty(RM.BOOK_ID);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* stale id */ }
  }
  return txnBook_();
}

function setupAnalyticsBook() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty(RM.BOOK_ID);
  if (existing) {
    try {
      const ss = SpreadsheetApp.openById(existing);
      const msg = 'Already linked:\n\n' + ss.getName() + '\n' + ss.getUrl();
      Logger.log(msg);
      try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
      return existing;
    } catch (e) { /* stale, make a new one */ }
  }
  const ss = SpreadsheetApp.create('VT_Analytics');
  const first = ss.getSheets()[0];
  first.setName('README');
  first.getRange(1, 1, 8, 1).setValues([
    ['VT_Analytics'],
    [''],
    ['Computed tables and dashboard read models.'],
    ['Nothing here is raw data — every tab is rebuilt from source and can be'],
    ['deleted without loss.'],
    [''],
    ['Read_Models   precomputed JSON the dashboards read instead of scanning'],
    ['              the full tables. ~29 cells instead of 334,704.'],
  ]);
  first.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  props.setProperty(RM.BOOK_ID, ss.getId());
  const msg = 'Created VT_Analytics\n\n' + ss.getUrl() +
    '\n\nVT_Transactions was at its cell limit, so read models live here.\n' +
    'This is the first piece of the workbook split — no data moved.\n\n' +
    'Next: buildReadModels()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return ss.getId();
}

function linkAnalyticsBook(id) {
  if (!id) throw new Error('linkAnalyticsBook("1AbC...")');
  const ss = SpreadsheetApp.openById(String(id).trim());
  PropertiesService.getScriptProperties().setProperty(RM.BOOK_ID, ss.getId());
  try { SpreadsheetApp.getUi().alert('Linked: ' + ss.getName()); } catch (e) {}
}

function rmSheet_() {
  const ss = anaBook_();
  let sh = ss.getSheetByName(RM.SHEET);
  if (!sh) {
    sh = ss.insertSheet(RM.SHEET);
    sh.getRange(1, 1, 1, 5).setValues([['model', 'seq', 'built_at', 'rows', 'chunk']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold')
      .setBackground('#6C6C60').setFontColor('#FFFFFF');
    sh.setColumnWidth(5, 420);
  }
  return sh;
}

/* ---------- build ---------- */

function buildReadModels() {
  const t0 = Date.now();
  const sh = rmSheet_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm');
  const report = [];

  /* keep rows for models we are NOT rebuilding, drop the rest */
  const names = {};
  RM_SPECS.forEach(function (s) { names[s.name] = 1; });
  if (sh.getLastRow() > 1) {
    const old = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
    const keep = old.filter(function (r) { return !names[String(r[0])]; });
    sh.getRange(2, 1, sh.getLastRow() - 1, 5).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, 5).setValues(keep);
  }

  const out = [];
  RM_SPECS.forEach(function (spec) {
    let src;
    try { src = rmSrc_(spec); }
    catch (e) { report.push(spec.name + ': ' + e.message); return; }
    if (!src) { report.push(spec.name + ': source empty, skipped'); return; }

    const fields = spec.fields ||
      src.hdr.map(function (h) { return String(h).trim(); }).filter(Boolean);
    const rows = [];
    src.rows.forEach(function (r) {
      const k = String(r[src.H[spec.key]] || '').trim();
      if (!k) return;
      const o = [];
      fields.forEach(function (f) {
        o.push(src.H[f] === undefined ? '' : rmSafe_(r[src.H[f]]));
      });
      rows.push(o);
    });

    const payload = JSON.stringify(
      spec.raw
        /* the exact object the client receives, so nothing is rebuilt later */
        ? { fields: fields, rows: rows, built: stamp, total: rows.length,
            page: 0, pages: 1 }
        : { fields: fields, rows: rows, built: stamp });
    const parts = Math.ceil(payload.length / RM.CHUNK);
    for (let i = 0; i < parts; i++) {
      out.push([spec.name, i, stamp, rows.length,
        payload.substr(i * RM.CHUNK, RM.CHUNK)]);
    }
    const srcCells = src.rows.length * src.hdr.length;
    report.push(spec.name + ': ' + rows.length + ' rows, ' + fields.length +
      ' fields, ' + parts + ' cells  (was ' + srcCells.toLocaleString() + ' to read)');
  });

  if (out.length) {
    const start = sh.getLastRow() + 1;
    const B = 200;
    for (let i = 0; i < out.length; i += B) {
      const blk = out.slice(i, i + B);
      sh.getRange(start + i, 1, blk.length, 5).setValues(blk);
    }
  }

  PropertiesService.getScriptProperties().deleteProperty(RM.STALE_PROP);
  vtInvalidate();     /* the old cached copies are now wrong */

  const msg = 'READ MODELS BUILT  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    report.join('\n') +
    '\n\nEvery dashboard now reads a handful of cells instead of the whole table.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return out.length;
}

/* ---------- read ---------- */

/**
 * Returns {fields, rows, built} or null if the model has not been built.
 * Callers fall back to reading the source table, so a missing model degrades
 * to "slow" rather than "broken".
 */
function rmRead(name) {
  const ss = anaBook_();
  const sh = ss.getSheetByName(RM.SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  const parts = [];
  v.forEach(function (r) {
    if (String(r[0]) !== name) return;
    parts.push({ seq: Number(r[1]), chunk: String(r[4]) });
  });
  if (!parts.length) return null;
  parts.sort(function (a, b) { return a.seq - b.seq; });
  try { return JSON.parse(parts.map(function (p) { return p.chunk; }).join('')); }
  catch (e) { return null; }
}

/**
 * VT-026b: the stored JSON, returned as a STRING.
 * The caller wraps it in { __raw: … } and doGet splices it straight into the
 * response, so the payload is never parsed and never re-serialised.
 */
function rmRawText(name) {
  const ss = anaBook_();
  const sh = ss.getSheetByName(RM.SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  const parts = [];
  v.forEach(function (r) {
    if (String(r[0]) !== name) return;
    parts.push({ seq: Number(r[1]), chunk: String(r[4]) });
  });
  if (!parts.length) return null;
  parts.sort(function (a, b) { return a.seq - b.seq; });
  return parts.map(function (p) { return p.chunk; }).join('');
}

/* ---------- invalidation ---------- */

/**
 * Clears every dashboard cache. Call from ANY write path — otherwise the
 * sheet changes and the dashboard keeps serving the old copy for an hour.
 * Each clear is wrapped because not every file is present in every project.
 */
function vtInvalidate() {
  const done = [];
  try { ofcClearCache(); done.push('office'); } catch (e) {}
  try { flrClearCache(); done.push('floor'); } catch (e) {}
  try { vsaClearCache(); done.push('solver'); } catch (e) {}
  try { apClearCache_(); done.push('pricing'); } catch (e) {}
  return done;
}

/** Mark the models stale so rmStatus flags them, without rebuilding now. */
function rmMarkStale() {
  PropertiesService.getScriptProperties().setProperty(RM.STALE_PROP,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'));
  vtInvalidate();
}

function rmClear() {
  const sh = rmSheet_();
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 5).clearContent();
  vtInvalidate();
  try { SpreadsheetApp.getUi().alert('Read models cleared. Dashboards will read the ' +
    'source tables until buildReadModels() runs again.'); } catch (e) {}
}

function rmStatus() {
  const sh = rmSheet_();
  if (sh.getLastRow() < 2) {
    try { SpreadsheetApp.getUi().alert('No read models built yet.'); } catch (e) {}
    return;
  }
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  const m = {};
  v.forEach(function (r) {
    const n = String(r[0]);
    if (!m[n]) m[n] = { cells: 0, rows: r[3], built: String(r[2]), chars: 0 };
    m[n].cells++;
    m[n].chars += String(r[4]).length;
  });
  const stale = PropertiesService.getScriptProperties().getProperty(RM.STALE_PROP);
  const msg = 'READ MODELS\n\n' +
    Object.keys(m).sort().map(function (k) {
      return '   ' + k + ': ' + m[k].rows + ' rows in ' + m[k].cells + ' cells  (' +
        Math.round(m[k].chars / 1024) + ' KB)\n      built ' + m[k].built;
    }).join('\n') +
    (stale ? '\n\n⚠ marked stale at ' + stale + ' — run buildReadModels()' :
      '\n\nAll current.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenReadModels() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ Read Models')
    .addItem('Set up VT_Analytics', 'setupAnalyticsBook')
    .addItem('Build now', 'buildReadModels')
    .addItem('Status', 'rmStatus')
    .addItem('Clear', 'rmClear')
    .addToUi();
}