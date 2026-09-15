/**********************************************************************
 * VITHYA TRADERS — VERIFICATION QUEUE
 *
 * Globals declared here (check before pasting):
 *   VQ, VQ_COLS, buildVerifyQueue, verifyQueueBills, verifyQueueBill,
 *   verifyApplyBill, verifyQueueStatus, vqRead_, vqDate_, vqNum_, vqKey_,
 *   onOpenVerifyQueue
 *
 * ── THE PROBLEM THIS SOLVES ──
 *   Verified_Pricing has 13,947 rows and every one says "unverified".
 *   Nobody works through a 13,947-row list. The programme dies on day one.
 *
 * ── THE UNIT OF WORK IS A BILL, NOT A PRODUCT ──
 *   A purchase bill sits in front of you with 12 products on it. Verifying
 *   those 12 together, with the paper in hand, takes ten minutes. Verifying
 *   the same 12 alphabetically across six weeks takes forever and nobody
 *   does it.
 *
 *   So the queue is: one bill, its supplier, its date, and every product on
 *   it that is still unverified — with Vasy's rate AND landing cost shown
 *   side by side, because the gap between them is the transport that was
 *   wrongly folded into cost.
 *
 * ── WHAT IT DOES NOT DO ──
 *   It does not mark anything verified by itself. The register rate may be
 *   wrong — that is the whole reason for this exercise. It puts the evidence
 *   in front of you; you type what the bill actually says.
 *
 * ── RUN ──
 *   buildVerifyQueue()       build/refresh the queue from recent bills
 *   verifyQueueStatus()      how much is done, and what is worth doing next
 *   verifyQueueBills()       list bills waiting, biggest value first
 **********************************************************************/

const VQ = {
  SHEET: 'Verify_Queue',
  REGISTER: 'Purchase_Register',
  VERIFIED: 'Verified_Pricing',
  ANALYTICS: 'Product_Analytics',
  HDR_ROW: 2,          // Verified_Pricing header row
  LOOKBACK_DAYS: 180,
  MAX_BILLS: 400,
};

const VQ_COLS = ['bill_no', 'bill_date', 'supplier', 'lane', 'item_code',
  'product_name', 'qty', 'reg_rate', 'reg_landing', 'transport_implied',
  'erp_current_rate', 'verified_cost', 'trust', 'abc', 'revenue_365d',
  'priority', 'status'];

function vqNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function vqDate_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : String(v).slice(0, 10);
}
function vqKey_(code, lane) { return String(code).trim() + '|' + String(lane).trim(); }

function vqRead_(name, hdrRow) {
  const sh = vtSheet(name);
  if (!sh) return null;
  const hr = hdrRow || 1;
  if (sh.getLastRow() <= hr) return null;
  const hdr = sh.getRange(hr, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  return { sh: sh, H: H, hr: hr,
    rows: sh.getRange(hr + 1, 1, sh.getLastRow() - hr, sh.getLastColumn()).getValues() };
}

/* ---------- build ---------- */

function buildVerifyQueue() {
  const t0 = Date.now();
  const reg = vqRead_(VQ.REGISTER, 1);
  if (!reg) throw new Error('Purchase_Register is empty.');
  const ver = vqRead_(VQ.VERIFIED, VQ.HDR_ROW);
  if (!ver) throw new Error('Verified_Pricing is empty — run buildVerifiedRows().');
  const pa = vqRead_(VQ.ANALYTICS, 1);

  /* current verification state, per product per lane */
  const state = {};
  ver.rows.forEach(function (r) {
    const k = vqKey_(r[ver.H.item_code], r[ver.H.lane]);
    state[k] = {
      cost: r[ver.H.cost_value],
      trust: String(r[ver.H.cost_trust] || 'unverified'),
      date: vqDate_(r[ver.H.cost_date]),
    };
  });

  /* how much each product is worth caring about */
  const worth = {};
  if (pa) pa.rows.forEach(function (r) {
    const c = String(r[pa.H.item_code] || '').trim();
    if (c) worth[c] = { abc: String(r[pa.H.abc_revenue] || 'C'),
      rev: vqNum_(r[pa.H.revenue_365d]) || 0,
      erp: vqNum_(r[pa.H.unit_cost]) || '' };
  });

  const cutoff = Utilities.formatDate(
    new Date(Date.now() - VQ.LOOKBACK_DAYS * 86400000),
    Session.getScriptTimeZone(), 'yyyy-MM-dd');

  /* newest bill line per product+lane inside the window */
  const best = {};
  reg.rows.forEach(function (r) {
    const code = String(r[reg.H.itemCode] || '').trim();
    if (!code) return;
    const d = vqDate_(r[reg.H.billDate]);
    if (!d || d < cutoff) return;
    const lane = code.slice(-1) === '/' ? 'WO' : 'W';
    const canon = code.replace(/\/+$/, '');
    const k = vqKey_(canon, lane);
    if (best[k] && best[k].date >= d) return;
    best[k] = {
      date: d, bill: String(r[reg.H.billNo] || '').trim(),
      party: String(r[reg.H.partyName] || '').trim(),
      canon: canon, lane: lane,
      name: String(r[reg.H.productName] || '').replace(/\s*\/$/, ''),
      qty: vqNum_(r[reg.H.qty]),
      rate: vqNum_(r[reg.H.rate]),
      landing: vqNum_(r[reg.H.landingCost]),
    };
  });

  /* keep only what still needs a human */
  const rows = [];
  Object.keys(best).forEach(function (k) {
    const b = best[k];
    const st = state[k];
    if (!st) return;                                   // not in Verified_Pricing
    let need = '', pri = 9;
    const w = worth[b.canon] || { abc: 'C', rev: 0, erp: '' };

    if (st.trust === 'unverified' || st.cost === '' || st.cost === null) {
      need = 'never verified';
      pri = w.abc === 'A' ? 1 : (w.abc === 'B' ? 3 : 5);
    } else if (st.trust === 'stale') {
      need = 'stale'; pri = w.abc === 'A' ? 2 : 4;
    } else if (st.date && st.date < b.date) {
      /* a newer bill arrived after the last verification — the price may have moved */
      need = 'new bill since ' + st.date;
      pri = w.abc === 'A' ? 2 : 4;
    } else if (st.trust === 'verified' && st.cost !== '' &&
        b.rate && Math.abs((b.rate - Number(st.cost)) / Number(st.cost)) > 0.1) {
      need = 'bill differs by ' +
        Math.round((b.rate - Number(st.cost)) / Number(st.cost) * 100) + '%';
      pri = 2;
    } else return;                                     // nothing to do

    const implied = (b.landing !== '' && b.rate !== '') ?
      Math.round((b.landing - b.rate) * 100) / 100 : '';

    rows.push([b.bill, b.date, b.party, b.lane, b.canon, b.name, b.qty,
      b.rate, b.landing, implied, w.erp,
      st.cost === '' ? '' : st.cost, st.trust,
      w.abc, Math.round(w.rev), pri, need]);
  });

  /* group so a bill's lines sit together, most valuable bill first */
  const billValue = {};
  rows.forEach(function (r) { billValue[r[0]] = (billValue[r[0]] || 0) + (Number(r[14]) || 0); });
  rows.sort(function (a, b) {
    const d = (billValue[b[0]] || 0) - (billValue[a[0]] || 0);
    if (d) return d;
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[15] - b[15];
  });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(VQ.SHEET);
  if (!sh) sh = ss.insertSheet(VQ.SHEET);
  sh.clear();
  if (sh.getMaxColumns() < VQ_COLS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), VQ_COLS.length - sh.getMaxColumns());
  }
  if (sh.getMaxRows() < rows.length + 10) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length + 10 - sh.getMaxRows());
  }
  sh.getRange(1, 1, 1, VQ_COLS.length).setValues([VQ_COLS])
    .setFontWeight('bold').setBackground('#CC3018').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  if (rows.length) {
    const B = 3000;
    for (let i = 0; i < rows.length; i += B) {
      const blk = rows.slice(i, i + B);
      sh.getRange(2 + i, 1, blk.length, VQ_COLS.length).setValues(blk);
    }
    sh.setColumnWidth(6, 260);
    /* the implied-transport column is the interesting one */
    sh.getRange(2, 10, rows.length, 1).setBackground('#FDF5E4');
  }

  const bills = {};
  rows.forEach(function (r) { bills[r[0]] = 1; });
  const withTransport = rows.filter(function (r) { return Number(r[9]) > 0; }).length;
  const msg = 'VERIFY QUEUE BUILT  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'lines needing verification: ' + rows.length + '\n' +
    'across ' + Object.keys(bills).length + ' purchase bill(s)\n' +
    'bills from the last ' + VQ.LOOKBACK_DAYS + ' days\n\n' +
    'lines where landing > rate: ' + withTransport + '\n' +
    '   that gap is transport folded into cost — it belongs in the\n' +
    '   transport column, not the cost column.\n\n' +
    'Work one bill at a time. verifyQueueBills() lists them, biggest first.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return rows.length;
}

/* ---------- views ---------- */

function verifyQueueBills() {
  const q = vqRead_(VQ.SHEET, 1);
  if (!q) throw new Error('Run buildVerifyQueue() first.');
  const bills = {};
  q.rows.forEach(function (r) {
    const b = String(r[q.H.bill_no] || '');
    if (!b) return;
    if (!bills[b]) bills[b] = { n: 0, rev: 0, party: String(r[q.H.supplier] || ''),
      date: vqDate_(r[q.H.bill_date]), a: 0 };
    bills[b].n++;
    bills[b].rev += vqNum_(r[q.H.revenue_365d]) || 0;
    if (String(r[q.H.abc]) === 'A') bills[b].a++;
  });
  const list = Object.keys(bills).map(function (b) {
    return { bill: b, d: bills[b] };
  }).sort(function (x, y) { return y.d.rev - x.d.rev; });

  const msg = 'BILLS WAITING  (' + list.length + ')\n\n' +
    list.slice(0, 20).map(function (x) {
      return '   ' + x.bill + '  ' + x.d.date + '\n' +
        '      ' + x.d.party.slice(0, 38) + '\n' +
        '      ' + x.d.n + ' line(s), ' + x.d.a + ' A-class, Rs ' +
        Math.round(x.d.rev).toLocaleString('en-IN') + ' of annual revenue';
    }).join('\n') +
    (list.length > 20 ? '\n\n   …and ' + (list.length - 20) + ' more' : '') +
    '\n\nOrdered by the revenue riding on those products — verify the top of\n' +
    'this list and most of your margin becomes trustworthy.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return list;
}

function verifyQueueStatus() {
  const ver = vqRead_(VQ.VERIFIED, VQ.HDR_ROW);
  if (!ver) throw new Error('Verified_Pricing is empty.');
  const pa = vqRead_(VQ.ANALYTICS, 1);
  const rev = {};
  if (pa) pa.rows.forEach(function (r) {
    const c = String(r[pa.H.item_code] || '').trim();
    if (c) rev[c] = vqNum_(r[pa.H.revenue_365d]) || 0;
  });

  let rows = 0, verified = 0, revTotal = 0, revVerified = 0;
  const byTrust = {};
  ver.rows.forEach(function (r) {
    const c = String(r[ver.H.item_code] || '').trim();
    if (!c) return;
    rows++;
    const t = String(r[ver.H.cost_trust] || 'unverified');
    byTrust[t] = (byTrust[t] || 0) + 1;
    const rv = (rev[c] || 0) / 2;      // revenue is per product, rows are per lane
    revTotal += rv;
    if (t === 'verified') { verified++; revVerified += rv; }
  });

  const q = vqRead_(VQ.SHEET, 1);
  const waiting = q ? q.rows.length : 0;

  const msg = 'VERIFICATION PROGRESS\n\n' +
    'rows verified: ' + verified.toLocaleString() + ' of ' + rows.toLocaleString() +
    '  (' + (rows ? (verified / rows * 100).toFixed(1) : 0) + '%)\n' +
    'REVENUE covered: Rs ' + Math.round(revVerified).toLocaleString('en-IN') +
    ' of Rs ' + Math.round(revTotal).toLocaleString('en-IN') +
    '  (' + (revTotal ? (revVerified / revTotal * 100).toFixed(1) : 0) + '%)\n\n' +
    '── by trust ──\n' +
    Object.keys(byTrust).sort().map(function (k) {
      return '   ' + k + ': ' + byTrust[k].toLocaleString();
    }).join('\n') +
    '\n\nin the queue now: ' + waiting.toLocaleString() + ' line(s)\n\n' +
    'Revenue covered is the number that matters. Verifying the products that\n' +
    'actually sell makes the margin figures true long before the row count\n' +
    'looks impressive.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenVerifyQueue() {
  SpreadsheetApp.getUi()
    .createMenu('🔍 Verify Queue')
    .addItem('Build / refresh queue', 'buildVerifyQueue')
    .addItem('Bills waiting', 'verifyQueueBills')
    .addItem('Progress', 'verifyQueueStatus')
    .addToUi();
}