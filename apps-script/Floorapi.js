/**********************************************************************
 * VITHYA TRADERS — FLOOR API
 *
 * Globals declared here (check before pasting):
 *   FLR, FLR_FIELDS, doGetFloor, flrInit_, flrSearch_, flrProduct_,
 *   flrCapture_, flrCaptureList_, flrCounts_, flrCountSubmit_,
 *   flrNum_, flrSafe_, flrRead_, flrCache_, flrClearCache,
 *   flrCaptureSheet_, flrSetup, flrSelfTest, flrCostAudit, onOpenFloor
 *
 * ── WHO THIS IS FOR ──
 *   Counter and godown staff. It answers "do we have it, what does it sell
 *   for", captures what customers asked for that we could not supply, and
 *   hands out stock counts.
 *
 * ── COST IS ABSENT, NOT HIDDEN ──
 *   No cost, margin, supplier or purchase field is in FLR_FIELDS, so none of
 *   them appears in any response. Hiding a column in a browser is not access
 *   control — anyone holding the URL and token can read the raw JSON.
 *   flrCostAudit() checks this mechanically; run it after any change here.
 *
 * ── WHY THE CAPTURE MATTERS MORE THAN THE CATALOGUE ──
 *   Sales data records what we sold. Nothing records what we were asked for
 *   and could not supply. That gap is invisible today and is usually the
 *   largest unmeasured number in a distribution business. Four one-tap
 *   actions start measuring it.
 *
 * ── SETUP ──
 *   1. Script Property  VT_FLOOR_TOKEN = <a third long random string>
 *   2. The shared doGet already routes: ?app=floor -> here
 *   3. Paste the /exec URL and floor token into VT_Floor.html
 *
 * ── ACTIONS ──
 *   ping · init · search · product · capture · captures · counts · countdone
 **********************************************************************/

const FLR = {
  ANALYTICS: 'Product_Analytics',
  TASKS: 'Count_Tasks',
  CAPTURE: 'Customer_Requests',
  MEDIA: 'Media',
  TOKEN_PROP: 'VT_FLOOR_TOKEN',
  CACHE: 'vt_flr_v1',
  CHUNK: 90000,
  TTL: 1800,
  MAX_RESULTS: 40,
};

/* Deliberately narrow. Nothing here reveals cost, margin or supplier. */
/* Deliberately narrow. Velocity, cover and reorder point are here because
   they make a counter person better at the job and reveal NOTHING about what
   we paid or who we bought from. Cost, margin, GMROI and supplier are not. */
const FLR_FIELDS = ['item_code', 'product_name', 'category', 'sub_category',
  'brand', 'gst_rate',
  'qty_total', 'sell_price_w', 'sell_price_wo', 'movement', 'last_sale',
  'units_30d', 'units_365d', 'avg_daily', 'days_cover', 'reorder_point',
  'suggested_order', 'xyz', 'trend'];

/* anything matching this must never appear in a floor response */
const FLR_FORBIDDEN = /cost|margin|gmroi|supplier|purchase|profit|turns|revenue|abc_/i;

const FLR_CAPTURE_COLS = ['logged_at', 'type', 'item_code', 'product_name',
  'free_text', 'qty_wanted', 'customer', 'phone', 'logged_by', 'note', 'status'];

/* ---------- entry ---------- */

function doGetFloor(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const cb = p.callback || 'callback';
  let body;
  try {
    const want = PropertiesService.getScriptProperties().getProperty(FLR.TOKEN_PROP);
    if (!want) throw new Error('Server not configured: set VT_FLOOR_TOKEN.');
    if (String(p.token || '') !== String(want)) throw new Error('Bad token.');
    let d;
    switch (String(p.action || '')) {
      case 'ping':      d = { ok: true, time: new Date().toString() }; break;
      case 'init':      d = flrInit_(); break;
      case 'search':    d = flrSearch_(p.q, p.cat, p.stock); break;
      case 'product':   d = flrProduct_(p.code); break;
      case 'capture':   d = flrCapture_(p); break;
      case 'captures':  d = flrCaptureList_(p.status); break;
      case 'counts':    d = flrCounts_(); break;
      case 'countdone': d = flrCountSubmit_(p.code, p.qty, p.by, p.note); break;
      case 'alerts':    d = flrAlerts_(p.kind, p.cat); break;
      case 'incoming':  d = flrIncoming_(); break;
      /* live stock — the one number that cannot be a day old */
      case 'stock':     d = { map: stockMap(), meta: stockMeta() }; break;
      case 'restock':   d = flrRefreshStock_(); break;
      case 'catalog':   d = flrCatalog_(parseInt(p.page || '0', 10)); break;
      case 'demand':    d = flrDemand_(p.code); break;
      /* quotation — previous rate per customer, beside today's price */
      case 'customers': d = qeCustomers(); break;
      case 'history':   d = qeHistory(p.key, p.q); break;
      case 'historyboth': d = qeHistoryBoth(p.w, p.wo, p.q); break;
      case 'historypair': d = qeHistoryPaired(p.w, p.wo, p.q); break;
      case 'quote':     d = qeQuote(p.key, p.codes); break;
      default: throw new Error('Unknown action: ' + p.action);
    }
    body = { ok: true, data: d };
  } catch (err) {
    body = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(cb + '(' + JSON.stringify(body) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* ---------- helpers ---------- */

function flrNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function flrSafe_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (typeof v === 'number') return isFinite(v) ? v : '';
  return String(v);
}
/* Descriptions are mostly sizes, so punctuation is noise. Strip everything
   but letters and digits on BOTH sides, then require each token as a
   substring in any order — "14 30 45 pel", "35*45" and "14303545" all find
   4 PEL 14*30/35*45 MM COUPLING AQA.
   The old version stripped only * x - / and kept the string glued together,
   so a multi-word query could never match. */
function flrNorm_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function flrTokens_(q) {
  return String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function flrRead_(name, key) {
  const sh = vtSheet(name);
  if (!sh || sh.getLastRow() < 2) return null;
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  if (key && H[key] === undefined) return null;
  return { sh: sh, H: H,
    rows: sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues() };
}

function flrClearCache() {
  const c = CacheService.getScriptCache();
  const meta = c.get(FLR.CACHE + '_meta');
  if (!meta) return;
  const n = parseInt(meta, 10), keys = [];
  for (let i = 0; i < n; i++) keys.push(FLR.CACHE + '_' + i);
  keys.push(FLR.CACHE + '_meta');
  c.removeAll(keys);
}

function flrCache_() {
  /* the floor model carries 9 fields, not 48 — nothing the floor cannot see
     is ever in the payload, by construction rather than by filtering */
  try {
    const rm = rmRead('floor');
    if (rm && rm.rows && rm.rows.length) {
      const map = {};
      rm.fields.forEach(function (f, i) { map[f] = i; });
      return rm.rows.map(function (r) {
        return FLR_FIELDS.map(function (f) {
          return map[f] === undefined ? '' : r[map[f]];
        });
      });
    }
  } catch (e) { /* fall through */ }

  const c = CacheService.getScriptCache();
  const meta = c.get(FLR.CACHE + '_meta');
  if (meta) {
    const n = parseInt(meta, 10), keys = [];
    for (let i = 0; i < n; i++) keys.push(FLR.CACHE + '_' + i);
    const got = c.getAll(keys);
    let s = '', ok = true;
    for (let i = 0; i < n; i++) {
      const part = got[FLR.CACHE + '_' + i];
      if (part === null || part === undefined) { ok = false; break; }
      s += part;
    }
    if (ok) { try { return JSON.parse(s); } catch (e) {} }
  }
  const pa = flrRead_(FLR.ANALYTICS, 'item_code');
  if (!pa) throw new Error('Product data not ready.');
  const rows = [];
  pa.rows.forEach(function (r) {
    const code = String(r[pa.H.item_code] || '').trim();
    if (!code) return;
    const o = [];
    FLR_FIELDS.forEach(function (f) {
      o.push(pa.H[f] === undefined ? '' : flrSafe_(r[pa.H[f]]));
    });
    rows.push(o);
  });
  const s = JSON.stringify(rows);
  const parts = Math.ceil(s.length / FLR.CHUNK), map = {};
  for (let i = 0; i < parts; i++) {
    map[FLR.CACHE + '_' + i] = s.substr(i * FLR.CHUNK, FLR.CHUNK);
  }
  map[FLR.CACHE + '_meta'] = String(parts);
  try { c.putAll(map, FLR.TTL); } catch (e) {}
  return rows;
}

const FLR_IX = {};
FLR_FIELDS.forEach(function (f, i) { FLR_IX[f] = i; });

/* media, kept out of the cache because it is only needed on one product */
function flrMedia_(code) {
  const master = SpreadsheetApp.getActiveSpreadsheet();
  const sh = master.getSheetByName(FLR.MEDIA);
  if (!sh || sh.getLastRow() < 2) return {};
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  if (H.item_code === undefined) return {};
  const n = sh.getLastRow() - 1;
  const found = sh.getRange(2, H.item_code + 1, n, 1)
    .createTextFinder(String(code).trim()).matchEntireCell(true).findNext();
  if (!found) return {};
  const r = sh.getRange(found.getRow(), 1, 1, sh.getLastColumn()).getValues()[0];
  const raw = String(H.image_url !== undefined ? (r[H.image_url] || '') : '');
  const imgs = raw.split(/[\n,;|]+/).map(function (x) { return x.trim(); })
    .filter(Boolean).slice(0, 4);
  return {
    images: imgs,
    short: H.short_description !== undefined ? String(r[H.short_description] || '') : '',
    long: H.long_description !== undefined ? String(r[H.long_description] || '') : '',
    barcode: H.barcode !== undefined ? String(r[H.barcode] || '') : '',
  };
}

/* ---------- catalogue ---------- */

function flrInit_() {
  const rows = flrCache_();
  const cat = {};
  let inStock = 0;
  rows.forEach(function (r) {
    if (r[FLR_IX.category]) cat[r[FLR_IX.category]] = 1;
    if ((flrNum_(r[FLR_IX.qty_total]) || 0) > 0) inStock++;
  });
  return {
    count: rows.length, in_stock: inStock,
    categories: Object.keys(cat).sort(),
  };
}

function flrSearch_(q, cat, stockOnly) {
  const rows = flrCache_();
  const PO = flrPoMap_();
  const terms = flrTokens_(q);
  if (!terms.length && !cat) return { items: [], total: 0 };

  const out = [];
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (cat && r[FLR_IX.category] !== cat) continue;
    const qty = flrNum_(r[FLR_IX.qty_total]) || 0;
    if (String(stockOnly) === '1' && qty <= 0) continue;
    if (terms.length) {
      const hay = flrNorm_(r[FLR_IX.item_code]) + flrNorm_(r[FLR_IX.product_name]) +
        flrNorm_(r[FLR_IX.brand]) + flrNorm_(r[FLR_IX.category]) +
        flrNorm_(r[FLR_IX.sub_category]);
      let ok = true;
      for (let t = 0; t < terms.length; t++) {
        if (hay.indexOf(terms[t]) < 0) { ok = false; break; }
      }
      if (!ok) continue;
    }
    total++;
    if (out.length < FLR.MAX_RESULTS) {
      const po = PO[String(r[FLR_IX.item_code]).trim()] || null;
      out.push({
        code: r[FLR_IX.item_code], name: r[FLR_IX.product_name],
        cat: r[FLR_IX.category], brand: r[FLR_IX.brand],
        /* one number: a counter needs "do we have it", not a lane split */
        qty: qty > 0 ? qty : 0,
        has: qty > 0,
        w: r[FLR_IX.sell_price_w], wo: r[FLR_IX.sell_price_wo],
        cover: flrNum_(r[FLR_IX.days_cover]),
        movement: r[FLR_IX.movement],
        /* quantity and date only — never who it is from or what it cost */
        coming: po ? po.on_order : 0,
        due: po ? po.next_due : '',
      });
    }
  }
  /* in stock first, then by name */
  out.sort(function (a, b) {
    if (a.has !== b.has) return a.has ? -1 : 1;
    return String(a.name).localeCompare(String(b.name));
  });
  return { items: out, total: total };
}

function flrProduct_(code) {
  const rows = flrCache_();
  const c = String(code || '').trim();
  const r = rows.find(function (x) { return String(x[FLR_IX.item_code]).trim() === c; });
  if (!r) throw new Error('Not found: ' + c);
  const qty = flrNum_(r[FLR_IX.qty_total]) || 0;
  const m = flrMedia_(c);

  /* alternatives in the same category that ARE in stock */
  const alts = [];
  if (qty <= 0) {
    const cat = r[FLR_IX.category];
    rows.forEach(function (x) {
      if (alts.length >= 6) return;
      if (x[FLR_IX.category] !== cat) return;
      if (String(x[FLR_IX.item_code]) === c) return;
      if ((flrNum_(x[FLR_IX.qty_total]) || 0) <= 0) return;
      alts.push({ code: x[FLR_IX.item_code], name: x[FLR_IX.product_name],
        qty: flrNum_(x[FLR_IX.qty_total]), w: x[FLR_IX.sell_price_w] });
    });
  }

  let po = null;
  try { po = poStatusFor(c); } catch (e) { po = null; }
  let live = null;
  try { live = stockFor(c); } catch (e) { live = null; }

  return {
    code: r[FLR_IX.item_code], name: r[FLR_IX.product_name],
    cat: r[FLR_IX.category], brand: r[FLR_IX.brand],
    qty: live ? Math.max(0, live.total) : (qty > 0 ? qty : 0),
    has: live ? live.total > 0 : qty > 0,
    raw_qty: live ? live.total : qty,
    qty_w: live ? live.w : '', qty_wo: live ? live.wo : '',
    stock_live: !!live,
    cover: flrNum_(r[FLR_IX.days_cover]),
    movement: r[FLR_IX.movement],
    sold30: flrNum_(r[FLR_IX.units_30d]),
    sold365: flrNum_(r[FLR_IX.units_365d]),
    trend: r[FLR_IX.trend],
    reorder_point: flrNum_(r[FLR_IX.reorder_point]),
    suggested: flrNum_(r[FLR_IX.suggested_order]),
    po: po,
    w: r[FLR_IX.sell_price_w], wo: r[FLR_IX.sell_price_wo],
    gst: flrNum_(r[FLR_IX.gst_rate]),
    sub: r[FLR_IX.sub_category],
    last_sale: r[FLR_IX.last_sale],
    images: m.images || [], short: m.short || '', long: m.long || '',
    barcode: m.barcode || '',
    alternatives: alts,
    demand: flrDemand_(c),
  };
}

/* ---------- customer capture ---------- */

function flrCaptureSheet_() {
  const ss = txnBook_();
  let sh = ss.getSheetByName(FLR.CAPTURE);
  if (!sh) {
    sh = ss.insertSheet(FLR.CAPTURE);
    sh.getRange(1, 1, 1, FLR_CAPTURE_COLS.length).setValues([FLR_CAPTURE_COLS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, FLR_CAPTURE_COLS.length).setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
    sh.setColumnWidth(4, 280);
    sh.setColumnWidth(5, 260);
    sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  return sh;
}

function flrCapture_(p) {
  const type = String(p.type || '').trim();
  const ok = { no_stock: 1, request: 1, enquiry: 1, feedback: 1 };
  if (!ok[type]) throw new Error('type must be no_stock, request, enquiry or feedback');
  const code = String(p.code || '').trim();
  const text = String(p.text || '').trim();
  if (!code && !text) throw new Error('Give a product or describe what was asked for.');

  let name = '';
  if (code) {
    try { name = String(flrProduct_(code).name || ''); } catch (e) {}
  }
  flrCaptureSheet_().appendRow([
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    type, code, name, text,
    flrNum_(p.qty) === '' ? '' : flrNum_(p.qty),
    String(p.customer || '').trim(), String(p.phone || '').trim(),
    String(p.by || '').trim(), String(p.note || '').trim(), 'open',
  ]);
  return { ok: true };
}

function flrCaptureList_(status) {
  const c = flrRead_(FLR.CAPTURE, 'logged_at');
  if (!c) return { items: [], counts: {} };
  const want = String(status || 'open');
  const items = [], counts = {};
  for (let i = c.rows.length - 1; i >= 0; i--) {
    const r = c.rows[i];
    const st = String(r[c.H.status] || 'open').trim();
    counts[st] = (counts[st] || 0) + 1;
    if (want !== 'all' && st !== want) continue;
    if (items.length >= 120) continue;
    items.push({
      at: flrSafe_(r[c.H.logged_at]), type: flrSafe_(r[c.H.type]),
      code: flrSafe_(r[c.H.item_code]), name: flrSafe_(r[c.H.product_name]),
      text: flrSafe_(r[c.H.free_text]), qty: flrNum_(r[c.H.qty_wanted]),
      customer: flrSafe_(r[c.H.customer]), by: flrSafe_(r[c.H.logged_by]),
    });
  }
  return { items: items, counts: counts };
}

/* ---------- counts ---------- */

function flrCounts_() {
  const t = flrRead_(FLR.TASKS, 'item_code');
  if (!t) return { items: [] };
  const items = [];
  t.rows.forEach(function (r) {
    if (String(r[t.H.status] || '').trim() !== 'pending') return;
    if (items.length >= 80) return;
    items.push({
      code: flrSafe_(r[t.H.item_code]), name: flrSafe_(r[t.H.product_name]),
      cat: flrSafe_(r[t.H.category]), reason: flrSafe_(r[t.H.reason]),
      /* the system figure is shown so the counter can see the discrepancy,
         but it is not a cost or margin number */
      system_qty: flrNum_(r[t.H.qty_at_assign]),
    });
  });
  return { items: items };
}

function flrCountSubmit_(code, qty, by, note) {
  const c = String(code || '').trim();
  const q = Number(qty);
  if (!c || !isFinite(q)) throw new Error('Give a product code and a quantity.');
  const res = recordManualCount(c, q, by || 'floor', note || 'counted on the floor');
  return { ok: true, system: res.system, counted: res.counted,
    adjustment: res.adjustment };
}


/* ---------- PO status, quantity and date only ---------- */

/**
 * The PO map, cached per execution. Comes from POBridge, which reads the PO
 * request spreadsheet and drops supplier and every price column before this
 * ever sees it — so there is nothing here to filter out.
 */
var FLR_PO_CACHE = null;
function flrPoMap_() {
  if (FLR_PO_CACHE) return FLR_PO_CACHE;
  try { FLR_PO_CACHE = poStatusMap() || {}; }
  catch (e) { FLR_PO_CACHE = {}; }
  return FLR_PO_CACHE;
}

/** everything currently on its way, soonest first */
function flrIncoming_() {
  const PO = flrPoMap_();
  const rows = flrCache_();
  const name = {};
  rows.forEach(function (r) { name[String(r[FLR_IX.item_code]).trim()] = r; });

  const out = [];
  Object.keys(PO).forEach(function (code) {
    const p = PO[code];
    if (!p.on_order && !p.in_transit) return;
    const r = name[code];
    out.push({
      code: code,
      name: r ? r[FLR_IX.product_name] : code,
      cat: r ? r[FLR_IX.category] : '',
      qty: r ? (flrNum_(r[FLR_IX.qty_total]) || 0) : '',
      coming: p.on_order, transit: p.in_transit,
      due: p.next_due, status: p.po_status, pos: p.po_count,
    });
  });
  out.sort(function (a, b) {
    if (!a.due && !b.due) return b.coming - a.coming;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due < b.due ? -1 : 1;
  });
  return { items: out.slice(0, 200), total: out.length };
}

/* ---------- alerts: the floor's own worklist ---------- */

/**
 * Five things the floor can act on without ever seeing cost.
 * Every row answers "what do I do about this" — request it, or count it.
 */
function flrAlerts_(kind, cat) {
  const rows = flrCache_();
  const PO = flrPoMap_();
  const want = String(kind || 'all');

  const out = { stockout: [], low: [], reorder: [], negative: [], dead: [] };

  rows.forEach(function (r) {
    const code = String(r[FLR_IX.item_code]).trim();
    if (!code) return;
    if (cat && r[FLR_IX.category] !== cat) return;

    const qty = flrNum_(r[FLR_IX.qty_total]);
    const u365 = flrNum_(r[FLR_IX.units_365d]) || 0;
    const u30 = flrNum_(r[FLR_IX.units_30d]) || 0;
    const cover = flrNum_(r[FLR_IX.days_cover]);
    const rop = flrNum_(r[FLR_IX.reorder_point]) || 0;
    const mv = String(r[FLR_IX.movement] || '');
    const po = PO[code] || null;
    const coming = po ? po.on_order : 0;

    const base = {
      code: code, name: r[FLR_IX.product_name], cat: r[FLR_IX.category],
      qty: qty === '' ? 0 : qty, sold30: u30, sold365: u365,
      cover: cover, movement: mv,
      coming: coming, due: po ? po.next_due : '',
      w: r[FLR_IX.sell_price_w],
    };

    /* 1. out of stock but still selling — losing sales right now */
    if (qty <= 0 && qty >= 0 && u365 > 0) {
      out.stockout.push(base);
    }
    /* 2. negative stock — impossible, and only the floor can fix it */
    if (qty < 0) out.negative.push(base);
    /* 3. a fast mover about to run out */
    if (qty > 0 && cover !== '' && cover > 0 && cover < 14 && u365 > 0) {
      out.low.push(base);
    }
    /* 4. below reorder point with nothing on the way */
    if (qty >= 0 && rop > 0 && qty < rop && coming <= 0 && u365 > 0) {
      out.reorder.push(base);
    }
    /* 5. dead stock taking up shelf space */
    if (mv === 'dead' && qty > 0) out.dead.push(base);
  });

  /* most urgent first: what sells most, running out soonest */
  out.stockout.sort(function (a, b) { return b.sold365 - a.sold365; });
  out.low.sort(function (a, b) { return (a.cover || 999) - (b.cover || 999); });
  out.reorder.sort(function (a, b) { return b.sold365 - a.sold365; });
  out.negative.sort(function (a, b) { return a.qty - b.qty; });
  out.dead.sort(function (a, b) { return b.qty - a.qty; });

  const counts = {
    stockout: out.stockout.length, low: out.low.length,
    reorder: out.reorder.length, negative: out.negative.length,
    dead: out.dead.length,
  };
  counts.total = counts.stockout + counts.low + counts.reorder +
    counts.negative + counts.dead;

  if (want !== 'all' && out[want]) {
    return { kind: want, counts: counts, items: out[want].slice(0, 300) };
  }
  return {
    kind: 'all', counts: counts,
    stockout: out.stockout.slice(0, 60), low: out.low.slice(0, 60),
    reorder: out.reorder.slice(0, 60), negative: out.negative.slice(0, 60),
    dead: out.dead.slice(0, 60),
  };
}


/* ---------- the whole catalogue, for instant local search ----------
   The counter cannot wait on a round trip per keystroke. The PO request app
   is fast for exactly one reason: it loads every product once and searches in
   the browser. This does the same.

   6,973 products at ~120 bytes is under a megabyte, so it ships in two or
   three pages and then lives in localStorage. After the first load, typing is
   instant and works even if the connection drops. */
function flrCatalog_(page) {
  const rows = flrCache_();
  const PO = flrPoMap_();
  const LIVE = flrStock_();
  const PAGE = 3000;
  const p = Math.max(0, page || 0);
  const slice = rows.slice(p * PAGE, p * PAGE + PAGE);

  const out = slice.map(function (r) {
    const code = String(r[FLR_IX.item_code]).trim();
    const po = PO[code] || null;
    /* the live figure wins where we have one */
    const live = LIVE[code];
    const q = live ? live.total : flrNum_(r[FLR_IX.qty_total]);
    /* array, not object — a third of the bytes over the wire */
    return [
      code,                                   /* 0 code            */
      r[FLR_IX.product_name],                 /* 1 name            */
      r[FLR_IX.category],                     /* 2 category        */
      r[FLR_IX.sub_category],                 /* 3 subcategory     */
      r[FLR_IX.brand],                        /* 4 brand           */
      q === '' ? 0 : q,                       /* 5 qty             */
      flrNum_(r[FLR_IX.sell_price_w]),        /* 6 selling W incGST*/
      flrNum_(r[FLR_IX.sell_price_wo]),       /* 7 selling WO      */
      flrNum_(r[FLR_IX.gst_rate]),            /* 8 gst %           */
      r[FLR_IX.movement],                     /* 9 movement        */
      flrNum_(r[FLR_IX.days_cover]),          /*10 cover           */
      flrNum_(r[FLR_IX.units_365d]),          /*11 sold 12m        */
      po ? po.on_order : 0,                   /*12 on order        */
      po ? po.next_due : '',                  /*13 due             */
    ];
  });

  let meta = {};
  try { meta = stockMeta() || {}; } catch (e) {}
  return {
    page: p, pages: Math.ceil(rows.length / PAGE), total: rows.length,
    rows: out, stock: meta,
    /* a stamp the client stores; when it changes, the cache is stale */
    version: String(rows.length) + ':' + Object.keys(PO).length,
  };
}

/* ---------- what customers have been asking for ----------
   Sales say what we sold. This says what we were ASKED for — the enquiries,
   the no-stocks, the feedback. Together they justify a PO request with
   evidence rather than a hunch. */
function flrDemand_(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  const cap = flrRead_(FLR.CAPTURE, 'logged_at');
  const out = { no_stock: 0, request: 0, enquiry: 0, feedback: 0,
    qty: 0, items: [], customers: {} };
  if (!cap) return out;
  const H = cap.H;
  cap.rows.forEach(function (r) {
    if (String(r[H.item_code] || '').trim() !== c) return;
    const t = String(r[H.type] || '');
    if (out[t] !== undefined) out[t]++;
    const q = flrNum_(r[H.qty_wanted]);
    if (q) out.qty += q;
    const cust = String(r[H.customer] || '').trim();
    if (cust) out.customers[cust] = (out.customers[cust] || 0) + 1;
    if (out.items.length < 25) {
      out.items.push({
        at: flrSafe_(r[H.logged_at]), type: t,
        qty: q === '' ? '' : q, customer: cust,
        note: String(r[H.note] || ''), by: String(r[H.logged_by] || ''),
      });
    }
  });
  out.items.reverse();
  out.total = out.no_stock + out.request + out.enquiry + out.feedback;
  out.customer_count = Object.keys(out.customers).length;
  return out;
}


/* ---------- live stock ----------
   Product_Analytics carries a stock figure, but it is only as fresh as the
   nightly build. The counter needs the real one, so it is overlaid from
   Stock_Live and the catalogue reports which it used. */
var FLR_STOCK = null;
function flrStock_() {
  if (FLR_STOCK) return FLR_STOCK;
  try {
    const m = stockMap() || {};
    /* A stock table covering a fraction of the catalogue is worse than none:
       every product missing from it would read as "we have the nightly
       figure" while the ones present read as live, and nobody could tell
       which was which. One partial pull already wrote 419 of 13,655. */
    const rows = flrCache_();
    const n = Object.keys(m).length;
    FLR_STOCK = (rows.length && n < rows.length * 0.7) ? {} : m;
    if (!Object.keys(FLR_STOCK).length && n) {
      Logger.log('Stock_Live holds only ' + n + ' of ~' + rows.length +
        ' products — ignoring it and using the nightly figure.');
    }
  } catch (e) { FLR_STOCK = {}; }
  return FLR_STOCK;
}

/** the refresh button. Returns the new figures so the client can redraw. */
function flrRefreshStock_() {
  let n = 0, err = '';
  try { n = pullStockNow(); }
  catch (e) { err = String(e && e.message ? e.message : e); }
  FLR_STOCK = null;
  return { pulled: n, error: err, map: stockMap(), meta: stockMeta() };
}

/* ---------- setup and the security check ---------- */

function flrSetup() {
  const p = PropertiesService.getScriptProperties();
  let tok = p.getProperty(FLR.TOKEN_PROP);
  if (!tok) {
    tok = 'vt-floor-' + Utilities.getUuid();
    p.setProperty(FLR.TOKEN_PROP, tok);
  }
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  const msg = 'FLOOR API\n\nToken:\n' + tok + '\n\nURL:\n' + (url || '(deploy first)') +
    '\n\nThis token returns NO cost, margin or supplier data.\n' +
    'Run flrCostAudit() to verify that mechanically.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/**
 * Checks every field this API can return against the forbidden pattern, and
 * inspects a real response. Run it after ANY change to FLR_FIELDS — the whole
 * point of a separate floor token is that cost cannot leak, and that promise
 * should be tested rather than assumed.
 */
function flrCostAudit() {
  const bad = FLR_FIELDS.filter(function (f) { return FLR_FORBIDDEN.test(f); });
  const rows = flrCache_();
  /* the sample must include a product WITH a PO, or the PO fields go untested */
  let probe = rows.length ? rows[0][FLR_IX.item_code] : '';
  try {
    const PO = flrPoMap_();
    const withPo = Object.keys(PO)[0];
    if (withPo) probe = withPo;
  } catch (e) {}
  const sample = rows.length ? JSON.stringify(flrProduct_(probe)) : '{}';
  const leaked = [];
  ['cost', 'margin', 'gmroi', 'supplier', 'purchase', 'profit', 'abc', 'reorder']
    .forEach(function (w) { if (sample.toLowerCase().indexOf(w) >= 0) leaked.push(w); });

  const msg = 'FLOOR COST AUDIT\n\n' +
    'fields exposed: ' + FLR_FIELDS.length + '\n' +
    '   ' + FLR_FIELDS.join(', ') + '\n\n' +
    'field names matching forbidden pattern: ' + (bad.length ? bad.join(', ') : 'none') + '\n' +
    'forbidden words in a real product response: ' +
    (leaked.length ? leaked.join(', ') + '  ⚠' : 'none') + '\n\n' +
    (bad.length || leaked.length
      ? 'FAIL — a floor user could read cost data. Fix FLR_FIELDS.'
      : 'PASS — no cost, margin or supplier data can reach the floor app.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function flrSelfTest() {
  const i = flrInit_();
  Logger.log('init: ' + i.count + ' products, ' + i.in_stock + ' in stock, ' +
    i.categories.length + ' categories');
  const s = flrSearch_('bearing', '', '');
  Logger.log('search "bearing": ' + s.total + ' matches, showing ' + s.items.length);
  if (s.items.length) {
    const p = flrProduct_(s.items[0].code);
    Logger.log('product ' + p.code + ': qty ' + p.qty + ', W ' + p.w + ', WO ' + p.wo +
      ', images ' + p.images.length + ', alternatives ' + p.alternatives.length);
  }
  const c = flrCounts_();
  Logger.log('counts pending: ' + c.items.length);
  const cap = flrCaptureList_('open');
  Logger.log('open customer requests: ' + cap.items.length);
}

function onOpenFloor() {
  SpreadsheetApp.getUi()
    .createMenu('🏬 Floor API')
    .addItem('Show URL + token', 'flrSetup')
    .addItem('Cost audit', 'flrCostAudit')
    .addItem('Self test', 'flrSelfTest')
    .addItem('Clear cache', 'flrClearCache')
    .addToUi();
}