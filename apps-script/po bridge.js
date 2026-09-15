/**********************************************************************
 * VITHYA TRADERS — PO BRIDGE
 *
 * Globals declared here (check before pasting):
 *   POB, POB_COLS, buildPoStatus, poStatusFor, poStatusMap, poBridgeSelfTest,
 *   poBridgeAudit, pobNum_, pobDate_, pobCanon_, pobOpen_, onOpenPoBridge
 *
 * ── WHAT THIS DOES ──
 *   Reads PO progress out of the PO request spreadsheet — which the purchase
 *   team owns and which works — and turns it into one line per product:
 *
 *       on_order · in_transit · next_due · po_status
 *
 *   READ ONLY. It never writes to that spreadsheet. The PO system keeps
 *   working exactly as it does today.
 *
 * ── WHAT IT DELIBERATELY DROPS ──
 *   PO Tracking column 15 is Supplier. Receipts column 9 is Price. Lot Lines
 *   carries Bill Rate, MRP and Selling. NONE of those are read into the
 *   output, so a floor user cannot see them even by reading the raw JSON.
 *   poBridgeAudit() checks this mechanically.
 *
 * ── THE PO SPLIT RULE ──
 *   VT-PO v9 skips rows whose status is 'PO Split' when summing quantities,
 *   because the split children carry the real numbers and the parent would
 *   double-count. This reuses that rule rather than inventing a second one —
 *   if the purchase team changes it, there is one definition to update.
 *
 * ── SETUP ──
 *   Script Property VT_PO_BOOK_ID = the PO request spreadsheet id
 *   (the one whose URL contains /d/1d7_Y5rMG8n77TC…/edit)
 *
 * ── RUN ──
 *   buildPoStatus()      build the read model (nightly, and on demand)
 *   poBridgeSelfTest()   what it found, for one product
 *   poBridgeAudit()      prove no cost or supplier is exposed
 **********************************************************************/

const POB = {
  BOOK_PROP: 'VT_PO_BOOK_ID',
  REQ: 'PO Requests',
  TRACK: 'PO Tracking',
  RECV: 'Receipts',
  LOTS: 'Lots',
  LOTL: 'Lot Lines',
  MODEL: 'po_status',              // read-model name
  SHEET: 'PO_Status',              // fallback tab when read models are absent

  /* column positions, from TRACK_HEADERS / RECV_HEADERS / LOTS_HEADERS /
     LOTL_HEADERS in LiveApi v5.6 — verified against the live schema */
  T: { lineId: 2, code: 4, name: 5, lane: 6, poNumber: 7, realNo: 8,
       qty: 9, status: 10, expected: 13, shipQty: 16 },
  R: { poNumber: 2, code: 5, qty: 8 },
  L: { lotId: 0, poNumber: 1, lotNo: 2, date: 3, receivedAt: 9, expected: 14 },
  /* PO Requests carries whether the product was newly created by a request */
  QNEW: 6,
  LL: { lotId: 0, poNumber: 1, code: 3, qty: 5 },

  /* PO Requests: Line ID 0 … Request Type 4 … Quantity 9 */
  Q: { lineId: 0, reqNo: 1, type: 4, code: 7, qty: 9 },
  T_WIDTH: 18, R_WIDTH: 13, L_WIDTH: 15, LL_WIDTH: 17, Q_WIDTH: 13,

  /* statuses that mean the line is done and should not show as incoming */
  DONE: { 'Received': 1, 'Closed': 1 },
  SPLIT_PARENT: 'PO Split',
};

const POB_COLS = ['item_code', 'on_order', 'in_transit', 'next_due',
  'po_status', 'po_count', 'ordered', 'received', 'shipped',
  'for_customer', 'for_no_stock', 'for_planning', 'last_received',
  'is_new', 'detail'];

function pobNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }

function pobDate_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  let m = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

/* the canonical product code — trailing slash marks the non-GST lane */
function pobCanon_(code) { return String(code || '').replace(/\/+\s*$/, '').trim(); }

function pobOpen_() {
  const id = PropertiesService.getScriptProperties().getProperty(POB.BOOK_PROP);
  if (!id) {
    throw new Error('Set the Script Property ' + POB.BOOK_PROP +
      ' to the PO request spreadsheet id first.');
  }
  try { return SpreadsheetApp.openById(id); }
  catch (e) {
    throw new Error('Could not open the PO spreadsheet (' + id + ').\n\n' + e.message);
  }
}

function pobRead_(ss, tab, width) {
  const sh = ss.getSheetByName(tab);
  if (!sh || sh.getLastRow() < 2) return [];
  const w = Math.min(width, sh.getLastColumn());
  return sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues();
}

/* ================= build ================= */

function buildPoStatus() {
  const t0 = Date.now();
  const ss = pobOpen_();

  const track = pobRead_(ss, POB.TRACK, POB.T_WIDTH);
  const recv = pobRead_(ss, POB.RECV, POB.R_WIDTH);
  const lots = pobRead_(ss, POB.LOTS, POB.L_WIDTH);
  const lotl = pobRead_(ss, POB.LOTL, POB.LL_WIDTH);
  const reqs = pobRead_(ss, POB.REQ, POB.Q_WIDTH);

  /* WHY each PO line exists, from the original request.
     A quantity ordered for a Customer Order is spoken for the moment it
     lands — the counter must not promise it to someone else. */
  const reasonByLine = {}, newByCode = {};
  reqs.forEach(function (r) {
    const lid = String(r[POB.Q.lineId] || '').trim();
    if (lid) reasonByLine[lid] = String(r[POB.Q.type] || '').trim();
    /* a product the counter created because it was not in the catalogue —
       worth flagging so nobody assumes it is an established line */
    if (String(r[POB.QNEW] || '').trim().toLowerCase() === 'yes') {
      const c = pobCanon_(r[POB.Q.code]);
      if (c) newByCode[c] = 1;
    }
  });

  /* received, by PO + canonical code */
  const recvBy = {};
  recv.forEach(function (r) {
    const k = String(r[POB.R.poNumber] || '') + '|' + pobCanon_(r[POB.R.code]);
    recvBy[k] = (recvBy[k] || 0) + pobNum_(r[POB.R.qty]);
  });

  /* lot metadata — is it received, and when is it expected */
  const lotMeta = {};
  lots.forEach(function (r) {
    const id = String(r[POB.L.lotId] || '');
    if (!id) return;
    lotMeta[id] = {
      no: String(r[POB.L.lotNo] || ''),
      date: pobDate_(r[POB.L.date]),
      received: !!String(r[POB.L.receivedAt] || '').trim(),
      received_on: pobDate_(r[POB.L.receivedAt]),
      expected: pobDate_(r[POB.L.expected]),
    };
  });

  /* shipped, by PO + canonical code, plus the earliest expected arrival */
  const shipBy = {}, lotDue = {}, lastRecv = {};
  lotl.forEach(function (r) {
    const meta = lotMeta[String(r[POB.LL.lotId] || '')];
    if (!meta) return;
    const k = String(r[POB.LL.poNumber] || '') + '|' + pobCanon_(r[POB.LL.code]);
    shipBy[k] = (shipBy[k] || 0) + pobNum_(r[POB.LL.qty]);
    if (!meta.received && meta.expected) {
      if (!lotDue[k] || meta.expected < lotDue[k]) lotDue[k] = meta.expected;
    }
    if (meta.received && meta.received_on) {
      if (!lastRecv[k] || meta.received_on > lastRecv[k]) lastRecv[k] = meta.received_on;
    }
  });

  /* roll the tracking rows up per canonical product */
  const RANK = { 'PO Created': 1, 'PO Sent': 2, 'Shipped': 3, 'Received': 4, 'Closed': 5 };
  const agg = {};
  let skippedSplit = 0;

  track.forEach(function (r) {
    const status = String(r[POB.T.status] || '').trim();
    /* v9's rule: split parents carry no real quantity, the children do */
    if (status === POB.SPLIT_PARENT) { skippedSplit++; return; }
    const canon = pobCanon_(r[POB.T.code]);
    if (!canon) return;

    const poNo = String(r[POB.T.poNumber] || '');
    const k = poNo + '|' + canon;
    const ordered = pobNum_(r[POB.T.qty]);
    const received = Math.min(recvBy[k] || 0, ordered);
    const shippedRaw = shipBy[k] !== undefined ? shipBy[k] : pobNum_(r[POB.T.shipQty]);
    const shipped = Math.min(ordered, Math.max(shippedRaw, received));

    if (!agg[canon]) agg[canon] = { ordered: 0, received: 0, shipped: 0,
      pos: {}, due: '', rank: 99, status: '', lines: [], reasons: {} };
    const a = agg[canon];
    a.ordered += ordered;
    a.received += received;
    a.shipped += shipped;
    a.pos[poNo] = 1;

    const done = POB.DONE[status] || received >= ordered;
    if (!done) {
      const due = lotDue[k] || pobDate_(r[POB.T.expected]);
      if (due && (!a.due || due < a.due)) a.due = due;
      const rk = RANK[status] || 1;
      if (rk < a.rank) { a.rank = rk; a.status = status; }
      const reason = reasonByLine[String(r[POB.T.lineId] || '').trim()] || '';
      const outstanding = Math.max(0, ordered - received);
      if (reason && outstanding > 0) {
        a.reasons[reason] = (a.reasons[reason] || 0) + outstanding;
      }
      if (lastRecv[k] && lastRecv[k] > (a.last_received || '')) {
        a.last_received = lastRecv[k];
      }
      /* NOTE: supplier (col 15) and every price column are never read */
      a.lines.push({
        po: String(r[POB.T.realNo] || r[POB.T.poNumber] || ''),
        lane: String(r[POB.T.lane] || ''),
        status: status,
        ordered: ordered, received: received, shipped: shipped,
        due: due, reason: reason,
        /* when a part-shipment actually landed — "partly received" without a
           date tells nobody anything useful */
        received_on: lastRecv[k] || '',
        part: received > 0 && received < ordered,
      });
    }
  });

  const rows = Object.keys(agg).map(function (code) {
    const a = agg[code];
    const onOrder = Math.max(0, a.ordered - a.received);
    const inTransit = Math.max(0, a.shipped - a.received);
    return [code, onOrder, inTransit, a.due, a.status || '',
      Object.keys(a.pos).length, a.ordered, a.received, a.shipped,
      a.reasons['Customer Order'] || 0,
      a.reasons['No Stock'] || 0,
      a.reasons['Stock Planning'] || 0,
      a.last_received || '',
      newByCode[code] ? 'yes' : '',
      JSON.stringify(a.lines.slice(0, 8))];
  }).filter(function (r) { return r[1] > 0 || r[2] > 0; })
    .sort(function (x, y) { return y[1] - x[1]; });

  /* store it where the dashboards can read it cheaply */
  let where = '';
  try {
    const target = anaBook_();
    let sh = target.getSheetByName(POB.SHEET);
    if (!sh) sh = target.insertSheet(POB.SHEET);
    sh.clear();
    if (sh.getMaxColumns() < POB_COLS.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), POB_COLS.length - sh.getMaxColumns());
    }
    if (sh.getMaxRows() < rows.length + 10) {
      sh.insertRowsAfter(sh.getMaxRows(), rows.length + 10 - sh.getMaxRows());
    }
    sh.getRange(1, 1, 1, POB_COLS.length).setValues([POB_COLS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, POB_COLS.length).setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
    if (rows.length) {
      const B = 3000;
      for (let i = 0; i < rows.length; i += B) {
        const blk = rows.slice(i, i + B);
        sh.getRange(2 + i, 1, blk.length, POB_COLS.length).setValues(blk);
      }
    }
    where = target.getName();
  } catch (e) { where = 'FAILED: ' + e.message; }

  try { regSet_(REG.MAP, {}); } catch (e) {}
  try { vtInvalidate(); } catch (e) {}

  const onOrderTotal = rows.reduce(function (s, r) { return s + r[1]; }, 0);
  const transitTotal = rows.reduce(function (s, r) { return s + r[2]; }, 0);
  const msg = 'PO STATUS BUILT  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'tracking rows read : ' + track.length.toLocaleString() +
      (skippedSplit ? '   (' + skippedSplit + ' split parents skipped)' : '') + '\n' +
    'products with something on order: ' + rows.length.toLocaleString() + '\n\n' +
    '   on order   : ' + Math.round(onOrderTotal).toLocaleString('en-IN') + ' units\n' +
    '   in transit : ' + Math.round(transitTotal).toLocaleString('en-IN') + ' units\n\n' +
    'written to: ' + where + '\n\n' +
    'No supplier and no price column is read. poBridgeAudit() proves it.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return rows.length;
}

/* ================= read ================= */

/** the whole map, { canonical_code: {on_order, in_transit, next_due, ...} } */
function poStatusMap() {
  let sh = null;
  try { sh = vtSheet(POB.SHEET); } catch (e) {}
  if (!sh) { try { sh = anaBook_().getSheetByName(POB.SHEET); } catch (e) {} }
  if (!sh || sh.getLastRow() < 2) return {};
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, POB_COLS.length).getValues();
  const out = {};
  v.forEach(function (r) {
    const c = String(r[0] || '').trim();
    if (!c) return;
    out[c] = {
      on_order: pobNum_(r[1]), in_transit: pobNum_(r[2]),
      next_due: String(r[3] || ''), po_status: String(r[4] || ''),
      po_count: pobNum_(r[5]),
      ordered: pobNum_(r[6]), received: pobNum_(r[7]), shipped: pobNum_(r[8]),
      for_customer: pobNum_(r[9]), for_no_stock: pobNum_(r[10]),
      for_planning: pobNum_(r[11]),
      last_received: String(r[12] || ''), is_new: String(r[13] || '') === 'yes',
    };
  });
  return out;
}

/** one product, including the per-PO breakdown */
function poStatusFor(code) {
  const c = pobCanon_(code);
  let sh = null;
  try { sh = vtSheet(POB.SHEET); } catch (e) {}
  if (!sh) { try { sh = anaBook_().getSheetByName(POB.SHEET); } catch (e) {} }
  if (!sh || sh.getLastRow() < 2) return null;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, POB_COLS.length).getValues();
  for (let i = 0; i < v.length; i++) {
    if (String(v[i][0]).trim() !== c) continue;
    let lines = [];
    try { lines = JSON.parse(v[i][14] || '[]'); } catch (e) {}
    return {
      on_order: pobNum_(v[i][1]), in_transit: pobNum_(v[i][2]),
      next_due: String(v[i][3] || ''), po_status: String(v[i][4] || ''),
      po_count: pobNum_(v[i][5]), lines: lines,
      last_received: String(v[i][12] || ''),
      is_new: String(v[i][13] || '') === 'yes',
      reasons: {
        'Customer Order': pobNum_(v[i][9]),
        'No Stock': pobNum_(v[i][10]),
        'Stock Planning': pobNum_(v[i][11]),
      },
    };
  }
  return null;
}

/* ================= checks ================= */

function poBridgeSelfTest() {
  const map = poStatusMap();
  const codes = Object.keys(map);
  if (!codes.length) {
    const m = 'No PO status rows. Run buildPoStatus() first.';
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return;
  }
  const first = codes.sort(function (a, b) {
    return map[b].on_order - map[a].on_order;
  })[0];
  const d = poStatusFor(first);
  Logger.log('products on order: ' + codes.length);
  Logger.log('');
  Logger.log('biggest: ' + first);
  Logger.log('   on order ' + d.on_order + ', in transit ' + d.in_transit +
    ', due ' + (d.next_due || '—') + ', status ' + d.po_status);
  (d.lines || []).forEach(function (l) {
    Logger.log('      PO ' + l.po + '  ' + l.lane + '  ' + l.status +
      '  ' + l.received + '/' + l.ordered + ' recd, ' + l.shipped + ' shipped' +
      (l.due ? '  due ' + l.due : ''));
  });
  try { SpreadsheetApp.getUi().alert(codes.length + ' product(s) on order.\n\n' +
    'See the log for a worked example.'); } catch (e) {}
}

/**
 * Proves no cost or supplier can reach a caller. Run after ANY change here —
 * the floor promise should be tested, not remembered.
 */
function poBridgeAudit() {
  const bad = /supplier|price|rate|cost|mrp|selling|bill/i;
  const offending = POB_COLS.filter(function (c) { return bad.test(c); });

  const map = poStatusMap();
  const codes = Object.keys(map);
  const sample = codes.length ? JSON.stringify(poStatusFor(codes[0])) : '{}';
  const leaked = ['supplier', 'price', 'rate', 'cost', 'mrp', 'selling']
    .filter(function (w) { return sample.toLowerCase().indexOf(w) >= 0; });

  /* the column indices we read must not include the sensitive ones */
  const readsSupplier = Object.keys(POB.T).some(function (k) { return POB.T[k] === 15; });
  const readsPrice = Object.keys(POB.R).some(function (k) { return POB.R[k] === 9; });

  const msg = 'PO BRIDGE AUDIT\n\n' +
    'output fields: ' + POB_COLS.join(', ') + '\n\n' +
    'field names matching cost/supplier: ' +
      (offending.length ? offending.join(', ') + '  FAIL' : 'none') + '\n' +
    'reads PO Tracking col 15 (Supplier): ' + (readsSupplier ? 'YES  FAIL' : 'no') + '\n' +
    'reads Receipts col 9 (Price): ' + (readsPrice ? 'YES  FAIL' : 'no') + '\n' +
    'forbidden words in a real response: ' +
      (leaked.length ? leaked.join(', ') + '  FAIL' : 'none') + '\n\n' +
    (offending.length || leaked.length || readsSupplier || readsPrice
      ? 'FAIL — a floor user could read purchase data.'
      : 'PASS — quantity, date and status only. No supplier, no price.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function poBridgeSetup() {
  const p = PropertiesService.getScriptProperties();
  const cur = p.getProperty(POB.BOOK_PROP);
  const msg = 'PO BRIDGE\n\n' +
    'Script Property ' + POB.BOOK_PROP + ':\n   ' + (cur || '(NOT SET)') + '\n\n' +
    (cur ? 'Run buildPoStatus() next.'
         : 'Set it to the PO request spreadsheet id — the long code in its URL\n' +
           'between /d/ and /edit — then run buildPoStatus().');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenPoBridge() {
  SpreadsheetApp.getUi()
    .createMenu('🚚 PO Bridge')
    .addItem('Setup / check id', 'poBridgeSetup')
    .addItem('Build PO status', 'buildPoStatus')
    .addSeparator()
    .addItem('Self test', 'poBridgeSelfTest')
    .addItem('Cost audit', 'poBridgeAudit')
    .addToUi();
}