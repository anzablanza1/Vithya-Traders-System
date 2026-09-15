/**********************************************************************
 * VITHYA TRADERS — VERIFIED PRICING API
 *
 * Globals declared here (check before pasting):
 *   VSA, VSA_OUT, vsaRoute, vsaRows_, vsaSave_, vsaInit_,
 *   vsaNum_, vsaSafe_, vsaRead_, vsaCache_, vsaClearCache, vsaSelfTest
 *
 * ── WHAT THIS SERVES ──
 *   The Solver tab in the pricing dashboard. It reads Verified_Pricing as
 *   PAIRS — one W row and one WO row per product — so the dashboard can show
 *   them side by side, stacked, or either lane alone, the same way the main
 *   grid already does.
 *
 * ── WHY THE SOLVER MATHS IS NOT HERE ──
 *   It is arithmetic on numbers the browser already holds. Doing it client
 *   side means a slider recomputes instantly instead of waiting on a round
 *   trip. The server only reads and writes.
 *
 * ── WIRING ──
 *   In DashboardAPI_v2.gs, inside doGet's switch, add:
 *       case 'vprows': d = vsaRows_(p); break;
 *       case 'vpsave': d = vsaSave_(JSON.parse(p.edits || '[]'), p.by); break;
 *       case 'vpinit': d = vsaInit_(); break;
 *   or simply call vsaRoute(p) from the default branch.
 **********************************************************************/

const VSA = {
  SHEET: 'Verified_Pricing',
  LOG: 'Verify_Log',
  HDR_ROW: 2,
  CACHE: 'vt_vsa_v1',
  CHUNK: 90000,
  TTL: 900,
  PAGE_MAX: 400,
};

/* what a solver row carries. Inputs are editable; the rest is reference. */
const VSA_OUT = ['item_code', 'lane', 'description', 'category', 'brand', 'gst_rate',
  'erp_batch_rate', 'erp_batch_landing', 'erp_current_rate', 'erp_current_landing',
  'erp_selling', 'erp_mrp',
  'cost_value', 'cost_mode', 'cost_trust', 'cost_source',
  'transport_value', 'transport_type', 'transport_trust',
  'packing_value', 'packing_type', 'packing_trust',
  'selling_value', 'selling_mode', 'selling_trust',
  'mrp_disc', 'wh_disc', 'rt_disc', 'row_trust', 'notes'];

/* only these may be written back */
const VSA_WRITABLE = ['cost_value', 'cost_mode', 'cost_trust', 'cost_source',
  'transport_value', 'transport_type', 'transport_trust',
  'packing_value', 'packing_type', 'packing_trust',
  'selling_value', 'selling_mode', 'selling_trust',
  'mrp_disc', 'wh_disc', 'rt_disc', 'notes'];

function vsaNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function vsaSafe_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (typeof v === 'number') return isFinite(v) ? v : '';
  return String(v);
}

function vsaRead_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(VSA.SHEET);
  if (!sh || sh.getLastRow() <= VSA.HDR_ROW) {
    throw new Error('Verified_Pricing is empty — run buildVerifiedRows() first.');
  }
  const hdr = sh.getRange(VSA.HDR_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  return { sh: sh, H: H,
    rows: sh.getRange(VSA.HDR_ROW + 1, 1, sh.getLastRow() - VSA.HDR_ROW,
      sh.getLastColumn()).getValues() };
}

function vsaClearCache() {
  const c = CacheService.getScriptCache();
  const meta = c.get(VSA.CACHE + '_meta');
  if (!meta) return;
  const n = parseInt(meta, 10), keys = [];
  for (let i = 0; i < n; i++) keys.push(VSA.CACHE + '_' + i);
  keys.push(VSA.CACHE + '_meta');
  c.removeAll(keys);
}

/* pairs: one object per product holding its W row and its WO row */
function vsaCache_() {
  const c = CacheService.getScriptCache();
  const meta = c.get(VSA.CACHE + '_meta');
  if (meta) {
    const n = parseInt(meta, 10), keys = [];
    for (let i = 0; i < n; i++) keys.push(VSA.CACHE + '_' + i);
    const got = c.getAll(keys);
    let s = '', ok = true;
    for (let i = 0; i < n; i++) {
      const part = got[VSA.CACHE + '_' + i];
      if (part === null || part === undefined) { ok = false; break; }
      s += part;
    }
    if (ok) { try { return JSON.parse(s); } catch (e) {} }
  }
  const d = vsaRead_();
  const byCode = {}, order = [];
  d.rows.forEach(function (r, i) {
    const code = String(r[d.H.item_code] || '').trim();
    if (!code) return;
    const lane = String(r[d.H.lane] || '').trim();
    const o = [];
    VSA_OUT.forEach(function (f) {
      o.push(d.H[f] === undefined ? '' : vsaSafe_(r[d.H[f]]));
    });
    o.push(i);                                  // sheet row offset, for saving
    if (!byCode[code]) { byCode[code] = { code: code, W: null, WO: null }; order.push(code); }
    byCode[code][lane === 'WO' ? 'WO' : 'W'] = o;
  });
  const out = order.map(function (k) { return byCode[k]; });
  const s = JSON.stringify(out);
  const parts = Math.ceil(s.length / VSA.CHUNK), map = {};
  for (let i = 0; i < parts; i++) {
    map[VSA.CACHE + '_' + i] = s.substr(i * VSA.CHUNK, VSA.CHUNK);
  }
  map[VSA.CACHE + '_meta'] = String(parts);
  try { c.putAll(map, VSA.TTL); } catch (e) {}
  return out;
}

const VSA_IX = {};
VSA_OUT.forEach(function (f, i) { VSA_IX[f] = i; });

/* ---------- init ---------- */

function vsaInit_() {
  const pairs = vsaCache_();
  const cat = {}, brand = {}, trust = {};
  pairs.forEach(function (p) {
    ['W', 'WO'].forEach(function (l) {
      const r = p[l];
      if (!r) return;
      if (r[VSA_IX.category]) cat[r[VSA_IX.category]] = 1;
      if (r[VSA_IX.brand]) brand[r[VSA_IX.brand]] = 1;
      const t = r[VSA_IX.row_trust] || 'unverified';
      trust[t] = (trust[t] || 0) + 1;
    });
  });
  return { products: pairs.length, fields: VSA_OUT,
    categories: Object.keys(cat).sort(), brands: Object.keys(brand).sort(),
    trust: trust };
}

/* ---------- rows ---------- */

function vsaRows_(p) {
  const pairs = vsaCache_();
  const q = String(p.q || '').toLowerCase().replace(/[\s\-*\/]/g, '');
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];

  const hit = pairs.filter(function (x) {
    const r = x.W || x.WO;
    if (!r) return false;
    if (p.cat && r[VSA_IX.category] !== p.cat) return false;
    if (p.brand && r[VSA_IX.brand] !== p.brand) return false;
    if (p.trust) {
      const a = (x.W && x.W[VSA_IX.row_trust]) || '';
      const b = (x.WO && x.WO[VSA_IX.row_trust]) || '';
      if (a !== p.trust && b !== p.trust) return false;
    }
    if (String(p.nocost) === '1') {
      const a = x.W && x.W[VSA_IX.cost_value];
      const b = x.WO && x.WO[VSA_IX.cost_value];
      if (a !== '' || b !== '') return false;      // keep only the untouched
    }
    if (terms.length) {
      const hay = (String(r[VSA_IX.item_code]) + String(r[VSA_IX.description]))
        .toLowerCase().replace(/[\s\-*\/]/g, '');
      for (let i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
    }
    return true;
  });

  const size = Math.min(parseInt(p.size || '150', 10) || 150, VSA.PAGE_MAX);
  const page = Math.max(0, parseInt(p.page || '0', 10) || 0);
  return { total: hit.length, page: page, size: size,
    rows: hit.slice(page * size, page * size + size) };
}

/* ---------- save ---------- */

/**
 * edits: [{code, lane, field, value}]
 * Only VSA_WRITABLE fields are accepted — a computed column cannot be written
 * even if the client sends one.
 */
function vsaSave_(edits, by) {
  if (!edits || !edits.length) return { saved: 0 };
  const d = vsaRead_();
  const who = String(by || Session.getActiveUser().getEmail() || 'dashboard').split('@')[0];
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  /* index the sheet once */
  const idx = {};
  d.rows.forEach(function (r, i) {
    idx[String(r[d.H.item_code]).trim() + '|' + String(r[d.H.lane]).trim()] = i;
  });

  const log = [];
  let saved = 0, rejected = 0;
  edits.forEach(function (e) {
    const f = String(e.field || '');
    if (VSA_WRITABLE.indexOf(f) < 0) { rejected++; return; }
    if (d.H[f] === undefined) { rejected++; return; }
    const k = String(e.code).trim() + '|' + String(e.lane).trim();
    const i = idx[k];
    if (i === undefined) { rejected++; return; }
    const rowNo = VSA.HDR_ROW + 1 + i;
    const old = d.rows[i][d.H[f]];
    d.sh.getRange(rowNo, d.H[f] + 1).setValue(e.value);
    /* stamp the date when cost is newly marked verified */
    if (f === 'cost_trust' && String(e.value) === 'verified' &&
        d.H.cost_date !== undefined && !d.rows[i][d.H.cost_date]) {
      d.sh.getRange(rowNo, d.H.cost_date + 1).setValue(today);
    }
    log.push([stamp, e.code, e.lane, f, vsaSafe_(old), vsaSafe_(e.value),
      '', '', who, 'dashboard']);
    saved++;
  });

  if (log.length) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let ls = ss.getSheetByName(VSA.LOG);
    if (!ls) {
      ls = ss.insertSheet(VSA.LOG);
      ls.getRange(1, 1, 1, 10).setValues([['at', 'item_code', 'lane', 'field',
        'old_value', 'new_value', 'trust', 'source', 'by', 'from_file']]);
      ls.setFrozenRows(1);
      ls.getRange(1, 1, 1, 10).setFontWeight('bold')
        .setBackground('#6C6C60').setFontColor('#FFFFFF');
    }
    ls.getRange(ls.getLastRow() + 1, 1, log.length, 10).setValues(log);
  }

  /* an edit must invalidate the cache immediately, or the dashboard keeps
     serving the old copy until the TTL expires — which is exactly the
     "my change did not appear" problem */
  vsaClearCache();
  return { saved: saved, rejected: rejected };
}

/* ---------- router, for the shared doGet ---------- */

function vsaRoute(p) {
  switch (String(p.action || '')) {
    case 'vpinit': return vsaInit_();
    case 'vprows': return vsaRows_(p);
    case 'vpsave': return vsaSave_(JSON.parse(p.edits || '[]'), p.by);
    default: return null;
  }
}

function vsaSelfTest() {
  const i = vsaInit_();
  Logger.log('products: ' + i.products + '  categories: ' + i.categories.length);
  Logger.log('trust: ' + JSON.stringify(i.trust));
  const r = vsaRows_({ page: '0', size: '3' });
  Logger.log('rows: ' + r.total + ' total, showing ' + r.rows.length);
  if (r.rows.length) {
    const p = r.rows[0];
    Logger.log('  ' + p.code + '  W=' + (p.W ? 'yes' : 'no') + '  WO=' + (p.WO ? 'yes' : 'no'));
    if (p.W) {
      Logger.log('    W cost=' + p.W[VSA_IX.cost_value] +
        '  batch rate=' + p.W[VSA_IX.erp_batch_rate] +
        '  batch landing=' + p.W[VSA_IX.erp_batch_landing] +
        '  trust=' + p.W[VSA_IX.row_trust]);
    }
  }
}