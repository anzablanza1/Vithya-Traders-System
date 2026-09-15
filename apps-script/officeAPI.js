/**********************************************************************
 * VITHYA TRADERS — OFFICE API
 *
 * Globals declared here (check before pasting):
 *   OFC, OFC_FIELDS, doGetOffice, ofcInit_, ofcTable_, ofcActions_,
 *   ofcProduct_, ofcCounts_, ofcCountAction_, ofcSummary_,
 *   ofcNum_, ofcSafe_, ofcRead_, ofcCache_, ofcClearCache, ofcSetup, ofcSelfTest
 *
 * ── WHAT THIS SERVES ──
 *   The office dashboard: the action feed, inventory analysis, product detail
 *   and the stock-count worklist. It reads Product_Analytics — the layer that
 *   already holds ABC, XYZ, movement, cover, GMROI and reorder — so nothing is
 *   recomputed here and every screen agrees with every other.
 *
 * ── SEPARATE FROM THE PRICING API, DELIBERATELY ──
 *   Its own deployment and its own token. Cost IS returned here, because the
 *   office needs it. The floor API, when built, must not return cost fields at
 *   all — absent, not hidden. Hiding a column in a browser is not access control.
 *
 * ── SETUP ──
 *   1. Script Property  VT_OFFICE_TOKEN = <a different long random string>
 *   2. Deploy > New deployment > Web app > Execute as Me > Anyone
 *   3. Paste the /exec URL and token into the office HTML on first open
 *
 *   NOTE this file declares doGetOffice, NOT doGet. Apps Script allows one
 *   doGet per project and the pricing API already owns it. Deploy this from a
 *   SEPARATE Apps Script project bound to the same sheets, or rename whichever
 *   entry point you want this deployment to serve.
 *
 * ── ACTIONS ──
 *   ping · init · summary · actions · table · product · counts · countact
 **********************************************************************/

const OFC = {
  ANALYTICS: 'Product_Analytics',
  TASKS: 'Count_Tasks',
  MONTHLY: 'Sales_Monthly',
  OUTSTANDING: 'Customer_Outstanding',
  TOKEN_PROP: 'VT_OFFICE_TOKEN',
  CACHE: 'vt_ofc_v1',
  CHUNK: 90000,
  TTL: 3600,
  PAGE_MAX: 300,
};

/* what the grid receives — a subset of Product_Analytics, in this order */
const OFC_FIELDS = ['item_code', 'product_name', 'category', 'sub_category', 'brand',
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
  'flags', 'action'];

/* ---------- entry ---------- */

function doGetOffice(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const cb = p.callback || 'callback';
  let body;
  try {
    const want = PropertiesService.getScriptProperties().getProperty(OFC.TOKEN_PROP);
    if (!want) throw new Error('Server not configured: set VT_OFFICE_TOKEN.');
    if (String(p.token || '') !== String(want)) throw new Error('Bad token.');
    let d;
    switch (String(p.action || '')) {
      case 'ping':      d = { ok: true, time: new Date().toString() }; break;
      case 'init':      d = ofcInit_(); break;
      case 'summary':   d = ofcSummary_(); break;
      case 'actions':   d = ofcActions_(parseInt(p.limit || '60', 10), p.scope); break;
      case 'table':     d = ofcTable_(p); break;
      case 'product':   d = ofcProduct_(p.code); break;
      case 'counts':    d = ofcCounts_(p.status); break;
      case 'countact':  d = ofcCountAction_(p.code, p.act, p.note, p.until); break;
      case 'inventory': d = ofcInventory_(); break;
      case 'sales':     d = ofcSales_(p.months); break;
      case 'purchase':  d = ofcPurchase_(); break;
      case 'catalog':   d = ofcCatalog_(parseInt(p.page || '0', 10)); break;
      case 'pricegap':  d = ofcPriceGap_(); break;
      case 'countfind': d = ofcCountFind_(p.q, p.cat, p.brand, p.sub); break;
      case 'digest':    d = ofcDigest_(); break;
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

function ofcNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function ofcSafe_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (typeof v === 'number') return isFinite(v) ? v : '';
  return String(v);
}

function ofcRead_(name, key) {
  /* the registry finds the tab wherever it lives, so moving it between
     workbooks does not break this reader */
  const sh = vtSheet(name) || txnBook_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return null;
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  if (key && H[key] === undefined) return null;
  return { sh: sh, H: H,
    rows: sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues() };
}

/* cached compact rows, so the grid does not re-read the sheet per request */
function ofcClearCache() {
  const c = CacheService.getScriptCache();
  const meta = c.get(OFC.CACHE + '_meta');
  if (!meta) return;
  const n = parseInt(meta, 10), keys = [];
  for (let i = 0; i < n; i++) keys.push(OFC.CACHE + '_' + i);
  keys.push(OFC.CACHE + '_meta');
  c.removeAll(keys);
}

function ofcCache_() {
  /* the precomputed read model is ~25 cells instead of 334,704.
     If it is missing we fall back to the source table, so a model that has
     not been built yet makes this slow, not broken. */
  try {
    const rm = rmRead('office');
    if (rm && rm.rows && rm.rows.length) {
      const map = {};
      rm.fields.forEach(function (f, i) { map[f] = i; });
      return rm.rows.map(function (r) {
        return OFC_FIELDS.map(function (f) {
          return map[f] === undefined ? '' : r[map[f]];
        });
      });
    }
  } catch (e) { /* fall through to the slow path */ }

  const c = CacheService.getScriptCache();
  const meta = c.get(OFC.CACHE + '_meta');
  if (meta) {
    const n = parseInt(meta, 10), keys = [];
    for (let i = 0; i < n; i++) keys.push(OFC.CACHE + '_' + i);
    const got = c.getAll(keys);
    let s = '', ok = true;
    for (let i = 0; i < n; i++) {
      const part = got[OFC.CACHE + '_' + i];
      if (part === null || part === undefined) { ok = false; break; }
      s += part;
    }
    if (ok) { try { return JSON.parse(s); } catch (e) {} }
  }
  const pa = ofcRead_(OFC.ANALYTICS, 'item_code');
  if (!pa) throw new Error('Product_Analytics is empty — build it first.');
  const rows = [];
  pa.rows.forEach(function (r) {
    const code = String(r[pa.H.item_code] || '').trim();
    if (!code) return;
    const o = [];
    OFC_FIELDS.forEach(function (f) {
      o.push(pa.H[f] === undefined ? '' : ofcSafe_(r[pa.H[f]]));
    });
    rows.push(o);
  });
  const s = JSON.stringify(rows);
  const parts = Math.ceil(s.length / OFC.CHUNK), map = {};
  for (let i = 0; i < parts; i++) {
    map[OFC.CACHE + '_' + i] = s.substr(i * OFC.CHUNK, OFC.CHUNK);
  }
  map[OFC.CACHE + '_meta'] = String(parts);
  try { c.putAll(map, OFC.TTL); } catch (e) {}
  return rows;
}

const OFC_IX = {};
OFC_FIELDS.forEach(function (f, i) { OFC_IX[f] = i; });

/* ---------- init ---------- */

function ofcInit_() {
  const rows = ofcCache_();
  const cat = {}, brand = {};
  rows.forEach(function (r) {
    if (r[OFC_IX.category]) cat[r[OFC_IX.category]] = 1;
    if (r[OFC_IX.brand]) brand[r[OFC_IX.brand]] = 1;
  });
  return {
    count: rows.length,
    fields: OFC_FIELDS,
    categories: Object.keys(cat).sort(),
    brands: Object.keys(brand).sort(),
  };
}

/* ---------- the six numbers ---------- */

function ofcSummary_() {
  const rows = ofcCache_();
  let stockVal = 0, posVal = 0, negCount = 0, negVal = 0;
  let dead = 0, deadVal = 0, excess = 0, excessVal = 0;
  let reorder = 0, reorderVal = 0, stockout = 0, belowFloor = 0;
  let loss = 0, checkCost = 0;
  let rev = 0, marg = 0;

  rows.forEach(function (r) {
    const q = ofcNum_(r[OFC_IX.qty_total]) || 0;
    const v = ofcNum_(r[OFC_IX.stock_value]) || 0;
    const mv = String(r[OFC_IX.movement] || '');
    const fl = String(r[OFC_IX.flags] || '');
    stockVal += v;
    if (v > 0) posVal += v;
    if (q < 0) { negCount++; negVal += v; }
    if (mv === 'dead') { dead++; deadVal += v; }
    if (mv === 'excess') { excess++; excessVal += v; }
    const so = ofcNum_(r[OFC_IX.suggested_order]) || 0;
    if (so > 0) { reorder++; reorderVal += so * (ofcNum_(r[OFC_IX.unit_cost]) || 0); }
    if (fl.indexOf('STOCKOUT') >= 0) stockout++;
    if (fl.indexOf('BELOW') >= 0) belowFloor++;
    if (fl.indexOf('CHECK COST') >= 0) checkCost++;
    else if (fl.indexOf('LOSS') >= 0) loss++;
    rev += ofcNum_(r[OFC_IX.revenue_365d]) || 0;
    marg += ofcNum_(r[OFC_IX.margin_365d]) || 0;
  });

  /* count coverage — the honesty gauge */
  let counted = 0, negFixed = 0;
  const t = ofcRead_(OFC.TASKS, 'item_code');
  if (t) {
    const done = {};
    t.rows.forEach(function (r) {
      if (String(r[t.H.status] || '').trim() === 'counted') {
        done[String(r[t.H.item_code]).trim()] = 1;
      }
    });
    rows.forEach(function (r) {
      const c = String(r[OFC_IX.item_code]);
      if (done[c]) {
        counted++;
        if ((ofcNum_(r[OFC_IX.qty_total]) || 0) < 0) negFixed++;
      }
    });
  }

  return {
    products: rows.length,
    stock_value: Math.round(stockVal),
    positive_value: Math.round(posVal),
    negative_count: negCount, negative_value: Math.round(negVal),
    dead: dead, dead_value: Math.round(deadVal),
    excess: excess, excess_value: Math.round(excessVal),
    reorder: reorder, reorder_value: Math.round(reorderVal),
    stockout: stockout, below_floor: belowFloor, loss: loss,
    check_cost: checkCost,
    revenue_365d: Math.round(rev), margin_365d: Math.round(marg),
    margin_pct: rev > 0 ? Math.round(marg / rev * 1000) / 10 : '',
    verified: counted, negative_fixed: negFixed,
  };
}

/* ---------- action feed, ranked by rupee impact ---------- */

/* The feed answers "what do I do today?".
   Rank is derived from the ACTION text, never from flags — deriving it from
   flags let a negative-stock item rank as a loss, so the ladder and the
   instruction disagreed.
   Negative stock and excess are excluded by default: negative stock is the
   counting programme (it has its own worklist) and excess is a periodic
   review. Including them made 5,766 of 6,973 products "actionable", which is
   the same as none of them being actionable. Pass scope=all to see them. */
const OFC_LADDER = [
  /* "verify the cost" is NOT a loss. Every one of these rows compares today's
     selling price against a cost frozen on build day with nothing current
     behind it — the margins are -1.7% to -10%, which is staleness, not
     trading at a loss. Vasy will not accept a selling price below landing
     cost, so a genuine loss should be impossible. Different problem,
     different group, different action. */
  { test: /^verify the cost/, rank: 1, group: 'Cost needs verifying', by: 'revenue' },
  { test: /^reprice/,    rank: 2, group: 'Selling below a current cost', by: 'revenue' },
  { test: /^order now/,  rank: 3, group: 'Out of stock, still selling', by: 'revenue' },
  { test: /^order \d/,   rank: 4, group: 'Below reorder point', by: 'order' },
  { test: /^liquidate/,  rank: 5, group: 'Dead stock', by: 'value' },
  { test: /^review margin/, rank: 6, group: 'Margin below floor', by: 'revenue' },
  { test: /^stop buying/, rank: 7, group: 'Excess stock', by: 'value' },
  { test: /^fix stock/,  rank: 8, group: 'Negative stock', by: 'value' }
];

function ofcActions_(limit, scope) {
  const rows = ofcCache_();
  const wide = String(scope || '') === 'all';
  const out = [];

  rows.forEach(function (r) {
    const act = String(r[OFC_IX.action] || '');
    if (!act) return;
    let hit = null;
    for (let i = 0; i < OFC_LADDER.length; i++) {
      if (OFC_LADDER[i].test.test(act)) { hit = OFC_LADDER[i]; break; }
    }
    if (!hit) return;
    if (!wide && hit.rank >= 6) return;      /* excess + negative are not daily work */

    const v = Math.abs(ofcNum_(r[OFC_IX.stock_value]) || 0);
    const rev = ofcNum_(r[OFC_IX.revenue_365d]) || 0;
    const so = ofcNum_(r[OFC_IX.suggested_order]) || 0;
    const cost = ofcNum_(r[OFC_IX.unit_cost]) || 0;
    const impact = hit.by === 'revenue' ? rev : (hit.by === 'order' ? so * cost : v);

    out.push({
      code: r[OFC_IX.item_code], name: r[OFC_IX.product_name],
      cat: r[OFC_IX.category], abc: r[OFC_IX.abc_revenue],
      xyz: r[OFC_IX.xyz], movement: r[OFC_IX.movement],
      qty: r[OFC_IX.qty_total], value: r[OFC_IX.stock_value],
      action: act, flags: String(r[OFC_IX.flags] || ''),
      rank: hit.rank, group: hit.group, impact: Math.round(impact),
      cover: r[OFC_IX.days_cover], gmroi: r[OFC_IX.gmroi], order: so,
      revenue: Math.round(rev),
    });
  });

  out.sort(function (a, b) { return (a.rank - b.rank) || (b.impact - a.impact); });

  /* group totals for the summary strip */
  const groups = [];
  const seen = {};
  out.forEach(function (x) {
    if (!seen[x.rank]) {
      seen[x.rank] = { rank: x.rank, group: x.group, n: 0, impact: 0 };
      groups.push(seen[x.rank]);
    }
    seen[x.rank].n++;
    seen[x.rank].impact += x.impact;
  });
  groups.forEach(function (g) { g.impact = Math.round(g.impact); });

  return {
    items: out.slice(0, limit || 60),
    total: out.length,
    groups: groups,
    scope: wide ? 'all' : 'today',
  };
}

/* ---------- grid ---------- */

function ofcTable_(p) {
  const rows = ofcCache_();
  const terms = String(p.q || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const f = rows.filter(function (r) {
    if (p.cat && r[OFC_IX.category] !== p.cat) return false;
    if (p.brand && r[OFC_IX.brand] !== p.brand) return false;
    if (p.abc && r[OFC_IX.abc_revenue] !== p.abc) return false;
    if (p.xyz && r[OFC_IX.xyz] !== p.xyz) return false;
    if (p.movement && r[OFC_IX.movement] !== p.movement) return false;
    if (p.flag) {
      const fl = String(r[OFC_IX.flags] || '');
      if (p.flag === 'ANY' ? !fl : fl.indexOf(p.flag) < 0) return false;
    }
    if (terms.length) {
      const hay = (String(r[OFC_IX.item_code]) + String(r[OFC_IX.product_name]))
        .toLowerCase().replace(/[\s\-*]/g, '');
      for (let i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
    }
    return true;
  });

  const sf = p.sort || 'stock_value';
  if (OFC_IX[sf] !== undefined) {
    const i = OFC_IX[sf], dir = (p.dir === 'asc') ? 1 : -1;
    f.sort(function (a, b) {
      const x = a[i], y = b[i];
      const nx = Number(x), ny = Number(y);
      if (isFinite(nx) && isFinite(ny) && x !== '' && y !== '') return (nx - ny) * dir;
      return String(x).localeCompare(String(y)) * dir;
    });
  }

  let val = 0, rev = 0, marg = 0;
  f.forEach(function (r) {
    val += ofcNum_(r[OFC_IX.stock_value]) || 0;
    rev += ofcNum_(r[OFC_IX.revenue_365d]) || 0;
    marg += ofcNum_(r[OFC_IX.margin_365d]) || 0;
  });

  const size = Math.min(parseInt(p.size || '100', 10) || 100, OFC.PAGE_MAX);
  const page = Math.max(0, parseInt(p.page || '0', 10) || 0);
  return {
    total: f.length, page: page, size: size,
    rows: f.slice(page * size, page * size + size),
    stats: {
      stock_value: Math.round(val), revenue: Math.round(rev),
      margin: Math.round(marg),
      margin_pct: rev > 0 ? Math.round(marg / rev * 1000) / 10 : '',
    },
  };
}

function ofcProduct_(code) {
  const rows = ofcCache_();
  const c = String(code || '').trim();
  const r = rows.find(function (x) { return String(x[OFC_IX.item_code]).trim() === c; });
  if (!r) throw new Error('Not found: ' + c);
  const o = {};
  OFC_FIELDS.forEach(function (f, i) { o[f] = r[i]; });

  /* 12-month demand series for the chart */
  o.series = [];
  const m = ofcRead_(OFC.MONTHLY, 'item_code');
  if (m) {
    m.rows.forEach(function (x) {
      if (String(x[m.H.item_code] || '').trim() !== c) return;
      o.series.push({
        month: ofcSafe_(x[m.H.month]),
        qty: ofcNum_(x[m.H.qty]), revenue: ofcNum_(x[m.H.revenue]),
        profit: ofcNum_(x[m.H.profit]),
        w: ofcNum_(x[m.H.w_qty]), wo: ofcNum_(x[m.H.wo_qty]),
      });
    });
    o.series.sort(function (a, b) { return a.month < b.month ? -1 : 1; });
  }
  return o;
}

/* ---------- counts ---------- */

function ofcCounts_(status) {
  const t = ofcRead_(OFC.TASKS, 'item_code');
  if (!t) return { items: [], counts: {} };
  const want = String(status || 'pending');
  const items = [], counts = {};
  t.rows.forEach(function (r) {
    const st = String(r[t.H.status] || '').trim();
    counts[st] = (counts[st] || 0) + 1;
    if (want !== 'all' && st !== want) return;
    items.push({
      batch: ofcSafe_(r[t.H.batch_id]), code: ofcSafe_(r[t.H.item_code]),
      name: ofcSafe_(r[t.H.product_name]), cat: ofcSafe_(r[t.H.category]),
      abc: ofcSafe_(r[t.H.abc]), reason: ofcSafe_(r[t.H.reason]),
      qty: ofcNum_(r[t.H.qty_at_assign]), value: ofcNum_(r[t.H.stock_value]),
      status: st, note: ofcSafe_(r[t.H.status_note]),
      until: ofcSafe_(r[t.H.defer_until]),
      adjustment: ofcNum_(r[t.H.adjustment]),
    });
  });
  return { items: items.slice(0, 400), counts: counts };
}

function ofcCountAction_(code, act, note, until) {
  const a = String(act || '');
  if (a === 'defer') { deferCountTask(code, note || 'deferred from dashboard', until || ''); }
  else if (a === 'block') { blockCountTask(code, note || 'blocked from dashboard'); }
  else if (a === 'batch') { return { assigned: buildCountBatch(50) }; }
  else if (a === 'detect') { return { counted: detectCounts() }; }
  else throw new Error('Unknown count action: ' + a);
  return { ok: true };
}


/* ---------- inventory ---------- */

/**
 * The inventory picture. Negative stock is reported SEPARATELY and never
 * netted against good stock — netting hides Rs 6.3 crore of wrongness behind
 * a plausible-looking total.
 */
function ofcInventory_() {
  const rows = ofcCache_();
  const cats = {}, brands = {}, grid = {}, mv = {};
  let posVal = 0, negVal = 0, negCount = 0;
  let deadVal = 0, excessVal = 0, reorderVal = 0, reorderN = 0;
  const gmroi = [], cover = [];

  rows.forEach(function (r) {
    const v = ofcNum_(r[OFC_IX.stock_value]) || 0;
    const q = ofcNum_(r[OFC_IX.qty_total]) || 0;
    const cat = String(r[OFC_IX.category] || '(none)');
    const br = String(r[OFC_IX.brand] || '(none)');
    const m = String(r[OFC_IX.movement] || '');
    const abc = String(r[OFC_IX.abc_revenue] || '-');
    const xyz = String(r[OFC_IX.xyz] || '-');

    if (q < 0) { negCount++; negVal += v; } else posVal += v;

    if (!cats[cat]) cats[cat] = { value: 0, items: 0, dead: 0, excess: 0, neg: 0 };
    cats[cat].items++;
    if (q >= 0) cats[cat].value += v;
    if (m === 'dead') cats[cat].dead++;
    if (m === 'excess') cats[cat].excess++;
    if (q < 0) cats[cat].neg++;

    if (!brands[br]) brands[br] = { value: 0, items: 0 };
    brands[br].items++;
    if (q >= 0) brands[br].value += v;

    const k = abc + xyz;
    if (!grid[k]) grid[k] = { n: 0, value: 0, revenue: 0 };
    grid[k].n++;
    grid[k].value += (q >= 0 ? v : 0);
    grid[k].revenue += ofcNum_(r[OFC_IX.revenue_365d]) || 0;

    mv[m || '(none)'] = (mv[m || '(none)'] || 0) + 1;
    if (m === 'dead') deadVal += v;
    if (m === 'excess') excessVal += v;

    const so = ofcNum_(r[OFC_IX.suggested_order]) || 0;
    if (so > 0) { reorderN++; reorderVal += so * (ofcNum_(r[OFC_IX.unit_cost]) || 0); }

    const g = ofcNum_(r[OFC_IX.gmroi]);
    if (g !== '' && isFinite(g)) {
      gmroi.push({ code: r[OFC_IX.item_code], name: r[OFC_IX.product_name],
        gmroi: g, value: v, cat: cat });
    }
    const c = ofcNum_(r[OFC_IX.days_cover]);
    if (c !== '' && c > 0 && v > 0) {
      cover.push({ code: r[OFC_IX.item_code], name: r[OFC_IX.product_name],
        cover: c, value: v });
    }
  });

  const top = function (o, n) {
    return Object.keys(o).map(function (k) {
      const x = o[k]; x.name = k; return x;
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, n);
  };

  gmroi.sort(function (a, b) { return b.gmroi - a.gmroi; });
  cover.sort(function (a, b) { return b.cover - a.cover; });

  /* how much stock history exists — the honest gate on turns and fill rate */
  let days = 0, first = '', last = '', anchors = 0;
  try {
    const sh = vtSheet('Stock_History');
    if (sh && sh.getLastRow() > 1) {
      const n = sh.getLastRow() - 1;
      const d = sh.getRange(2, 1, n, 1).getValues();
      const kinds = sh.getRange(2, 7, n, 1).getValues();
      const uniq = {};
      d.forEach(function (x, i) {
        uniq[String(x[0])] = 1;
        if (String(kinds[i][0]) === 'anchor') anchors++;
      });
      const ks = Object.keys(uniq).sort();
      days = ks.length; first = ks[0] || ''; last = ks[ks.length - 1] || '';
    }
  } catch (e) {}

  return {
    stock: { positive: Math.round(posVal), negative: Math.round(negVal),
      negative_count: negCount, net: Math.round(posVal + negVal) },
    dead_value: Math.round(deadVal), excess_value: Math.round(excessVal),
    reorder: reorderN, reorder_value: Math.round(reorderVal),
    movement: mv,
    categories: top(cats, 15), brands: top(brands, 15),
    grid: grid,
    best_gmroi: gmroi.slice(0, 12),
    worst_gmroi: gmroi.filter(function (x) { return x.value > 1000; }).slice(-12).reverse(),
    slowest: cover.slice(0, 12),
    history: { days: days, first: first, last: last, anchors: anchors,
      needed: 90, ready: days >= 90 },
  };
}

/* ---------- sales ---------- */

function ofcSales_(months) {
  const want = Math.max(3, Math.min(24, parseInt(months || '12', 10) || 12));
  const m = ofcRead_(OFC.MONTHLY, 'item_code');
  if (!m) return { months: [], note: 'Sales_Monthly is empty.' };
  const H = m.H;

  const byMonth = {}, byCat = {}, byBrand = {};
  let rev = 0, cogs = 0, profit = 0, wq = 0, woq = 0;

  m.rows.forEach(function (r) {
    const mo = ofcSafe_(r[H.month]);
    if (!mo) return;
    const rv = ofcNum_(r[H.revenue]) || 0;
    const ct = ofcNum_(r[H.cost]) || 0;
    const pf = ofcNum_(r[H.profit]) || 0;
    const q = ofcNum_(r[H.qty]) || 0;
    const cat = String(r[H.category] || '(none)');
    const br = String(r[H.brand] || '(none)');

    if (!byMonth[mo]) byMonth[mo] = { revenue: 0, cost: 0, profit: 0, qty: 0,
      lines: 0, w: 0, wo: 0 };
    const b = byMonth[mo];
    b.revenue += rv; b.cost += ct; b.profit += pf; b.qty += q; b.lines++;
    b.w += ofcNum_(r[H.w_qty]) || 0;
    b.wo += ofcNum_(r[H.wo_qty]) || 0;

    if (!byCat[cat]) byCat[cat] = { revenue: 0, profit: 0, qty: 0 };
    byCat[cat].revenue += rv; byCat[cat].profit += pf; byCat[cat].qty += q;
    if (!byBrand[br]) byBrand[br] = { revenue: 0, profit: 0, qty: 0 };
    byBrand[br].revenue += rv; byBrand[br].profit += pf; byBrand[br].qty += q;

    rev += rv; cogs += ct; profit += pf;
    wq += ofcNum_(r[H.w_qty]) || 0;
    woq += ofcNum_(r[H.wo_qty]) || 0;
  });

  const keys = Object.keys(byMonth).sort().slice(-want);
  const series = keys.map(function (k) {
    const b = byMonth[k];
    return { month: k, revenue: Math.round(b.revenue), profit: Math.round(b.profit),
      qty: Math.round(b.qty), lines: b.lines,
      margin: b.revenue > 0 ? Math.round(b.profit / b.revenue * 1000) / 10 : '',
      w: Math.round(b.w), wo: Math.round(b.wo) };
  });

  /* year on year, same months */
  let yoy = null;
  if (keys.length >= 12) {
    const recent = keys.slice(-6), prior = keys.slice(-18, -12);
    if (prior.length) {
      const sum = function (ks) {
        return ks.reduce(function (s, k) { return s + (byMonth[k] ? byMonth[k].revenue : 0); }, 0);
      };
      const a = sum(prior), b = sum(recent);
      if (a > 0) yoy = { prior: Math.round(a), recent: Math.round(b),
        change: Math.round((b - a) / a * 1000) / 10 };
    }
  }

  const rank = function (o, n) {
    return Object.keys(o).map(function (k) {
      const x = o[k]; x.name = k;
      x.revenue = Math.round(x.revenue); x.profit = Math.round(x.profit);
      x.margin = x.revenue > 0 ? Math.round(x.profit / x.revenue * 1000) / 10 : '';
      return x;
    }).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, n);
  };

  return {
    series: series,
    total: { revenue: Math.round(rev), cost: Math.round(cogs),
      profit: Math.round(profit),
      margin: rev > 0 ? Math.round(profit / rev * 1000) / 10 : '' },
    lanes: { w: Math.round(wq), wo: Math.round(woq),
      w_share: (wq + woq) > 0 ? Math.round(wq / (wq + woq) * 1000) / 10 : '' },
    categories: rank(byCat, 15), brands: rank(byBrand, 15),
    yoy: yoy,
    insight: ofcSalesInsight_(byMonth, keys, byCat),
    yoy_months: ofcYoY_(byMonth),
  };
}


/* ---------- VT-023: what the sales numbers actually say ----------
   Revenue by category is a fact, not an insight. These are the questions a
   monthly review should start from, each with the number that answers it. */
function ofcSalesInsight_(byMonth, keys, byCat) {
  const out = [];
  if (keys.length < 4) return out;

  const rev = keys.map(function (k) { return byMonth[k].revenue; });
  const mar = keys.map(function (k) { return byMonth[k].profit; });

  /* is the margin percentage drifting while revenue looks fine? */
  const half = Math.floor(keys.length / 2);
  const r1 = rev.slice(0, half).reduce(function (a, b) { return a + b; }, 0);
  const r2 = rev.slice(half).reduce(function (a, b) { return a + b; }, 0);
  const m1 = mar.slice(0, half).reduce(function (a, b) { return a + b; }, 0);
  const m2 = mar.slice(half).reduce(function (a, b) { return a + b; }, 0);
  const p1 = r1 > 0 ? m1 / r1 * 100 : 0, p2 = r2 > 0 ? m2 / r2 * 100 : 0;
  if (Math.abs(p2 - p1) >= 1) {
    out.push({
      k: 'Margin is ' + (p2 > p1 ? 'improving' : 'slipping'),
      v: (p2 > p1 ? '+' : '') + Math.round((p2 - p1) * 10) / 10 + ' points',
      s: 'first half ' + Math.round(p1 * 10) / 10 + '% against ' +
         Math.round(p2 * 10) / 10 + '% since — on ' +
         (r2 > r1 ? 'higher' : 'lower') + ' revenue',
      bad: p2 < p1,
    });
  }

  /* how much of the revenue rides on how few categories */
  const cats = Object.keys(byCat).map(function (k) {
    return { name: k, revenue: byCat[k].revenue };
  }).sort(function (a, b) { return b.revenue - a.revenue; });
  const tot = cats.reduce(function (s, c) { return s + c.revenue; }, 0);
  let run = 0, n = 0;
  for (let i = 0; i < cats.length && run < tot * 0.8; i++) { run += cats[i].revenue; n++; }
  if (cats.length) {
    out.push({
      k: 'Concentration',
      v: n + ' of ' + cats.length + ' categories',
      s: 'carry 80% of revenue' +
         (cats[0] ? ' — ' + cats[0].name + ' alone is ' +
          Math.round(cats[0].revenue / tot * 100) + '%' : ''),
      bad: n <= 3,
    });
  }

  /* the best and worst month, so a run of bad ones is visible */
  let best = keys[0], worst = keys[0];
  keys.forEach(function (k) {
    if (byMonth[k].revenue > byMonth[best].revenue) best = k;
    if (byMonth[k].revenue < byMonth[worst].revenue) worst = k;
  });
  out.push({
    k: 'Range',
    v: Math.round(byMonth[best].revenue / Math.max(1, byMonth[worst].revenue) * 10) / 10 + 'x',
    s: 'best month ' + best + ', worst ' + worst +
       ' — that spread is what safety stock has to absorb',
    bad: false,
  });

  /* the last month against the average of the ones before it */
  if (keys.length >= 4) {
    const last = keys[keys.length - 1];
    const prior = keys.slice(0, -1);
    const avg = prior.reduce(function (s, k) { return s + byMonth[k].revenue; }, 0) / prior.length;
    const d = avg > 0 ? (byMonth[last].revenue - avg) / avg * 100 : 0;
    out.push({
      k: 'Latest month',
      v: (d >= 0 ? '+' : '') + Math.round(d) + '%',
      s: last + ' against the average of the ' + prior.length + ' before it' +
         (Math.abs(d) > 25 ? ' — worth checking the month is complete' : ''),
      bad: d < -20,
    });
  }
  return out;
}


/* ---------- VT-023: this year against last, month by month ----------
   A total tells you the direction. The month pairs tell you when it turned,
   which is the only version you can act on. Only months that exist in BOTH
   years are compared — otherwise a partial month reads as a collapse. */
function ofcYoY_(byMonth) {
  const out = [];
  Object.keys(byMonth).sort().forEach(function (k) {
    const y = parseInt(k.slice(0, 4), 10), m = k.slice(5);
    const prevKey = (y - 1) + '-' + m;
    const cur = byMonth[k], prev = byMonth[prevKey];
    if (!prev) return;
    out.push({
      month: k, label: m + ' ' + y,
      now: Math.round(cur.revenue), then: Math.round(prev.revenue),
      change: prev.revenue > 0
        ? Math.round((cur.revenue - prev.revenue) / prev.revenue * 1000) / 10 : '',
      margin_now: cur.revenue > 0 ? Math.round(cur.profit / cur.revenue * 1000) / 10 : '',
      margin_then: prev.revenue > 0 ? Math.round(prev.profit / prev.revenue * 1000) / 10 : '',
      qty_now: Math.round(cur.qty), qty_then: Math.round(prev.qty),
    });
  });
  if (!out.length) return { months: [], note: 'Not enough history yet — ' +
    'year-on-year needs the same month in two years.' };

  const nowT = out.reduce(function (s, x) { return s + x.now; }, 0);
  const thenT = out.reduce(function (s, x) { return s + x.then; }, 0);
  const up = out.filter(function (x) { return x.change !== '' && x.change > 0; }).length;

  return {
    months: out,
    total_now: nowT, total_then: thenT,
    change: thenT > 0 ? Math.round((nowT - thenT) / thenT * 1000) / 10 : '',
    up: up, down: out.length - up,
    /* growth from selling more, or from charging more? */
    qty_change: (function () {
      const qn = out.reduce(function (s, x) { return s + x.qty_now; }, 0);
      const qt = out.reduce(function (s, x) { return s + x.qty_then; }, 0);
      return qt > 0 ? Math.round((qn - qt) / qt * 1000) / 10 : '';
    })(),
  };
}

/* ---------- purchase ---------- */

function ofcPurchase_() {
  let map = {};
  try { map = poStatusMap() || {}; } catch (e) { map = {}; }
  const rows = ofcCache_();
  const meta = {};
  rows.forEach(function (r) { meta[String(r[OFC_IX.item_code]).trim()] = r; });

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const items = [], byStatus = {};
  let onOrder = 0, inTransit = 0, overdue = 0, overdueVal = 0, value = 0;

  Object.keys(map).forEach(function (code) {
    const p = map[code];
    const r = meta[code];
    const cost = r ? (ofcNum_(r[OFC_IX.unit_cost]) || 0) : 0;
    const val = p.on_order * cost;
    onOrder += p.on_order; inTransit += p.in_transit; value += val;
    byStatus[p.po_status || '(none)'] = (byStatus[p.po_status || '(none)'] || 0) + 1;
    const late = p.next_due && p.next_due < today;
    if (late) { overdue++; overdueVal += val; }
    items.push({
      code: code, name: r ? r[OFC_IX.product_name] : code,
      cat: r ? r[OFC_IX.category] : '',
      qty: r ? ofcNum_(r[OFC_IX.qty_total]) : '',
      on_order: p.on_order, in_transit: p.in_transit,
      due: p.next_due, status: p.po_status, pos: p.po_count,
      value: Math.round(val), late: late,
      part_received: p.last_received || '',
      is_new: !!p.is_new,
      cover: r ? ofcNum_(r[OFC_IX.days_cover]) : '',
    });
  });

  items.sort(function (a, b) {
    if (a.late !== b.late) return a.late ? -1 : 1;
    return b.value - a.value;
  });

  return {
    products: items.length,
    on_order: Math.round(onOrder), in_transit: Math.round(inTransit),
    value: Math.round(value),
    overdue: overdue, overdue_value: Math.round(overdueVal),
    by_status: byStatus,
    items: items.slice(0, 250),
  };
}


/* ---------- the whole table, once ----------
   The office was re-querying the server for every filter and sort. Shipping
   the rows once and filtering in the browser makes every interaction
   instant, the same change that fixed the counter. */
/* VT-026: the grid and every drill-down between them use 21 of the 58
   columns. Shipping all 58 made the first load nearly three times heavier
   than it needed to be. The product card still fetches the full row on
   demand, so nothing is lost — it is just not paid for up front. */
const OFC_SLIM = ['item_code', 'product_name', 'category', 'sub_category', 'brand',
  'abc_revenue', 'xyz', 'movement', 'qty_total', 'unit_cost', 'stock_value',
  'units_365d', 'days_cover', 'turns', 'gmroi', 'revenue_365d', 'margin_365d',
  'margin_pct', 'margin_vs_cat', 'price_gap', 'suggested_order', 'flags', 'action'];

function ofcCatalog_(page) {
  /* VT-026b: if the pre-serialised model exists, hand the string straight
     back — doGet splices it in without parsing. All 63 fields, one pass
     instead of three. Falls back to building it the slow way if the model
     has not been rebuilt yet. */
  if (!page) {
    try {
      const raw = rmRawText('office_raw');
      if (raw && raw.length > 100) return { __raw: raw };
    } catch (e) { /* fall through */ }
  }

  const rows = ofcCache_();
  const PAGE = 2500;
  const p = Math.max(0, page || 0);
  const keep = OFC_SLIM.map(function (f) { return OFC_IX[f]; })
    .filter(function (i) { return i !== undefined; });
  const slice = rows.slice(p * PAGE, p * PAGE + PAGE).map(function (r) {
    return keep.map(function (i) { return r[i]; });
  });
  return {
    page: p, pages: Math.ceil(rows.length / PAGE), total: rows.length,
    fields: OFC_SLIM,
    rows: slice,
  };
}


/* ---------- VT-027: where the two cost sources disagree ----------
   price_gap is the difference between the batch cost and the cost the margin
   was actually computed from. A large gap means the margin on screen is
   fiction. Ordered by the revenue riding on it, this IS the verify queue —
   sorted by how much money the answer moves. */
function ofcPriceGap_() {
  const rows = ofcCache_();
  const out = [];
  let exposed = 0;
  rows.forEach(function (r) {
    const gap = ofcNum_(r[OFC_IX.price_gap]);
    if (gap === '' || !isFinite(gap)) return;
    const rev = ofcNum_(r[OFC_IX.revenue_365d]) || 0;
    if (Math.abs(gap) < 5) return;                 // rounding, not a finding
    exposed += rev;
    out.push({
      code: r[OFC_IX.item_code], name: r[OFC_IX.product_name],
      cat: r[OFC_IX.category],
      gap: gap,
      frozen: ofcNum_(r[OFC_IX.cost_frozen]),
      current: ofcNum_(r[OFC_IX.cost_current_w]),
      source: r[OFC_IX.cost_source],
      revenue: rev,
      margin: ofcNum_(r[OFC_IX.margin_pct]),
      /* what the margin would be if the batch cost is the true one */
      at_risk: Math.round(rev * Math.abs(gap) / 100),
    });
  });
  /* biggest money first, not biggest percentage — a 90% gap on a product
     that sells nothing is not where to start */
  out.sort(function (a, b) { return b.at_risk - a.at_risk; });
  return {
    items: out.slice(0, 300), total: out.length,
    revenue_exposed: Math.round(exposed),
    at_risk_total: Math.round(out.reduce(function (s, x) { return s + x.at_risk; }, 0)),
  };
}

/* ---------- VT-025: find anything to count ---------- */
function ofcCountFind_(q, cat, brand, sub) {
  const rows = ofcCache_();
  const terms = String(q || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  rows.forEach(function (r) {
    if (cat && r[OFC_IX.category] !== cat) return;
    if (brand && r[OFC_IX.brand] !== brand) return;
    if (sub && r[OFC_IX.sub_category] !== sub) return;
    if (terms.length) {
      const hay = (String(r[OFC_IX.item_code]) + String(r[OFC_IX.product_name]) +
        String(r[OFC_IX.brand])).toLowerCase().replace(/[^a-z0-9]/g, '');
      for (let i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return;
    } else if (!cat && !brand && !sub) return;
    out.push({
      code: r[OFC_IX.item_code], name: r[OFC_IX.product_name],
      cat: r[OFC_IX.category], brand: r[OFC_IX.brand],
      qty: ofcNum_(r[OFC_IX.qty_total]),
      value: ofcNum_(r[OFC_IX.stock_value]),
      movement: r[OFC_IX.movement],
      last_sale: r[OFC_IX.last_sale],
    });
  });
  out.sort(function (a, b) { return (b.value || 0) - (a.value || 0); });
  return { items: out.slice(0, 300), total: out.length };
}

/* ---------- VT-030: what changed since yesterday ---------- */
function ofcDigest_() {
  const rows = ofcCache_();
  const today = {};
  rows.forEach(function (r) {
    const c = String(r[OFC_IX.item_code] || '');
    if (!c) return;
    today[c] = {
      flags: String(r[OFC_IX.flags] || ''),
      qty: ofcNum_(r[OFC_IX.qty_total]) || 0,
      name: r[OFC_IX.product_name],
      rev: ofcNum_(r[OFC_IX.revenue_365d]) || 0,
    };
  });

  let prev = null;
  try {
    const sh = vtSheet('Digest_Snapshot');
    if (sh && sh.getLastRow() > 1) {
      prev = {};
      sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
        if (r[0]) prev[String(r[0])] = { flags: String(r[1] || ''), qty: ofcNum_(r[2]) || 0 };
      });
    }
  } catch (e) { prev = null; }

  const newStockout = [], newLoss = [], recovered = [], newNegative = [];
  if (prev) {
    Object.keys(today).forEach(function (c) {
      const t = today[c], p = prev[c];
      if (!p) return;
      const was = function (f) { return p.flags.indexOf(f) >= 0; };
      const is = function (f) { return t.flags.indexOf(f) >= 0; };
      if (is('STOCKOUT') && !was('STOCKOUT')) newStockout.push({ code: c, name: t.name, rev: t.rev });
      if (!is('STOCKOUT') && was('STOCKOUT')) recovered.push({ code: c, name: t.name, rev: t.rev });
      if ((is('LOSS') || is('CHECK COST')) && !(was('LOSS') || was('CHECK COST'))) {
        newLoss.push({ code: c, name: t.name, rev: t.rev });
      }
      if (t.qty < 0 && p.qty >= 0) newNegative.push({ code: c, name: t.name, qty: t.qty });
    });
  }
  const byRev = function (a, b) { return (b.rev || 0) - (a.rev || 0); };
  newStockout.sort(byRev); newLoss.sort(byRev); recovered.sort(byRev);

  return {
    first_run: !prev,
    new_stockout: newStockout.slice(0, 20), new_stockout_n: newStockout.length,
    recovered: recovered.slice(0, 20), recovered_n: recovered.length,
    new_cost_flag: newLoss.slice(0, 20), new_cost_flag_n: newLoss.length,
    new_negative: newNegative.slice(0, 20), new_negative_n: newNegative.length,
  };
}

/** stores today's state so tomorrow has something to compare against */
function snapshotDigest() {
  const rows = ofcCache_();
  const out = rows.map(function (r) {
    return [r[OFC_IX.item_code], r[OFC_IX.flags], ofcNum_(r[OFC_IX.qty_total]) || 0];
  }).filter(function (r) { return r[0]; });
  const ss = (function () { try { return anaBook_(); } catch (e) { return txnBook_(); } })();
  let sh = ss.getSheetByName('Digest_Snapshot');
  if (!sh) sh = ss.insertSheet('Digest_Snapshot');
  sh.clear();
  sh.getRange(1, 1, 1, 3).setValues([['item_code', 'flags', 'qty']]);
  if (sh.getMaxRows() < out.length + 5) {
    sh.insertRowsAfter(sh.getMaxRows(), out.length + 5 - sh.getMaxRows());
  }
  if (out.length) sh.getRange(2, 1, out.length, 3).setValues(out);
  return out.length;
}

/* ---------- setup helpers ---------- */

function ofcSetup() {
  const p = PropertiesService.getScriptProperties();
  let tok = p.getProperty(OFC.TOKEN_PROP);
  if (!tok) {
    tok = 'vt-office-' + Utilities.getUuid();
    p.setProperty(OFC.TOKEN_PROP, tok);
  }
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) {}
  const msg = 'OFFICE API\n\nToken:\n' + tok + '\n\nURL:\n' + (url || '(deploy first)') +
    '\n\nPaste both into the office dashboard on first open.\n\n' +
    'This token is separate from the pricing one on purpose — the office API\n' +
    'returns cost, and the floor API must not.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function ofcSelfTest() {
  const i = ofcInit_();
  Logger.log('init: ' + i.count + ' products, ' + i.categories.length + ' categories');
  const s = ofcSummary_();
  Logger.log('summary: stock Rs ' + s.stock_value.toLocaleString('en-IN') +
    ', dead ' + s.dead + ', excess ' + s.excess + ', reorder ' + s.reorder +
    ', negative ' + s.negative_count);
  const a = ofcActions_(5);
  Logger.log('actions today: ' + a.total);
  a.groups.forEach(function (g) {
    Logger.log('   ' + g.rank + '. ' + g.group + ': ' + g.n +
      '  (Rs ' + g.impact.toLocaleString('en-IN') + ')');
  });
  Logger.log('   top 5:');
  a.items.forEach(function (x) {
    Logger.log('      [' + x.rank + '] ' + x.code + '  ' + x.action +
      '   Rs ' + x.impact.toLocaleString('en-IN'));
  });
  const aw = ofcActions_(1, 'all');
  Logger.log('actions all (incl excess + negative): ' + aw.total);
  const t = ofcTable_({ page: '0', size: '5', sort: 'stock_value' });
  Logger.log('table: ' + t.total + ' rows, stock Rs ' +
    t.stats.stock_value.toLocaleString('en-IN'));
  const c = ofcCounts_('pending');
  Logger.log('counts pending: ' + c.items.length);
}

function onOpenOffice() {
  SpreadsheetApp.getUi()
    .createMenu('🏢 Office API')
    .addItem('Show URL + token', 'ofcSetup')
    .addItem('Self test', 'ofcSelfTest')
    .addItem('Clear cache', 'ofcClearCache')
    .addToUi();
}