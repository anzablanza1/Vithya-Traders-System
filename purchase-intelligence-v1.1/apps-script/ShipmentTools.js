/**
 * ShipmentTools.gs — Vithya Traders Purchase Intelligence V1.1.2
 *
 *   R37  apiShipmentRecode_   — correct a wrong product on a PO line AFTER it has shipped (from PO edit only)
 *   R09  v11LotConvertDryRun  — preview: every old V1 lot → a V1.1 shipment (+ bill when it has billing data)
 *        v11LotConvertApply   — do it (run the dry run first)
 *        v11LotUnconvert      — undo: removes the converted shipments / bills and shows the old lots again
 *   R23  v11SpeedCheck        — times every tab the dashboard reads, writes the result to "V1.1 Speed Check"
 *
 * Needs ShipmentApi.gs, BillApi.gs and LiveApi 7.2.gs in the same project.
 * Nothing here deletes or edits an old lot row: a converted lot only gets the shipment ID in column U
 * ("Converted To"). Clearing column U (or running v11LotUnconvert) brings it back.
 */

var V11_TOOLS_VERSION = 'tools 1.0 (V1.1.2)';
var CONV_REPORT_TAB = 'V1.1 Conversion Report';

/* ===================== R37 — CORRECT A SHIPPED PRODUCT ===================== */
// body = { poNumber, from, to, name, by, dryRun }
// Changes, for ONE PO: its V1.1 shipment allocations (and the bill lines of those shipments) from product
// `from` to product `to`. The dashboard changes the PO line and any old lots itself.
function apiShipmentRecode_(body) {
  var po = String((body && body.poNumber) || '').trim();
  var from = shpCanon_(body && body.from), to = shpCanon_(body && body.to);
  var name = String((body && body.name) || '').trim();
  var by = String((body && body.by) || 'dashboard');
  if (!po || !from || !to) return { ok: false, error: 'PO number, old product and new product are needed.' };
  if (from === to) return { ok: false, error: 'The new product is the same as the old one.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var shipNo = {}; shpReadShipments_().forEach(function (s) { shipNo[s.shipmentId] = s.shipmentNo || s.shipmentId; });
    var allocs = shpReadAllocs_();
    var mine = allocs.filter(function (a) { return a.poNumber === po && a.canon === from; });
    var S = {}; mine.forEach(function (a) { S[a.shipmentId] = true; });
    var sids = Object.keys(S), errors = [];
    allocs.forEach(function (a) {
      if (!S[a.shipmentId]) return;
      if (a.canon === from && a.poNumber !== po)
        errors.push('Shipment ' + shipNo[a.shipmentId] + ' also carries ' + from + ' for ' + (a.poNumber ? 'PO ' + a.poNumber : 'off-PO') +
          ' (' + a.type + '). Change that shipment by hand.');
      if (a.canon === to)
        errors.push('Shipment ' + shipNo[a.shipmentId] + ' already carries the new product ' + to + '. Change that shipment by hand.');
    });
    var bills = {}; billReadBills_().forEach(function (b) { bills[b.billId] = b; });
    var lines = billReadLines_().filter(function (l) { return S[l.shipmentId] && l.canon === from; });
    var billHit = {};
    lines.forEach(function (l) {
      var b = bills[l.billId] || {}; billHit[l.billId] = b.billNo || l.billId;
      if (b.locked) errors.push('Bill ' + (b.billNo || l.billId) + ' is locked (Vasy MI / bill number recorded). Clear those numbers first.');
    });
    errors = errors.filter(function (e, i) { return errors.indexOf(e) === i; });
    var summary = { shipments: sids.map(function (id) { return shipNo[id]; }), bills: Object.keys(billHit).map(function (k) { return billHit[k]; }),
      allocations: mine.length, billLines: lines.length };
    if (errors.length) return { ok: false, error: 'Cannot correct the product on the shipments.', errors: errors, summary: summary };
    if (body && body.dryRun) return { ok: true, dryRun: true, summary: summary };

    var now = new Date();
    if (mine.length) {
      var sa = ss.getSheetByName(SHPA_TAB);
      var v = sa.getRange(2, 1, sa.getLastRow() - 1, SHPA_HEADERS.length).getValues();
      for (var i = 0; i < v.length; i++) {
        if (String(v[i][3]) === po && shpCanon_(v[i][4]) === from && S[String(v[i][1])]) {
          v[i][4] = to; v[i][5] = to; if (name) v[i][6] = name; v[i][10] = now; v[i][11] = by;
          v[i][9] = (String(v[i][9] || '') ? v[i][9] + ' · ' : '') + 'product corrected from ' + from;
        }
      }
      sa.getRange(2, 1, v.length, SHPA_HEADERS.length).setValues(v);
    }
    if (lines.length) {
      var sl = ss.getSheetByName(BILLL_TAB);
      var w = sl.getRange(2, 1, sl.getLastRow() - 1, BILLL_HEADERS.length).getValues();
      for (var j = 0; j < w.length; j++) {
        if (S[String(w[j][2])] && shpCanon_(w[j][3]) === from) {
          w[j][3] = to; w[j][4] = to; if (name) w[j][5] = name;
          if (shpCanon_(w[j][13]) === from) w[j][13] = '';                       // old upload code no longer fits
          w[j][14] = ''; w[j][15] = ''; w[j][16] = ''; w[j][17] = '';             // MRP / selling belong to the old product → refilled
          w[j][18] = (String(w[j][18] || '') ? w[j][18] + ' · ' : '') + 'product corrected from ' + from;
          w[j][19] = now; w[j][20] = by;
        }
      }
      sl.getRange(2, 1, w.length, BILLL_HEADERS.length).setValues(w);
    }
    if (typeof audit_ === 'function')
      audit_(by, 'PRODUCT_CORRECT', 'PO', po, 'product', from, to,
        mine.length + ' allocation(s) on ' + summary.shipments.join(', ') + (lines.length ? ' · ' + lines.length + ' bill line(s) on ' + summary.bills.join(', ') : ''));
    return { ok: true, summary: summary };
  } finally { lock.releaseLock(); }
}

/* ===================== R09 — CONVERT OLD LOTS INTO SHIPMENTS ===================== */
function v11LotConvertDryRun() { return v11LotConvert_(true); }
function v11LotConvertApply() { return v11LotConvert_(false); }

function v11ConvPlan_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conv = lotConvSet_();
  // raw lots incl. converted flag
  var Ls = ss.getSheetByName(LOTS_TAB), LL = ss.getSheetByName(LOTL_TAB);
  var lots = [], lines = {};
  if (Ls && Ls.getLastRow() > 1) {
    var v = Ls.getRange(2, 1, Ls.getLastRow() - 1, LOTS_HEADERS.length).getValues();
    v.forEach(function (r, i) {
      if (!r[0]) return;
      lots.push({ row: i + 2, lotId: String(r[0]), poNumber: String(r[1]), lotNo: String(r[2]), date: dstr_(r[3]), transport: String(r[4] || ''),
        lr: String(r[5] || ''), billG: String(r[6] || ''), billN: String(r[7] || ''), miReadyAt: dstr_(r[8]), receivedAt: dstr_(r[9]),
        uploadedAt: dstr_(r[10]), note: String(r[11] || ''), expected: dstr_(r[14]), vasyBill: String(r[15] || ''),
        roundG: Number(r[16]) || 0, roundN: Number(r[17]) || 0, chargesJson: String(r[18] || ''), converted: conv[String(r[0])] || '' });
    });
  }
  if (LL && LL.getLastRow() > 1) {
    var w = LL.getRange(2, 1, LL.getLastRow() - 1, LOTL_HEADERS.length).getValues();
    w.forEach(function (r) {
      if (!r[0]) return;
      (lines[String(r[0])] = lines[String(r[0])] || []).push({ i: (r[2] === '' ? -1 : Number(r[2])), code: String(r[3] || ''), name: String(r[4] || ''),
        qty: Number(r[5]) || 0, g: (r[6] === '' || r[6] == null) ? null : Number(r[6]), n: (r[7] === '' || r[7] == null) ? null : Number(r[7]),
        rate: Number(r[8]) || 0, tax: (r[9] === '' || r[9] == null) ? '' : Number(r[9]), upName: String(r[10]).toLowerCase() === 'true' || r[10] === true,
        mrp: (r[11] === '' || r[11] == null) ? '' : Number(r[11]), sp: (r[12] === '' || r[12] == null) ? '' : Number(r[12]), ret: Number(r[13]) || 0,
        flags: String(r[14] || '') });
    });
  }
  // PO lane + supplier + product list
  var poInfo = {};
  var t = ss.getSheetByName(TRACK_TAB);
  if (t && t.getLastRow() > 1) {
    t.getRange(2, 1, t.getLastRow() - 1, TRACK_HEADERS.length).getValues().forEach(function (r) {
      var p = String(r[7] || ''); if (!p) return;
      var x = poInfo[p] = poInfo[p] || { lane: '', supplier: '', codes: {} };
      if (!x.lane) x.lane = /non/i.test(String(r[6] || '')) ? 'n' : 'g';
      if (!x.supplier && r[15]) x.supplier = String(r[15]);
      x.codes[shpCanon_(r[4])] = true;
    });
  }
  var m = ss.getSheetByName(META_TAB);
  if (m && m.getLastRow() > 1) m.getRange(2, 1, m.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var p = String(r[0] || ''); if (p && poInfo[p] && r[1]) poInfo[p].supplier = String(r[1]);
  });
  return { lots: lots, lines: lines, poInfo: poInfo };
}

function v11ConvYmd_(d) {
  var s = String(d || '').replace(/[^0-9]/g, '').slice(0, 8);
  if (s.length === 8) return s;
  return Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Kolkata', 'yyyyMMdd');
}

function v11LotConvert_(dry) {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var P = v11ConvPlan_();
    var report = [], plan = [], skipped = 0, already = 0;
    var existingShip = {}; shpReadShipments_().forEach(function (s) { existingShip[s.shipmentId] = s; });
    var before = shpQtyByPoCode_();

    P.lots.forEach(function (L) {
      if (L.converted) { already++; return; }
      var ls = (P.lines[L.lotId] || []).filter(function (x) { return x.qty > 0; });
      var info = P.poInfo[L.poNumber];
      var why = '';
      if (!ls.length) why = 'no product lines with quantity';
      else if (!info) why = 'PO ' + L.poNumber + ' not found in PO Tracking (deleted PO?)';
      else if (existingShip['CONV-' + L.lotId]) why = 'shipment CONV-' + L.lotId + ' already exists';
      if (why) { skipped++; report.push([L.lotId, L.poNumber, L.lotNo, '', 'SKIPPED', why, '', '', '']); return; }

      var sid = 'CONV-' + L.lotId;
      var arrived = !!L.receivedAt;
      var allocs = ls.map(function (x) {
        var canon = shpCanon_(x.code);
        var onPo = x.i >= 0 && info.codes[canon];
        return { type: onPo ? 'PO' : 'EXCESS', poNumber: L.poNumber, canon: canon, name: x.name, qty: x.qty, ret: x.ret || 0,
          note: onPo ? '' : 'V1 line not on the PO' };
      });
      // a bill only when the lot has billing evidence
      var split = ls.some(function (x) { return x.g != null || x.n != null; });
      var charges = []; try { charges = JSON.parse(L.chargesJson || '[]') || []; } catch (e) { charges = []; }
      var hasBill = !!(L.billG || L.billN || L.miReadyAt || L.uploadedAt || L.vasyBill || split || charges.length || L.roundG || L.roundN);
      var bill = null;
      if (hasBill) {
        var bl = ls.map(function (x) {
          var eff = Math.max(0, x.qty - (x.ret || 0)), qG = 0, qN = 0;
          if (x.g != null || x.n != null) { qG = Number(x.g) || 0; qN = Number(x.n) || 0; }
          else if (info.lane === 'n') qN = eff; else qG = eff;
          return { canon: shpCanon_(x.code), name: x.name, qtyG: qG, qtyN: qN, rate: x.rate, tax: x.tax, upName: x.upName,
            mrpG: qG ? x.mrp : '', spG: qG ? x.sp : '', mrpN: qN ? x.mrp : '', spN: qN ? x.sp : '' };
        }).filter(function (b) { return b.qtyG > 0 || b.qtyN > 0; });
        var anyG = bl.some(function (b) { return b.qtyG > 0; }), anyN = bl.some(function (b) { return b.qtyN > 0; });
        var done = !!(L.uploadedAt || L.vasyBill);
        var mark = 'V1:' + (L.vasyBill || ('uploaded ' + L.uploadedAt));
        bill = { billId: 'CONVB-' + L.lotId, lines: bl, readyAt: L.miReadyAt || (done ? L.uploadedAt : ''),
          miG: done && anyG ? 'V1' : '', miN: done && anyN ? 'V1' : '', vasyG: done && anyG ? mark : '', vasyN: done && anyN ? mark : '',
          charges: charges.filter(function (c) { return Number(c.amt || c.amount); }).map(function (c) {
            return { name: c.name || 'charge', amount: Number(c.amt != null ? c.amt : c.amount) || 0, gst: Number(c.gstPct != null ? c.gstPct : c.gst) || 0, lane: c.lane === 'n' ? 'n' : 'g' }; }) };
        if (!bl.length) bill = null;
      }
      plan.push({ L: L, sid: sid, supplier: info.supplier, arrived: arrived, allocs: allocs, bill: bill });
      report.push([L.lotId, L.poNumber, L.lotNo, sid, arrived ? 'Arrived ' + L.receivedAt : 'In Transit',
        allocs.length + ' line(s): ' + allocs.map(function (a) { return a.canon + ' ×' + a.qty + (a.ret ? ' (ret ' + a.ret + ')' : '') + (a.type !== 'PO' ? ' [' + a.type + ']' : ''); }).join(', '),
        bill ? ('bill ' + bill.billId + (bill.vasyG || bill.vasyN ? ' · LOCKED (' + (bill.vasyG || bill.vasyN) + ')' : (bill.readyAt ? ' · Ready' : ' · Draft'))) : 'no bill',
        info.supplier || '(no supplier)', '']);
    });

    var created = { shipments: 0, allocations: 0, bills: 0, billLines: 0 };
    if (!dry && plan.length) {
      var now = new Date(), by = 'V1.1 conversion';
      var s = shpSheet_(SHP_TAB, SHP_HEADERS, '#0F766E', [1, 2, 4, 7]);
      var sa = shpSheet_(SHPA_TAB, SHPA_HEADERS, '#7C3AED', [1, 2, 4, 5, 6]);
      var bs = (typeof setupBillsV11 === 'function') ? (setupBillsV11(), ss.getSheetByName(BILL_TAB)) : null;
      var bls = ss.getSheetByName(BILLL_TAB);
      // highest number already used per day prefix
      function maxFor(sheet, prefix) {
        var mx = 0; if (!sheet || sheet.getLastRow() < 2) return 0;
        sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().forEach(function (r) {
          var no = String(r[0] || ''); if (no.indexOf(prefix) === 0) { var n = parseInt(no.slice(prefix.length), 10); if (n > mx) mx = n; } });
        return mx;
      }
      var shipRows = [], allocRows = [], billRows = [], lineRows = [], lotMarks = [];
      var maxCache = {};
      plan.forEach(function (x) {
        var L = x.L, ymd = v11ConvYmd_(L.date);
        var pre = 'SH-' + ymd + '-'; if (maxCache[pre] == null) maxCache[pre] = maxFor(s, pre);
        var shipNo = v11NextNo_(pre, maxCache[pre]);
        shipRows.push([x.sid, shipNo, x.supplier || '', L.date || '', L.transport, L.lr, L.expected || '', x.arrived ? 'Arrived' : 'In Transit',
          ('Converted from V1 lot ' + L.poNumber + ' #' + L.lotNo + (L.note ? ' · ' + L.note : '')).slice(0, 400), now, now, by,
          x.arrived ? L.receivedAt : '', x.arrived ? by : '']);
        x.allocs.forEach(function (a, k) {
          allocRows.push([x.sid + '-' + (k + 1), x.sid, a.type, a.poNumber, a.canon, a.canon, a.name, a.qty, '', a.note, now, by, '', a.ret || '']);
        });
        if (x.bill && bs) {
          var bpre = 'BL-' + ymd + '-'; if (maxCache[bpre] == null) maxCache[bpre] = maxFor(bs, bpre);
          var billNo = v11NextNo_(bpre, maxCache[bpre]);
          var B = x.bill;
          var st = billStatus_({ readyAt: B.readyAt, miG: B.miG, miN: B.miN, vasyG: B.vasyG, vasyN: B.vasyN });
          billRows.push([B.billId, billNo, x.supplier || '', L.date || '', L.billG, L.billN, L.roundG, L.roundN, JSON.stringify(B.charges), '', st,
            B.readyAt, B.miG, B.miN, (B.miG || B.miN) ? L.uploadedAt : '', (B.miG || B.miN) ? by : '', '',
            B.vasyG, B.vasyN, (B.vasyG || B.vasyN) ? L.uploadedAt : '', (B.vasyG || B.vasyN) ? by : '',
            'Converted from V1 lot ' + L.poNumber + ' #' + L.lotNo, now, now, by]);
          B.lines.forEach(function (l, k) {
            lineRows.push([B.billId + '-' + (k + 1), B.billId, x.sid, l.canon, l.canon, l.name, L.poNumber, l.qtyG, l.rate, l.qtyN, l.rate,
              l.tax, !!l.upName, '', l.mrpG, l.spG, l.mrpN, l.spN, '', now, by]);
          });
        }
        lotMarks.push([L.row, x.sid]);
      });
      if (shipRows.length) s.getRange(s.getLastRow() + 1, 1, shipRows.length, SHP_HEADERS.length).setValues(shipRows);
      if (allocRows.length) sa.getRange(sa.getLastRow() + 1, 1, allocRows.length, SHPA_HEADERS.length).setValues(allocRows);
      if (billRows.length) bs.getRange(bs.getLastRow() + 1, 1, billRows.length, BILL_HEADERS.length).setValues(billRows);
      if (lineRows.length) bls.getRange(bls.getLastRow() + 1, 1, lineRows.length, BILLL_HEADERS.length).setValues(lineRows);
      // mark the lots (column U)
      var Ls = ss.getSheetByName(LOTS_TAB);
      if (Ls.getMaxColumns() < LOT_CONV_COL) Ls.insertColumnsAfter(Ls.getMaxColumns(), LOT_CONV_COL - Ls.getMaxColumns());
      Ls.getRange(1, LOT_CONV_COL).setValue('Converted To').setFontWeight('bold');
      var colU = Ls.getRange(2, LOT_CONV_COL, Ls.getLastRow() - 1, 1).getValues();       // one write for all marks
      lotMarks.forEach(function (mk) { colU[mk[0] - 2][0] = mk[1]; });
      Ls.getRange(2, LOT_CONV_COL, colU.length, 1).setValues(colU);
      created = { shipments: shipRows.length, allocations: allocRows.length, bills: billRows.length, billLines: lineRows.length };
      if (typeof audit_ === 'function') audit_(by, 'LOT_CONVERT', 'Lots', '', '', '', shipRows.length + ' lot(s)',
        allocRows.length + ' allocation(s), ' + billRows.length + ' bill(s)');
    }

    // totals check: shipped / received per PO line must not change (dry run simulates it)
    var after = dry ? v11ConvSimulate_(before, plan) : shpQtyByPoCode_();
    var diffs = [];
    var keys = {}; Object.keys(before).forEach(function (k) { keys[k] = 1; }); Object.keys(after).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var b = before[k] || { shippedPO: 0, received: 0, shipped: 0 }, a = after[k] || { shippedPO: 0, received: 0, shipped: 0 };
      if (Math.abs(b.shipped - a.shipped) > 1e-6 || Math.abs(b.received - a.received) > 1e-6 || Math.abs(b.shippedPO - a.shippedPO) > 1e-6)
        diffs.push([k, b.shippedPO, a.shippedPO, b.shipped, a.shipped, b.received, a.received]);
    });

    // report
    var sh = ss.getSheetByName(CONV_REPORT_TAB) || ss.insertSheet(CONV_REPORT_TAB);
    sh.clear();
    var head = [['V1.1 lot conversion — ' + (dry ? 'DRY RUN (nothing changed)' : 'APPLIED'), new Date()],
      ['Lots to convert', plan.length], ['Already converted', already], ['Skipped', skipped],
      ['Bills created from billing data', plan.filter(function (x) { return x.bill; }).length],
      ['Locked bills (already uploaded to Vasy)', plan.filter(function (x) { return x.bill && (x.bill.vasyG || x.bill.vasyN); }).length],
      ['PO lines whose numbers change', diffs.length + (diffs.length ? '  ← see the list at the bottom; only products NOT on the PO should appear' : '  ✓ none')]];
    if (!dry) head.push(['Created', JSON.stringify(created)]);
    sh.getRange(1, 1, head.length, 2).setValues(head);
    var r0 = head.length + 2;
    var h = ['Lot ID', 'PO', 'Lot #', 'New shipment ID', 'State', 'Lines', 'Bill', 'Supplier', ''];
    sh.getRange(r0, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    if (report.length) sh.getRange(r0 + 1, 1, report.length, h.length).setValues(report);
    if (diffs.length) {
      var r1 = r0 + report.length + 3;
      var dh = ['PO | product', 'shipped vs PO before', 'after', 'shipped before', 'after', 'received before', 'after'];
      sh.getRange(r1, 1, 1, dh.length).setValues([dh]).setFontWeight('bold');
      sh.getRange(r1 + 1, 1, diffs.length, dh.length).setValues(diffs);
    }
    return 'Lot conversion ' + (dry ? 'DRY RUN' : 'APPLIED') + ': ' + plan.length + ' lot(s) ' + (dry ? 'would be' : 'were') + ' converted, ' +
      skipped + ' skipped, ' + already + ' already converted. Numbers that change: ' + diffs.length + '. See the tab "' + CONV_REPORT_TAB + '".';
  } finally { lock.releaseLock(); }
}

// dry run: remove the converted lots' V1 numbers and add them back as V1.1 allocations
function v11ConvSimulate_(before, plan) {
  var out = JSON.parse(JSON.stringify(before));
  function e(k) { return out[k] = out[k] || { shipped: 0, shippedPO: 0, shippedV1: 0, shippedV11: 0, excess: 0, received: 0 }; }
  plan.forEach(function (x) {
    x.allocs.forEach(function (a) {
      var k = a.poNumber + '|' + a.canon, o = e(k);
      // remove the V1 lot version (it was PO-type, received = qty − ret when received)
      o.shipped -= a.qty; o.shippedPO -= a.qty; o.received -= x.arrived ? Math.max(0, a.qty - a.ret) : 0;
      // add the V1.1 version
      if (a.type === 'PO') { o.shipped += a.qty; o.shippedPO += a.qty; }
      else { o.shipped += a.qty; o.excess += a.qty; }
      if (x.arrived) o.received += Math.max(0, a.qty - a.ret);
    });
  });
  Object.keys(out).forEach(function (k) { ['shipped', 'shippedPO', 'received'].forEach(function (f) { out[k][f] = Math.round(out[k][f] * 1000) / 1000; }); });
  return out;
}

// UNDO — removes converted shipments (CONV-…) and bills (CONVB-…) that nobody has touched since,
// and clears column U so the old lots show again.
function v11LotUnconvert() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var Ls = ss.getSheetByName(LOTS_TAB);
    if (!Ls || Ls.getMaxColumns() < LOT_CONV_COL || Ls.getLastRow() < 2) return 'Nothing to undo — no converted lots.';
    var marks = Ls.getRange(2, LOT_CONV_COL, Ls.getLastRow() - 1, 1).getValues();
    var conv = {}; marks.forEach(function (r) { if (String(r[0] || '').indexOf('CONV-') === 0) conv[String(r[0])] = true; });
    var bills = billReadBills_(), lines = billReadLines_(), keep = [], drop = {}, dropBill = {};
    // a converted shipment can be undone only if no OTHER bill uses it and its own bill was not changed by hand
    var touched = {};
    lines.forEach(function (l) { if (conv[l.shipmentId] && l.billId.indexOf('CONVB-') !== 0) touched[l.shipmentId] = 'used on bill ' + l.billId; });
    bills.forEach(function (b) {
      if (b.billId.indexOf('CONVB-') !== 0) return;
      var sid = 'CONV-' + b.billId.slice(6);
      if (String(b.by) !== 'V1.1 conversion') touched[sid] = 'bill ' + (b.billNo || b.billId) + ' was edited after conversion';
    });
    shpReadAllocs_().forEach(function (a) { if (conv[a.shipmentId] && String(a.by || '') !== 'V1.1 conversion' && !touched[a.shipmentId]) touched[a.shipmentId] = 'products of ' + a.shipmentId + ' were changed after conversion'; });
    var shp = shpReadShipments_();
    shp.forEach(function (s) { if (conv[s.shipmentId] && String(s.by || '') !== 'V1.1 conversion' && !touched[s.shipmentId]) touched[s.shipmentId] = 'shipment ' + (s.shipmentNo || s.shipmentId) + ' was edited after conversion'; });
    Object.keys(conv).forEach(function (sid) { if (touched[sid]) keep.push(sid + ': ' + touched[sid]); else { drop[sid] = true; dropBill['CONVB-' + sid.slice(5)] = true; } });
    var nS = v11ReplaceRows_(ss.getSheetByName(SHP_TAB), SHP_HEADERS.length, function (r) { return drop[String(r[0])]; }, []).length;
    var nA = v11ReplaceRows_(ss.getSheetByName(SHPA_TAB), SHPA_HEADERS.length, function (r) { return drop[String(r[1])]; }, []).length;
    var nB = 0, nL = 0;
    if (ss.getSheetByName(BILL_TAB)) nB = v11ReplaceRows_(ss.getSheetByName(BILL_TAB), BILL_HEADERS.length, function (r) { return dropBill[String(r[0])]; }, []).length;
    if (ss.getSheetByName(BILLL_TAB)) nL = v11ReplaceRows_(ss.getSheetByName(BILLL_TAB), BILLL_HEADERS.length, function (r) { return dropBill[String(r[1])]; }, []).length;
    var cleared = 0;
    marks.forEach(function (r) { if (drop[String(r[0] || '')]) { r[0] = ''; cleared++; } });
    if (cleared) Ls.getRange(2, LOT_CONV_COL, marks.length, 1).setValues(marks);
    if (typeof audit_ === 'function') audit_('V1.1 conversion', 'LOT_UNCONVERT', 'Lots', '', '', cleared + ' lot(s)', '', keep.length + ' kept');
    return 'Undo: ' + cleared + ' lot(s) restored (' + nS + ' shipment(s), ' + nA + ' allocation(s), ' + nB + ' bill(s), ' + nL + ' bill line(s) removed).' +
      (keep.length ? ' NOT undone (changed after conversion): ' + keep.join(' | ') : '');
  } finally { lock.releaseLock(); }
}

/* ===================== R23 — SPEED CHECK ===================== */
function v11SpeedCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), out = [['Step', 'Milliseconds', 'Rows', 'Note']];
  function time(label, fn) {
    var t0 = Date.now(), n = '', note = '';
    try { var r = fn(); n = (r && r.length != null) ? r.length : (r && typeof r === 'object' ? Object.keys(r).length : ''); }
    catch (e) { note = 'ERROR ' + (e && e.message || e); }
    out.push([label, Date.now() - t0, n, note]);
  }
  time('PO Tracking (read)', function () { var t = ss.getSheetByName(TRACK_TAB); return t ? t.getDataRange().getValues() : []; });
  time('PO Meta (read)', function () { var t = ss.getSheetByName(META_TAB); return t ? t.getDataRange().getValues() : []; });
  time('Old lots (readLots_)', function () { return readLots_(); });
  time('Old lot lines (readLotLines_)', function () { return readLotLines_(); });
  time('Shipments', function () { return shpReadShipments_(); });
  time('Shipment Allocations', function () { return shpReadAllocs_(); });
  time('Bills', function () { return billReadBills_(); });
  time('Bill Lines', function () { return billReadLines_(); });
  time('Products', function () { return getProducts(); });
  time('Combined quantities (shpQtyByPoCode_)', function () { return shpQtyByPoCode_(); });
  time('V1.1 save reply (v11Payload_)', function () { return [v11Payload_()]; });
  time('Whole dashboard load (apiData_)', function () { return [apiData_()]; });
  // tabs with many formulas slow every write in the spreadsheet
  ss.getSheets().forEach(function (sh) {
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    if (!lr || !lc) return;
    var t0 = Date.now(), f = 0;
    try { var fm = sh.getRange(1, 1, Math.min(lr, 3000), Math.min(lc, 60)).getFormulas(); fm.forEach(function (r) { r.forEach(function (c) { if (c) f++; }); }); } catch (e) { }
    out.push(['Tab: ' + sh.getName(), Date.now() - t0, lr + ' rows × ' + lc + ' cols', f ? f + ' formula cell(s)' : '']);
  });
  var rep = ss.getSheetByName('V1.1 Speed Check') || ss.insertSheet('V1.1 Speed Check');
  rep.clear(); rep.getRange(1, 1, out.length, 4).setValues(out); rep.getRange(1, 1, 1, 4).setFontWeight('bold');
  return 'Speed check written to the tab "V1.1 Speed Check".';
}
