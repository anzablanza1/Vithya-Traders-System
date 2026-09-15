/**********************************************************************
 * VITHYA TRADERS — QUOTATION ENGINE
 *
 * Globals declared here (check before pasting):
 *   QE, QE_COLS, buildCustomerPrices, qeCustomers, qeSearchCustomers,
 *   qeHistory, qeQuote, quoteEngineStatus, qeNum_, qeDate_, qeKey_,
 *   qeRead_, onOpenQuote
 *
 * ── WHAT THIS SOLVES ──
 *   A customer rings and asks for twelve things. The counter needs to know
 *   what THAT customer paid last time — not the list price — and to send a
 *   quote back in under a minute.
 *
 *   Today that lives in somebody's memory. This puts it on the screen.
 *
 * ── BUILT ON SALES HISTORY, NOT THE CUSTOMER MASTER ──
 *   Every rate a customer has actually paid is already in Sales_Items. So
 *   this needs no new API and works today. The customer master would only
 *   add phone numbers — useful later for WhatsApp, not needed now.
 *
 * ── ONE ROW PER CUSTOMER x PRODUCT ──
 *   Last rate in each lane, when, how many times, and the running total.
 *   Roughly 30–50k rows, which is nothing in its own workbook.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──
 *   It does not write a quote back to Vasy and it does not reserve stock.
 *   A quote is a conversation, not an order. When one is accepted it should
 *   be raised in Vasy like any other sale.
 *
 * ── RUN ──
 *   buildCustomerPrices()   nightly, and on demand
 *   quoteEngineStatus()
 **********************************************************************/

const QE = {
  SHEET: 'Customer_Prices',
  ITEMS: 'Sales_Items',
  MIN_LINES: 1,
};

const QE_COLS = ['party_key', 'customer', 'item_code', 'product_name',
  'last_w_rate', 'last_w_date', 'last_wo_rate', 'last_wo_date',
  'times', 'total_qty', 'last_date', 'last_lane'];

function qeNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }

function qeDate_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : String(v).slice(0, 10);
}

/* the same party key the receivables model uses — a leading dot marks a
   non-GST ledger and must never be merged with its GST twin */
function qeKey_(name) {
  let s = String(name || '').trim();
  if (!s) return '';
  const wo = s.charAt(0) === '.';
  if (wo) s = s.slice(1);
  return (wo ? 'wo:' : 'w:') + s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function qeRead_(name) {
  let d = null;
  try { d = readSalesAcrossYears(name); } catch (e) { d = null; }
  if (d && d.rows && d.rows.length) return d;
  const sh = vtSheet(name);
  if (!sh || sh.getLastRow() < 2) return null;
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  return { H: H, rows: sh.getRange(2, 1, sh.getLastRow() - 1,
    sh.getLastColumn()).getValues() };
}

function qeBook_() {
  try { return anaBook_(); } catch (e) { return txnBook_(); }
}

/* ================= build ================= */

function buildCustomerPrices() {
  const t0 = Date.now();
  const si = qeRead_(QE.ITEMS);
  if (!si) throw new Error('Sales_Items is empty.');
  const H = si.H;

  const agg = {};
  let lines = 0, skipped = 0;

  si.rows.forEach(function (r) {
    const cust = String(r[H.customerName] || '').trim();
    if (!cust) { skipped++; return; }          // walk-in, no history to keep
    const rawCode = String(r[H.itemCode] || '').trim();
    if (!rawCode) return;
    const canon = rawCode.replace(/\/+$/, '');
    const lane = rawCode.slice(-1) === '/' ? 'WO' : 'W';
    const qty = qeNum_(r[H.qty]);
    if (qty <= 0) return;

    /* the rate the customer actually paid, per unit, after discount.
       netAmount is the line total, so this is the only honest unit rate. */
    const net = qeNum_(r[H.netAmount]);
    const rate = Math.round((net / qty) * 100) / 100;
    if (!(rate > 0)) return;

    const date = qeDate_(r[H.salesDate]);
    const pk = qeKey_(cust);
    const k = pk + '|' + canon;

    if (!agg[k]) agg[k] = { pk: pk, cust: cust, code: canon,
      name: String(r[H.productName] || '').replace(/\s*\/$/, ''),
      w: 0, wDate: '', wo: 0, woDate: '',
      times: 0, qty: 0, last: '', lastLane: '' };
    const a = agg[k];
    a.times++;
    a.qty += qty;
    if (!a.name) a.name = String(r[H.productName] || '');

    /* keep the MOST RECENT rate per lane — an old rate is worse than none */
    if (lane === 'WO') {
      if (date >= a.woDate) { a.wo = rate; a.woDate = date; }
    } else {
      if (date >= a.wDate) { a.w = rate; a.wDate = date; }
    }
    if (date >= a.last) { a.last = date; a.lastLane = lane; }
    lines++;
  });

  const rows = Object.keys(agg).map(function (k) {
    const a = agg[k];
    return [a.pk, a.cust, a.code, a.name,
      a.w || '', a.wDate, a.wo || '', a.woDate,
      a.times, Math.round(a.qty * 100) / 100, a.last, a.lastLane];
  }).filter(function (r) { return r[8] >= QE.MIN_LINES; })
    .sort(function (x, y) {
      if (x[0] !== y[0]) return x[0] < y[0] ? -1 : 1;
      return y[10] < x[10] ? -1 : 1;
    });

  const ss = qeBook_();
  let sh = ss.getSheetByName(QE.SHEET);
  if (!sh) sh = ss.insertSheet(QE.SHEET);
  sh.clear();
  if (sh.getMaxColumns() < QE_COLS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), QE_COLS.length - sh.getMaxColumns());
  }
  if (sh.getMaxRows() < rows.length + 10) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length + 10 - sh.getMaxRows());
  }
  sh.getRange(1, 1, 1, QE_COLS.length).setValues([QE_COLS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, QE_COLS.length).setFontWeight('bold')
    .setBackground('#CC3018').setFontColor('#FFFFFF');
  const B = 3000;
  for (let i = 0; i < rows.length; i += B) {
    const blk = rows.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, QE_COLS.length).setValues(blk);
  }

  try { regSet_(REG.MAP, {}); } catch (e) {}
  try { vtInvalidate(); } catch (e) {}

  const custs = {};
  rows.forEach(function (r) { custs[r[0]] = 1; });
  const msg = 'CUSTOMER PRICES BUILT  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'sales lines used : ' + lines.toLocaleString() + '\n' +
    'walk-in skipped  : ' + skipped.toLocaleString() + '   (no customer to remember)\n\n' +
    'customer x product rows: ' + rows.length.toLocaleString() + '\n' +
    'customers with history : ' + Object.keys(custs).length.toLocaleString() + '\n\n' +
    'The rate stored is netAmount / qty — what the customer actually paid\n' +
    'after discount, not the list price.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return rows.length;
}

/* ================= read ================= */

function qeSheet_() {
  let sh = null;
  try { sh = vtSheet(QE.SHEET); } catch (e) {}
  if (!sh) { try { sh = qeBook_().getSheetByName(QE.SHEET); } catch (e) {} }
  return sh;
}

/** every customer who has ever bought, with how much history exists */
/**
 * Every customer, with their two ledgers GROUPED.
 *
 * A firm appears in Vasy twice: "AADHI PUMPS" and ". AADHI PUMPS", the dot
 * marking the non-GST ledger. They are the same customer and searching should
 * find them once — but the ledgers must never be merged, because a quote is
 * either GST or it is not. So: one search result, both keys attached.
 */
function qeCustomers() {
  const sh = qeSheet_();
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, QE_COLS.length).getValues();

  const byLedger = {};
  v.forEach(function (r) {
    const pk = String(r[0] || '');
    if (!pk) return;
    if (!byLedger[pk]) byLedger[pk] = { key: pk, name: String(r[1] || ''),
      lane: pk.indexOf('wo:') === 0 ? 'WO' : 'W', products: 0, last: '' };
    byLedger[pk].products++;
    const d = String(r[10] || '');
    if (d > byLedger[pk].last) byLedger[pk].last = d;
  });

  /* fold the two ledgers of one firm together on the bare name */
  const byFirm = {};
  Object.keys(byLedger).forEach(function (pk) {
    const L = byLedger[pk];
    const bare = pk.replace(/^wo?:/, '').replace(/^w:/, '');
    if (!byFirm[bare]) byFirm[bare] = {
      firm: bare,
      /* show the GST spelling when there is one — the dot is a ledger marker,
         not part of the customer's name */
      name: L.name.replace(/^\.\s*/, ''),
      w: null, wo: null, products: 0, last: '',
    };
    const F = byFirm[bare];
    if (L.lane === 'WO') F.wo = { key: pk, products: L.products, last: L.last };
    else { F.w = { key: pk, products: L.products, last: L.last };
      F.name = L.name; }
    F.products += L.products;
    if (L.last > F.last) F.last = L.last;
  });

  let contacts = {};
  try { contacts = cmByKey() || {}; } catch (e) { contacts = {}; }

  const items = Object.keys(byFirm).map(function (k) {
    const F = byFirm[k];
    const c = contacts[F.w ? F.w.key : (F.wo ? F.wo.key : '')] ||
              contacts[F.wo ? F.wo.key : ''];
    if (c) { F.whatsapp = c.whatsapp || c.mobile || ''; F.city = c.city || ''; }
    F.lanes = (F.w ? 'W' : '') + (F.wo ? (F.w ? '+WO' : 'WO') : '');
    return F;
  }).sort(function (a, b) { return b.last < a.last ? -1 : 1; });

  let withPhone = 0;
  items.forEach(function (x) { if (x.whatsapp) withPhone++; });
  return { items: items, total: items.length, with_phone: withPhone };
}

/** what one customer has bought, most recent first */
/**
 * VT-020: what a firm has bought, with the W and the WO rate on the SAME row.
 *
 * A customer buys the same product on both ledgers at different rates. Two
 * separate lists makes you hold both in your head; one row per product with
 * both rates lets you see the pair and pick.
 */
function qeHistoryPaired(wKey, woKey, q) {
  const w = wKey ? qeHistory(wKey, q) : { items: [], customer: '' };
  const wo = woKey ? qeHistory(woKey, q) : { items: [], customer: '' };
  const by = {};
  const put = function (list, lane) {
    list.items.forEach(function (x) {
      if (!by[x.code]) by[x.code] = { code: x.code, name: x.name,
        w: '', w_date: '', w_times: 0, wo: '', wo_date: '', wo_times: 0,
        last: '', qty: 0 };
      const r = by[x.code];
      /* qeHistory already returns the most recent rate per lane */
      if (lane === 'W') { r.w = x.w || ''; r.w_date = x.w_date; r.w_times = x.times; }
      else { r.wo = x.wo || ''; r.wo_date = x.wo_date; r.wo_times = x.times; }
      r.qty += x.qty || 0;
      if (x.last > r.last) r.last = x.last;
    });
  };
  put(w, 'W'); put(wo, 'WO');
  const items = Object.keys(by).map(function (k) { return by[k]; })
    .sort(function (a, b) { return b.last < a.last ? -1 : 1; });
  return {
    customer: w.customer || wo.customer,
    items: items.slice(0, 400), total: items.length,
    both: items.filter(function (x) { return x.w && x.wo; }).length,
  };
}

/** both ledgers of one firm, each kept separate */
function qeHistoryBoth(wKey, woKey, q) {
  const out = { w: null, wo: null };
  if (wKey) out.w = qeHistory(wKey, q);
  if (woKey) out.wo = qeHistory(woKey, q);
  return out;
}

function qeHistory(partyKey, q) {
  const sh = qeSheet_();
  if (!sh || sh.getLastRow() < 2) return { items: [] };
  const pk = String(partyKey || '').trim();
  const term = String(q || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, QE_COLS.length).getValues();
  const out = [];
  let name = '';
  v.forEach(function (r) {
    if (String(r[0]) !== pk) return;
    name = String(r[1] || '');
    if (term) {
      const hay = (String(r[2]) + String(r[3])).toLowerCase().replace(/[^a-z0-9.]/g, '');
      if (hay.indexOf(term) < 0) return;
    }
    out.push({
      code: String(r[2]), name: String(r[3]),
      w: qeNum_(r[4]) || '', w_date: String(r[5] || ''),
      wo: qeNum_(r[6]) || '', wo_date: String(r[7] || ''),
      times: qeNum_(r[8]), qty: qeNum_(r[9]),
      last: String(r[10] || ''), lane: String(r[11] || ''),
    });
  });
  out.sort(function (a, b) { return b.last < a.last ? -1 : 1; });
  return { customer: name, key: pk, items: out.slice(0, 400), total: out.length };
}

/**
 * A quote line: what this customer paid before, beside what it sells for now.
 * Both are shown — the counter decides, and can see whether they are holding
 * an old price that has since gone underwater.
 */
function qeQuote(partyKey, codes) {
  const list = String(codes || '').split(',').map(function (x) { return x.trim(); })
    .filter(Boolean);
  if (!list.length) return { lines: [] };

  /* their history */
  const hist = {};
  const sh = qeSheet_();
  if (sh && sh.getLastRow() > 1 && partyKey) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, QE_COLS.length).getValues();
    v.forEach(function (r) {
      if (String(r[0]) !== String(partyKey)) return;
      hist[String(r[2])] = { w: qeNum_(r[4]) || '', w_date: String(r[5] || ''),
        wo: qeNum_(r[6]) || '', wo_date: String(r[7] || ''),
        times: qeNum_(r[8]), last: String(r[10] || '') };
    });
  }

  /* today's price and stock, from the floor model — never any cost */
  const now = {};
  try {
    const rows = flrCache_();
    rows.forEach(function (r) {
      const c = String(r[FLR_IX.item_code]).trim();
      if (!c) return;
      now[c] = {
        name: r[FLR_IX.product_name],
        w: flrNum_(r[FLR_IX.sell_price_w]),
        wo: flrNum_(r[FLR_IX.sell_price_wo]),
        gst: flrNum_(r[FLR_IX.gst_rate]),
        qty: flrNum_(r[FLR_IX.qty_total]),
      };
    });
  } catch (e) {}

  const lines = list.map(function (code) {
    const h = hist[code] || null;
    const n = now[code] || {};
    return {
      code: code, name: n.name || code,
      qty_available: n.qty === '' ? 0 : n.qty,
      gst: n.gst || '',
      now_w: n.w || '', now_wo: n.wo || '',
      last_w: h ? h.w : '', last_w_date: h ? h.w_date : '',
      last_wo: h ? h.wo : '', last_wo_date: h ? h.wo_date : '',
      times: h ? h.times : 0, last: h ? h.last : '',
    };
  });
  return { lines: lines };
}

function quoteEngineStatus() {
  const sh = qeSheet_();
  const rows = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  const c = qeCustomers();
  const msg = 'QUOTATION ENGINE\n\n' +
    'customer x product rows: ' + rows.toLocaleString() + '\n' +
    'customers with history : ' + (c.total || 0).toLocaleString() + '\n\n' +
    (rows ? 'Ready. The Quote tab on the floor app reads this.'
          : 'Empty — run buildCustomerPrices().');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenQuote() {
  SpreadsheetApp.getUi()
    .createMenu('💬 Quotes')
    .addItem('Build customer prices', 'buildCustomerPrices')
    .addItem('Status', 'quoteEngineStatus')
    .addToUi();
}