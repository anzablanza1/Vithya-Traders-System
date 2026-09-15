/**********************************************************************
 * VITHYA TRADERS — Dashboard API v2   (price management workspace)
 *
 * Serves the offline VT_Dashboard.html over JSONP. Replaces DashboardAPI.gs.
 *
 * ACTIONS
 *   ping                                       health check
 *   init                                       filter lists + settings
 *   table   &page &size &sort &dir &q &cat...   paged grid rows
 *   product &code                               one product, full detail
 *   save    &edits=<json>                       stage inline edits
 *   bulk    &spec=<json>                        preview or apply a bulk change
 *   pending                                     staged batches awaiting approval
 *   approve &batches=<csv>                      approve
 *   reject  &batches=<csv>                      reject
 *   upload  &batches=<csv>                      generate Vasy upload rows
 *   apply   &batches=<csv>                      write approved into Pricing
 *
 * READS Dash_Data for speed. WRITES go to Pricing (via Change_Queue apply).
 * Rebuild Dash_Data after refreshes: 📊 Dashboard → Rebuild data.
 *
 * SETUP
 *   Script Property  VT_DASH_TOKEN = <your long random string>
 *   Deploy → New deployment → Web app → Execute as Me → Anyone
 *
 * SECURITY: "Anyone" is required because a local HTML file cannot complete a
 * Google login. The token is the only gate — treat it like a password and
 * rotate it by changing VT_DASH_TOKEN.
 **********************************************************************/

const AP = {
  DATA: 'Dash_Data',
  PRICING: 'Pricing',
  QUEUE: 'Change_Queue',
  UPLOAD: 'Vasy_Upload_Queue',
  HISTORY: 'Price_History',
  TOKEN_PROP: 'VT_DASH_TOKEN',
  CACHE: 'vt_tbl_v2',
  CHUNK: 90000,
  TTL: 21600,
  PAGE_MAX: 300,
  MARGIN_FLOOR: 0.12,
};

/* fields sent to the grid, in order */
const AP_FIELDS = ['item_code','description','category','brand','variant_flag',
  'cost_source','gst_rate',
  'cost_w_exGST','cost_w_incGST','cost_wo',
  'transport_w_value','transport_w_type','packing_w_value','packing_w_type',
  'transport_wo_value','transport_wo_type','packing_wo_value','packing_wo_type',
  'wo_rate_increase','wo_price_mode','wo_margin_increase',
  'loaded_cost_w','loaded_cost_wo',
  'selling_w_incGST','selling_w_exGST','selling_wo',
  'true_margin_w','true_margin_wo','vasy_margin_w','vasy_margin_wo',
  'discount_w_pct','discount_wo_pct','mrp_w','mrp_wo',
  'wh_disc_w','wh_disc_wo','rt_disc_w','rt_disc_wo',
  'wh_price_w','wh_price_wo','rt_price_w','rt_price_wo',
  'buy_w_sell_wo','buy_wo_sell_w','cross_gain_w_to_wo','cross_gain_wo_to_w',
  'buy_lane','eff_cost_w','eff_cost_wo','margin_flag','wo_cost_basis',
  'image_url','image_url_2','image_url_3','barcode','short_description','long_description',
  'erp_sell_w','erp_sell_wo','erp_qty_w','erp_qty_wo','last_bill_date'];

/* fields a user may edit inline */
const AP_EDITABLE = {
  'cost_source': 'text', 'buy_lane': 'text', 'gst_rate': 'num',
  'cost_w_exGST': 'num', 'cost_wo': 'num',
  'transport_w_value': 'num', 'transport_w_type': 'text',
  'packing_w_value': 'num', 'packing_w_type': 'text',
  'transport_wo_value': 'num', 'transport_wo_type': 'text',
  'packing_wo_value': 'num', 'packing_wo_type': 'text',
  'wo_rate_increase': 'pct', 'wo_price_mode': 'text', 'wo_margin_increase': 'pct',
  'selling_w_incGST': 'num', 'selling_wo': 'num',
  'true_margin_w': 'pct', 'true_margin_wo': 'pct',
  'discount_w_pct': 'pct', 'discount_wo_pct': 'pct',
  'mrp_w': 'num', 'mrp_wo': 'num',
  'wh_disc_w': 'pct', 'wh_disc_wo': 'pct',
  'rt_disc_w': 'pct', 'rt_disc_wo': 'pct',
};

/* ---------- entry ---------- */

/* ── ONE doGet, TWO apps ──
   Apps Script allows a single doGet per project, but we need both the pricing
   dashboard and the office dashboard. So this routes on ?app=

       ?app=office   -> the office API   (OfficeAPI.gs, returns cost)
       ?app=floor    -> the floor API    (FloorAPI.gs, returns NO cost)
       anything else -> pricing, as before

   Each app keeps its OWN token, so the separation is real: an office token
   cannot read pricing actions and vice versa. */
function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  if (String(p.app || '') === 'office') return doGetOffice(e);
  if (String(p.app || '') === 'floor') return doGetFloor(e);
  /* recon has its own router in ReconAPI.gs and its own (no-token) access —
     it must be handled BEFORE the token check below, or every recon call
     falls through to here and fails with "Bad token". */
  if (String(p.app || '') === 'recon') return doGetRecon(e);
  if (String(p.app || '') === 'inventory') return doGetInventory(e);

  const cb = p.callback || 'callback';
  let body;
  try {
    const want = PropertiesService.getScriptProperties().getProperty(AP.TOKEN_PROP);
    if (!want) throw new Error('Server not configured: set VT_DASH_TOKEN.');
    if (String(p.token || '') !== String(want)) throw new Error('Bad token.');
    let d;
    switch (String(p.action || '')) {
      case 'ping':    d = { ok: true, time: apNow_() }; break;
      case 'init':    d = apInit_(); break;
      case 'table':   d = apTable_(p); break;
      case 'product': d = apProduct_(p.code); break;
      case 'save':    d = apSave_(JSON.parse(p.edits || '[]'), p.by); break;
      case 'bulk':    d = apBulk_(JSON.parse(p.spec || '{}'), p.by); break;
      case 'pending': d = apPending_(); break;
      case 'feed':    d = reviewFeedData(parseInt(p.limit || '200', 10)); break;
      case 'feedact': d = reviewAct(apList_(p.codes), String(p.act || 'ignore'), p.by); break;
      case 'feedbuild': d = { n: buildReviewFeed() }; break;
      case 'undoList': d = { batches: unAppliedBatches_() }; break;
      case 'undo':     d = undoBatch(String(p.batch || ''), p.by); break;
      case 'export':  d = exportPricingXlsx(); break;
      case 'import':  d = importPricingXlsx(String(p.fileId || ''), p.by); break;
      case 'approve': d = apStatus_(apList_(p.batches), 'staged', 'approved', p.by); break;
      case 'reject':  d = apStatus_(apList_(p.batches), 'staged', 'rejected', p.by); break;
      case 'upload':  d = apUpload_(apList_(p.batches)); break;
      case 'apply':   d = apApply_(apList_(p.batches)); break;
      /* the verified-pricing solver */
      case 'vpinit':  d = vsaInit_(); break;
      case 'vprows':  d = vsaRows_(p); break;
      case 'vpsave':  d = vsaSave_(JSON.parse(p.edits || '[]'), p.by); break;
      default: throw new Error('Unknown action: ' + p.action);
    }
    body = { ok: true, data: d };
  } catch (err) {
    body = { ok: false, error: String(err && err.message ? err.message : err) };
  }

  /* VT-026b — skip a whole serialisation pass.
     The big payloads are already JSON: the read model stores them as text and
     we were parsing that into objects only to stringify it straight back. A
     handler can now return { __raw: '<json>' } and we splice the string in,
     which removes both the parse and the stringify for the largest responses.
     Everything else behaves exactly as before. */
  let out;
  if (body.ok && body.data && body.data.__raw) {
    out = cb + '({"ok":true,"data":' + body.data.__raw + '});';
  } else {
    out = cb + '(' + JSON.stringify(body) + ');';
  }
  return ContentService.createTextOutput(out)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* ---------- helpers ---------- */

function apNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
function apSafe_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}
function apNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function apList_(csv) {
  return String(csv || '').split(',').map(s => s.trim()).filter(Boolean);
}
function apNorm_(s) { return String(s || '').toLowerCase().replace(/[\s\*x×\-]+/g, ''); }

function apSheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}
function apHead_(sh, keyCol) {
  let hRow = 1;
  if (keyCol) {
    for (let r = 1; r <= 6; r++) {
      if (String(sh.getRange(r, 1).getValue()).trim() === keyCol) { hRow = r; break; }
    }
  }
  const hdr = sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k) H[k] = i; });
  return { hRow: hRow, hdr: hdr, H: H };
}

/* ---------- cached table snapshot ---------- */

function apClearCache_() {
  const c = CacheService.getScriptCache();
  const meta = c.get(AP.CACHE + '_meta');
  if (!meta) return;
  const n = parseInt(meta, 10), keys = [];
  for (let i = 0; i < n; i++) keys.push(AP.CACHE + '_' + i);
  keys.push(AP.CACHE + '_meta');
  c.removeAll(keys);
}

function apRows_() {
  /* precomputed read model first — a handful of cells instead of the whole
     Dash_Data table. Falls back to the source if it has not been built, so a
     missing model is slow rather than broken. */
  try {
    const rm = rmRead('pricing');
    if (rm && rm.rows && rm.rows.length) {
      const map = {};
      rm.fields.forEach(function (f, i) { map[f] = i; });
      return rm.rows.map(function (r) {
        return AP_FIELDS.map(function (f) {
          return map[f] === undefined ? '' : r[map[f]];
        });
      });
    }
  } catch (e) { /* fall through to the slow path */ }

  const c = CacheService.getScriptCache();
  const meta = c.get(AP.CACHE + '_meta');
  if (meta) {
    const n = parseInt(meta, 10), keys = [];
    for (let i = 0; i < n; i++) keys.push(AP.CACHE + '_' + i);
    const got = c.getAll(keys);
    let s = '', ok = true;
    for (let i = 0; i < n; i++) {
      const part = got[AP.CACHE + '_' + i];
      if (part === null || part === undefined) { ok = false; break; }
      s += part;
    }
    if (ok) { try { return JSON.parse(s); } catch (e) {} }
  }
  const sh = apSheet_(AP.DATA);
  const { H } = apHead_(sh);
  const last = sh.getLastRow();
  if (last < 2) throw new Error('Dash_Data is empty — run Rebuild data.');
  const vals = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  const rows = [];
  vals.forEach(r => {
    const code = String(r[H.item_code] || '').trim();
    if (!code) return;
    const o = [];
    AP_FIELDS.forEach(f => o.push(H[f] === undefined ? '' : apSafe_(r[H[f]])));
    rows.push(o);
  });
  const s = JSON.stringify(rows);
  const parts = Math.ceil(s.length / AP.CHUNK), map = {};
  for (let i = 0; i < parts; i++) map[AP.CACHE + '_' + i] = s.substr(i * AP.CHUNK, AP.CHUNK);
  map[AP.CACHE + '_meta'] = String(parts);
  try { c.putAll(map, AP.TTL); } catch (e) {}
  return rows;
}

const AP_IX = {};
AP_FIELDS.forEach((f, i) => AP_IX[f] = i);

/* ---------- init ---------- */

function apInit_() {
  const rows = apRows_();
  const cat = {}, brand = {}, src = {};
  rows.forEach(r => {
    if (r[AP_IX.category]) cat[r[AP_IX.category]] = 1;
    if (r[AP_IX.brand]) brand[r[AP_IX.brand]] = 1;
    if (r[AP_IX.cost_source]) src[r[AP_IX.cost_source]] = 1;
  });
  return {
    count: rows.length,
    fields: AP_FIELDS,
    editable: AP_EDITABLE,
    categories: Object.keys(cat).sort(),
    brands: Object.keys(brand).sort(),
    sources: Object.keys(src).sort(),
    margin_floor: AP.MARGIN_FLOOR,
  };
}

/* ---------- table ---------- */

function apFilter_(rows, p) {
  const q = apNorm_(p.q || '');
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const cat = p.cat || '', brand = p.brand || '', lane = p.lane || '';
  const flag = p.flag || '', basis = p.basis || '', src = p.src || '';
  return rows.filter(r => {
    if (cat && r[AP_IX.category] !== cat) return false;
    if (brand && r[AP_IX.brand] !== brand) return false;
    if (lane && r[AP_IX.variant_flag] !== lane) return false;
    if (src && r[AP_IX.cost_source] !== src) return false;
    if (basis && r[AP_IX.wo_cost_basis] !== basis) return false;
    if (flag) {
      const f = String(r[AP_IX.margin_flag] || '');
      if (flag === 'ANY' && !f) return false;
      else if (flag !== 'ANY' && f !== flag) return false;
    }
    if (terms.length) {
      const hay = apNorm_(r[AP_IX.item_code]) + apNorm_(r[AP_IX.description]);
      for (let i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
    }
    return true;
  });
}

function apTable_(p) {
  const all = apRows_();
  const f = apFilter_(all, p);

  const sortF = p.sort || '';
  if (sortF && AP_IX[sortF] !== undefined) {
    const i = AP_IX[sortF], dir = (p.dir === 'desc') ? -1 : 1;
    f.sort((a, b) => {
      const x = a[i], y = b[i];
      const nx = Number(x), ny = Number(y);
      const bothNum = isFinite(nx) && isFinite(ny) && x !== '' && y !== '';
      if (bothNum) return (nx - ny) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }

  // aggregate over the whole filtered set, not just the page
  let sumTw = 0, nTw = 0, below = 0, loss = 0;
  f.forEach(r => {
    const t = Number(r[AP_IX.true_margin_w]);
    if (isFinite(t) && r[AP_IX.true_margin_w] !== '') { sumTw += t; nTw++; }
    const fl = String(r[AP_IX.margin_flag] || '');
    if (fl === 'LOSS') loss++;
    else if (fl.indexOf('BELOW') === 0) below++;
  });

  const size = Math.min(parseInt(p.size || '100', 10) || 100, AP.PAGE_MAX);
  const page = Math.max(0, parseInt(p.page || '0', 10) || 0);
  const slice = f.slice(page * size, page * size + size);

  return {
    total: f.length,
    page: page,
    size: size,
    rows: slice,
    stats: {
      avg_true_margin_w: nTw ? sumTw / nTw : '',
      below_floor: below,
      loss: loss,
    },
  };
}

function apProduct_(code) {
  const rows = apRows_();
  const c = String(code || '').trim();
  const r = rows.find(x => String(x[AP_IX.item_code]).trim() === c);
  if (!r) throw new Error('Not found: ' + c);
  const o = {};
  AP_FIELDS.forEach((f, i) => o[f] = r[i]);
  return o;
}

/* ---------- staging edits ---------- */

function apQueue_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(AP.QUEUE);
  if (!sh) {
    sh = ss.insertSheet(AP.QUEUE);
    sh.getRange(1, 1, 1, 15).setValues([['batch_id','staged_at','staged_by','item_code',
      'product_id','lane','field','old_value','new_value','note','status',
      'approved_by','approved_at','uploaded_at','applied_at']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 15).setFontWeight('bold')
      .setBackground('#1F3864').setFontColor('#FFFFFF');
  }
  return sh;
}

function apBatchId_() {
  return 'CHG-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') +
    '-' + Math.floor(Math.random() * 900 + 100);
}

/* edits: [{c:item_code, f:field, o:oldVal, v:newVal}] */
function apSave_(edits, by) {
  if (!edits.length) return { staged: 0, batch_id: '' };
  const sh = apQueue_();
  const bid = apBatchId_();
  const now = apNow_();
  const who = by || 'dashboard';
  const rows = edits.map(e => [bid, now, who, e.c, '', '', e.f,
    e.o === undefined ? '' : e.o, e.v, e.n || '', 'staged', '', '', '', '']);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 15).setValues(rows);
  try { vtInvalidate(); } catch (e) {}

  return { staged: rows.length, batch_id: bid };
}

/* ---------- bulk ---------- */
/* spec: {filter:{...}, field:'selling_w', op:'pct'|'amt'|'set', value:5,
          preview:true|false} */
function apBulk_(spec, by) {
  const all = apRows_();
  const f = apFilter_(all, spec.filter || {});
  const field = spec.field;
  if (!AP_EDITABLE[field]) throw new Error('Field not editable: ' + field);
  const ix = AP_IX[field];
  if (ix === undefined) throw new Error('Unknown field: ' + field);

  const op = spec.op || 'set';
  const val = Number(spec.value);
  const kind = AP_EDITABLE[field];

  const changes = [];
  f.forEach(r => {
    const cur = r[ix];
    const curN = Number(cur);
    let nv;
    if (op === 'set') nv = val;
    else if (op === 'pct') {
      if (!isFinite(curN) || cur === '') return;
      nv = curN * (1 + val / 100);
    } else if (op === 'amt') {
      if (!isFinite(curN) || cur === '') return;
      nv = curN + val;
    } else if (op === 'points') {          // for percentage fields
      if (!isFinite(curN) || cur === '') return;
      nv = curN + val / 100;
    } else return;

    if (kind === 'num') nv = Math.round(nv * 1000) / 1000;
    else if (kind === 'pct') nv = Math.round(nv * 10000) / 10000;

    if (String(nv) === String(cur)) return;
    changes.push({ c: r[AP_IX.item_code], d: r[AP_IX.description],
      o: cur === '' ? '' : cur, v: nv });
  });

  if (spec.preview) {
    return { matched: f.length, changed: changes.length,
      sample: changes.slice(0, 40), field: field };
  }
  if (!changes.length) return { staged: 0, batch_id: '', changed: 0 };

  const sh = apQueue_();
  const bid = apBatchId_();
  const now = apNow_();
  const who = by || 'dashboard';
  const rows = changes.map(c => [bid, now, who, c.c, '', '', field,
    c.o, c.v, spec.note || 'bulk', 'staged', '', '', '', '']);
  // write in blocks so very large bulks do not time out
  const B = 2000;
  for (let i = 0; i < rows.length; i += B) {
    const blk = rows.slice(i, i + B);
    sh.getRange(sh.getLastRow() + 1, 1, blk.length, 15).setValues(blk);
  }
  try { vtInvalidate(); } catch (e) {}

  return { staged: rows.length, batch_id: bid, changed: changes.length };
}

/* ---------- approval ---------- */

function apPending_() {
  const sh = apQueue_();
  if (sh.getLastRow() < 2) return { batches: [], counts: {} };
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 15).getValues();
  const g = {}, counts = {};
  v.forEach(r => {
    const st = String(r[10]);
    counts[st] = (counts[st] || 0) + 1;
    if (st !== 'staged') return;
    const b = String(r[0]);
    if (!g[b]) g[b] = { batch_id: b, at: String(r[1]), by: String(r[2]),
      n: 0, items: {}, fields: {}, sample: [] };
    const x = g[b];
    x.n++;
    x.items[String(r[3])] = 1;
    x.fields[String(r[6])] = 1;
    if (x.sample.length < 8) x.sample.push({ c: String(r[3]), f: String(r[6]),
      o: apSafe_(r[7]), v: apSafe_(r[8]) });
  });
  const batches = Object.keys(g).sort().reverse().map(b => {
    const x = g[b];
    return { batch_id: x.batch_id, at: x.at, by: x.by, changes: x.n,
      products: Object.keys(x.items).length,
      fields: Object.keys(x.fields), sample: x.sample };
  });
  return { batches: batches, counts: counts };
}

function apStatus_(ids, from, to, by) {
  const sh = apQueue_();
  if (sh.getLastRow() < 2) return { n: 0 };
  const rng = sh.getRange(2, 1, sh.getLastRow() - 1, 15);
  const v = rng.getValues();
  const want = {};
  ids.forEach(b => want[b] = 1);
  const all = !ids.length;
  const now = apNow_();
  let n = 0;
  v.forEach(r => {
    if (String(r[10]) === from && (all || want[String(r[0])])) {
      r[10] = to; r[11] = by || 'dashboard'; r[12] = now; n++;
    }
  });
  rng.setValues(v);
  try { vtInvalidate(); } catch (e) {}

  return { n: n };
}

function apUpload_(ids) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = apQueue_();
  if (sh.getLastRow() < 2) return { rows: 0 };
  const rng = sh.getRange(2, 1, sh.getLastRow() - 1, 15);
  const v = rng.getValues();
  const want = {}; ids.forEach(b => want[b] = 1);
  const all = !ids.length;
  const now = apNow_();

  // collect the latest approved value per (item, field)
  const byItem = {};
  const touched = {};
  v.forEach(r => {
    if (String(r[10]) !== 'approved') return;
    const b = String(r[0]);
    if (!all && !want[b]) return;
    const code = String(r[3]);
    if (!byItem[code]) byItem[code] = {};
    byItem[code][String(r[6])] = r[8];
    touched[b] = 1;
  });

  let uq = ss.getSheetByName(AP.UPLOAD);
  if (!uq) {
    uq = ss.insertSheet(AP.UPLOAD);
    uq.getRange(1, 1, 1, 8).setValues([['generated_at','item_code','field',
      'new_value','batch_ids','status','note','uploaded_at']]);
    uq.setFrozenRows(1);
  }
  const out = [];
  Object.keys(byItem).forEach(code => {
    Object.keys(byItem[code]).forEach(fld => {
      out.push([now, code, fld, byItem[code][fld],
        Object.keys(touched).join(' '), 'ready', '', '']);
    });
  });
  if (out.length) uq.getRange(uq.getLastRow() + 1, 1, out.length, 8).setValues(out);

  // mark uploaded
  v.forEach(r => {
    if (String(r[10]) === 'approved' && (all || want[String(r[0])])) {
      r[10] = 'uploaded'; r[13] = now;
    }
  });
  rng.setValues(v);
  return { rows: out.length, batches: Object.keys(touched).length };
}

/* write approved values into the Pricing tab + log history */
function apApply_(ids) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pg = apSheet_(AP.PRICING);
  const ph = apHead_(pg, 'product_id');
  const PH = {};
  Object.keys(ph.H).forEach(k => PH[k] = ph.H[k] + 1);
  const first = ph.hRow + 1;
  const n = pg.getLastRow() - ph.hRow;
  if (n <= 0) throw new Error('Pricing has no data rows.');

  const codes = pg.getRange(first, PH.item_code, n, 1).getValues();
  const rowOf = {};
  codes.forEach((c, i) => { const k = String(c[0] || '').trim(); if (k) rowOf[k] = first + i; });

  const sh = apQueue_();
  const rng = sh.getRange(2, 1, sh.getLastRow() - 1, 15);
  const v = rng.getValues();
  const want = {}; ids.forEach(b => want[b] = 1);
  const all = !ids.length;
  const now = apNow_();

  const hist = [];
  let applied = 0, skipped = 0;
  const touched = {};

  v.forEach(r => {
    const st = String(r[10]);
    if (st !== 'approved' && st !== 'uploaded') return;
    const b = String(r[0]);
    if (!all && !want[b]) return;
    const code = String(r[3]).trim();
    const field = String(r[6]).trim();
    const pr = rowOf[code];
    if (!pr || !PH[field]) { skipped++; return; }
    const before = pg.getRange(pr, PH[field]).getValue();
    const nv = r[8];
    pg.getRange(pr, PH[field]).setValue(nv);
    applied++;
    touched[b] = 1;
    hist.push([now, String(r[2]), code, field, apSafe_(before), apSafe_(nv), b, 'applied']);
  });

  if (hist.length) {
    let hs = ss.getSheetByName(AP.HISTORY);
    if (!hs) {
      hs = ss.insertSheet(AP.HISTORY);
      hs.getRange(1, 1, 1, 8).setValues([['changed_at','by','item_code','field',
        'old_value','new_value','batch_id','note']]);
      hs.setFrozenRows(1);
    }
    hs.getRange(hs.getLastRow() + 1, 1, hist.length, 8).setValues(hist);
  }

  v.forEach(r => {
    const st = String(r[10]);
    if ((st === 'approved' || st === 'uploaded') && touched[String(r[0])]) {
      r[10] = 'applied'; r[14] = now;
    }
  });
  rng.setValues(v);

  apClearCache_();     // Pricing changed — the grid must refetch
  try { vtInvalidate(); } catch (e) {}

  return { applied: applied, skipped: skipped, logged: hist.length,
    batches: Object.keys(touched).length };
}

/* ---------- menu helpers ---------- */

function apShowSetup() {
  const t = PropertiesService.getScriptProperties().getProperty(AP.TOKEN_PROP);
  const url = ScriptApp.getService().getUrl();
  const msg = 'Dashboard API v2\n\nURL:\n' + (url || '(not deployed)') +
    '\n\nToken set: ' + (t ? 'YES' : 'NO') +
    '\n\nPaste both into VT_Dashboard.html on first open.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}
function apClearCacheMenu() {
  apClearCache_();
  try { SpreadsheetApp.getUi().alert('Dashboard cache cleared.'); } catch (e) {}
}
function apSelfTest() {
  const i = apInit_();
  Logger.log('init: ' + i.count + ' products, ' + i.categories.length + ' categories');
  const t = apTable_({ page: '0', size: '20', sort: 'true_margin_w', dir: 'asc' });
  Logger.log('table: ' + t.total + ' matched, ' + t.rows.length + ' returned, ' +
    'avg true margin W ' + (t.stats.avg_true_margin_w * 100).toFixed(1) + '%, ' +
    'below floor ' + t.stats.below_floor + ', loss ' + t.stats.loss);
  const b = apBulk_({ filter: { flag: 'LOSS' }, field: 'selling_w', op: 'pct',
    value: 10, preview: true });
  Logger.log('bulk preview: ' + b.matched + ' matched, ' + b.changed + ' would change');
}