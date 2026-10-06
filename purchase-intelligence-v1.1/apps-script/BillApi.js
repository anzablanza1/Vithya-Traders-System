/**
 * VITHYA TRADERS — PURCHASE INTELLIGENCE V1.1 · BILL API
 * ───────────────────────────────────────────────────────
 * VERSION: V1.1-05 "Vaigai" · server 2.2  (2026-10)  — 2.2: bill numbers never reused
 *
 * A BILL is the supplier's invoice, entered once, split w (GST) / wo (Non-GST).
 *   Bills       — one row per bill (header, charges, round-off, Vasy stages)
 *   Bill Lines  — one row per bill × shipment × product (qty + rate for BOTH lanes)
 *
 * RULES (owner decisions, Oct 2026)
 *  - Shipments are ASSIGNED to bills. Many shipments → one bill; one shipment → many bills.
 *  - Every bill line must come from a shipment that carries that product.
 *  - Bill qty and shipment qty are independent; any difference is a "recheck" warning, never a block.
 *  - Stages: Draft → Ready (file downloaded) → MI Uploaded (Vasy MI no. w / wo)
 *            → Bill Generated (Vasy bill no. w / wo). Each stage can be reversed (audited).
 *  - MI numbers need every shipment on the bill to be ARRIVED, unless a manual override is used.
 *  - A bill with any MI / Vasy number is LOCKED: no edit, no unassign, no delete until cleared.
 *  - Delete a bill only when it is empty (all shipments unassigned). Unassigning never deletes
 *    the shipment.
 *  - The upload file carries item code / qty / rate / MRP / selling only; charges are saved here
 *    but entered manually in Vasy.
 *
 * Depends on ShipmentApi.gs (shpReadShipments_, shpReadAllocs_, shpCanon_, shpSheet_, shpStr_)
 * and LiveApi 7.2.js (audit_).
 */

var BILL_TAB  = 'Bills';
var BILLL_TAB = 'Bill Lines';
var BILL_HEADERS  = ['Bill ID', 'Bill No', 'Supplier', 'Bill Date', 'Supplier Bill No (w)', 'Supplier Bill No (wo)',
  'Round Off (w)', 'Round Off (wo)', 'Charges JSON', 'Totals JSON', 'Status', 'Ready At',
  'MI No (w)', 'MI No (wo)', 'MI At', 'MI By', 'MI Override',
  'Vasy Bill No (w)', 'Vasy Bill No (wo)', 'Vasy Bill At', 'Vasy Bill By', 'Note', 'Created At', 'Updated At', 'By'];
var BILLL_HEADERS = ['Line ID', 'Bill ID', 'Shipment ID', 'Canonical Code', 'Item Code', 'Item Name', 'PO Ref',
  'Qty (w)', 'Rate (w)', 'Qty (wo)', 'Rate (wo)', 'Tax %', 'Upload as /', 'Upload Code',
  'MRP (w)', 'Selling (w)', 'MRP (wo)', 'Selling (wo)', 'Note', 'Updated At', 'By'];
var BILL_TEXT_COLS  = [1, 2, 4, 5, 6, 13, 14, 18, 19];
var BILLL_TEXT_COLS = [1, 2, 3, 4, 5, 7, 14];

function setupBillsV11() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), made = [];
  if (!ss.getSheetByName(BILL_TAB)) made.push(BILL_TAB);
  if (!ss.getSheetByName(BILLL_TAB)) made.push(BILLL_TAB);
  shpSheet_(BILL_TAB, BILL_HEADERS, '#B45309', BILL_TEXT_COLS);
  shpSheet_(BILLL_TAB, BILLL_HEADERS, '#9A3412', BILLL_TEXT_COLS);
  shpSheet_(SHP_TAB, SHP_HEADERS, '#0F766E', [1, 2, 4, 7]);        // adds Arrived At / Arrived By headers
  var msg = 'V1.1 Bill tabs ready. ' + (made.length ? 'Created: ' + made.join(', ') + '.' : 'Bill tabs already existed.') +
    ' Shipments header checked (Arrived At / Arrived By). No other tab touched.';
  Logger.log(msg);
  return msg;
}

/* ===================== HELPERS ===================== */
function billNumOr_(v, d) { if (v === '' || v == null) return d; var n = Number(v); return isFinite(n) ? n : NaN; }
function billStatus_(b) {
  if (b.vasyG || b.vasyN) return 'Bill Generated';
  if (b.miG || b.miN) return 'MI Uploaded';
  if (b.readyAt) return 'Ready';
  return 'Draft';
}
function billLocked_(b) { return !!(b.miG || b.miN || b.vasyG || b.vasyN); }

/* ===================== READERS (never throw) ===================== */
function billReadBills_() {
  var out = [];
  try {
    var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BILL_TAB);
    if (!s || s.getLastRow() < 2) return out;
    var v = s.getRange(2, 1, s.getLastRow() - 1, BILL_HEADERS.length).getValues();
    for (var i = 0; i < v.length; i++) {
      var r = v[i]; if (!r[0]) continue;
      var b = { billId: String(r[0]), billNo: String(r[1] || ''), supplier: String(r[2] || ''), billDate: shpStr_(r[3]),
        supBillG: String(r[4] || ''), supBillN: String(r[5] || ''), roundG: Number(r[6]) || 0, roundN: Number(r[7]) || 0,
        chargesJson: String(r[8] || ''), totalsJson: String(r[9] || ''), readyAt: shpStr_(r[11]),
        miG: String(r[12] || ''), miN: String(r[13] || ''), miAt: shpStr_(r[14]), miBy: String(r[15] || ''),
        miOverride: String(r[16] || ''), vasyG: String(r[17] || ''), vasyN: String(r[18] || ''),
        vasyAt: shpStr_(r[19]), vasyBy: String(r[20] || ''), note: String(r[21] || ''),
        createdAt: String(r[22] || ''), updatedAt: String(r[23] || ''), by: String(r[24] || '') };
      b.status = billStatus_(b); b.locked = billLocked_(b);
      out.push(b);
    }
  } catch (e) { return []; }
  return out;
}
function billReadLines_() {
  var out = [];
  try {
    var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BILLL_TAB);
    if (!s || s.getLastRow() < 2) return out;
    var v = s.getRange(2, 1, s.getLastRow() - 1, BILLL_HEADERS.length).getValues();
    function nn(x) { return (x === '' || x == null) ? null : (Number(x) || 0); }
    for (var i = 0; i < v.length; i++) {
      var r = v[i]; if (!r[0] || !r[1]) continue;
      out.push({ lineId: String(r[0]), billId: String(r[1]), shipmentId: String(r[2] || ''), canon: shpCanon_(r[3]),
        code: String(r[4] || ''), name: String(r[5] || ''), poRef: String(r[6] || ''),
        qtyG: Number(r[7]) || 0, rateG: Number(r[8]) || 0, qtyN: Number(r[9]) || 0, rateN: Number(r[10]) || 0,
        tax: (r[11] === '' || r[11] == null) ? null : Number(r[11]),
        upName: String(r[12]).toLowerCase() === 'true' || r[12] === true, upCode: String(r[13] || ''),
        mrpG: nn(r[14]), spG: nn(r[15]), mrpN: nn(r[16]), spN: nn(r[17]),
        note: String(r[18] || ''), updatedAt: String(r[19] || ''), by: String(r[20] || '') });
    }
  } catch (e) { return []; }
  return out;
}

// bills that carry a shipment → [{billId, billNo, locked, miAny, canons:{canon:true}}]
function billsForShipment_(shipmentId) {
  var id = String(shipmentId || ''), map = {}, out = [];
  if (!id) return out;
  billReadLines_().forEach(function (l) {
    if (l.shipmentId !== id) return;
    (map[l.billId] = map[l.billId] || {})[l.canon] = true;
  });
  var ids = Object.keys(map); if (!ids.length) return out;
  var B = {}; billReadBills_().forEach(function (b) { B[b.billId] = b; });
  ids.forEach(function (bid) {
    var b = B[bid] || {};
    out.push({ billId: bid, billNo: b.billNo || '', locked: !!b.locked, miAny: !!(b.miG || b.miN), canons: map[bid] });
  });
  return out;
}

// billed qty (w + wo) per shipment|canon, optionally ignoring one bill
function billedByShipCode_(excludeBillId) {
  var out = {};
  billReadLines_().forEach(function (l) {
    if (excludeBillId && l.billId === excludeBillId) return;
    var k = l.shipmentId + '|' + l.canon;
    out[k] = (out[k] || 0) + l.qtyG + l.qtyN;
  });
  return out;
}
// shipped qty per shipment|canon (all allocation types)
function shippedByShipCode_() {
  var out = {};
  shpReadAllocs_().forEach(function (a) { var k = a.shipmentId + '|' + a.canon; out[k] = (out[k] || 0) + a.qty; });
  return out;
}

function billFindRow_(s, id) {
  if (!s || s.getLastRow() < 2) return { rowIx: 0, cur: null };
  var v = s.getRange(2, 1, s.getLastRow() - 1, BILL_HEADERS.length).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === id) return { rowIx: i + 2, cur: v[i], all: v };
  return { rowIx: 0, cur: null, all: v };
}
function billRowObj_(cur) {
  return { readyAt: cur[11], miG: String(cur[12] || ''), miN: String(cur[13] || ''),
    vasyG: String(cur[17] || ''), vasyN: String(cur[18] || '') };
}

/* ===================== VALIDATION ===================== */
function billValidate_(bill, existingId) {
  var errors = [], warnings = [];
  if (!bill || typeof bill !== 'object') return { errors: ['No bill supplied.'], warnings: [] };
  var id = String(bill.billId || '').trim();
  if (!id) errors.push('Bill ID is missing.');
  if (id.length > 80) errors.push('Bill ID is too long.');
  var lines = bill.lines || [];
  if (!lines.length && !existingId) errors.push('A new bill needs at least one product line.');
  if (bill.charges !== undefined && !Array.isArray(bill.charges)) errors.push('Charges must be a list.');
  if (!isFinite(billNumOr_(bill.roundG, 0)) || !isFinite(billNumOr_(bill.roundN, 0))) errors.push('Round-off must be a number.');

  var S = {}; shpReadShipments_().forEach(function (s) { S[s.shipmentId] = s; });
  var carries = {}; shpReadAllocs_().forEach(function (a) { carries[a.shipmentId + '|' + a.canon] = true; });
  var supplier = String(bill.supplier || '').trim();
  var mine = {}, seenSup = {};
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i] || {}, n = 'Line ' + (i + 1) + ': ';
    var sid = String(l.shipmentId || '').trim(), canon = shpCanon_(l.code);
    var qg = billNumOr_(l.qtyG, 0), qn = billNumOr_(l.qtyN, 0), rg = billNumOr_(l.rateG, 0), rn = billNumOr_(l.rateN, 0);
    var tax = billNumOr_(l.tax, 0);
    if (!sid) { errors.push(n + 'shipment is missing.'); continue; }
    var s = S[sid];
    if (!s) { errors.push(n + 'shipment ' + sid + ' was not found.'); continue; }
    if (s.status === 'Cancelled') errors.push(n + 'shipment ' + (s.shipmentNo || sid) + ' is cancelled.');
    if (!canon) errors.push(n + 'product code is missing.');
    else if (!carries[sid + '|' + canon]) errors.push(n + 'shipment ' + (s.shipmentNo || sid) + ' does not carry product ' + canon + '.');
    if (!(qg >= 0) || !(qn >= 0)) errors.push(n + 'quantities cannot be negative.');
    else if (!(qg + qn > 0)) errors.push(n + 'enter a w or wo quantity.');
    if (!(rg >= 0) || !(rn >= 0)) errors.push(n + 'rates cannot be negative.');
    if (!(tax >= 0 && tax <= 100)) errors.push(n + 'GST % must be between 0 and 100.');
    if (supplier && s.supplier && s.supplier !== supplier && !seenSup[sid]) {
      seenSup[sid] = true;
      warnings.push('Shipment ' + (s.shipmentNo || sid) + ' is from "' + s.supplier + '" but this bill is for "' + supplier + '".');
    }
    if (canon && qg + qn > 0) { var k = sid + '|' + canon; mine[k] = (mine[k] || 0) + qg + qn; }
  }
  // recheck flags: billed (all bills) vs shipped, per shipment + product touched by this bill
  var other = billedByShipCode_(existingId || id), shipped = shippedByShipCode_();
  Object.keys(mine).forEach(function (k) {
    var billed = (other[k] || 0) + mine[k], sh = shipped[k] || 0;
    if (Math.abs(billed - sh) > 0.0005) {
      var sid = k.split('|')[0], s = S[sid] || {};
      warnings.push('RECHECK ' + (s.shipmentNo || sid) + ' · ' + k.split('|')[1] + ': billed ' + billed +
        ' (all bills) but shipment has ' + sh + '.');
    }
  });
  return { errors: errors, warnings: warnings };
}

/* ===================== SAVE (upsert bill + replace its lines) ===================== */
// body = { bill:{ billId, supplier, billDate, supBillG, supBillN, roundG, roundN, charges:[…], totals:{…}, note,
//                 lines:[{ shipmentId, code, name, poRef, qtyG, rateG, qtyN, rateN, tax, upName, upCode,
//                          mrpG, spG, mrpN, spN, note }] }, by }
function apiBill_(body) {
  var bill = (body && body.bill) || null, by = String((body && body.by) || 'dashboard');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = shpSheet_(BILL_TAB, BILL_HEADERS, '#B45309', BILL_TEXT_COLS);
    var sl = shpSheet_(BILLL_TAB, BILLL_HEADERS, '#9A3412', BILLL_TEXT_COLS);
    var id = String((bill && bill.billId) || '').trim();
    var f = billFindRow_(s, id);
    if (f.cur && billLocked_(billRowObj_(f.cur)))
      return { ok: false, error: 'This bill is locked — a Vasy MI or bill number is recorded. Clear those numbers first to edit it.' };
    var chk = billValidate_(bill, f.rowIx ? id : '');
    if (chk.errors.length) return { ok: false, error: 'Bill not saved.', errors: chk.errors, warnings: chk.warnings };

    var ss = SpreadsheetApp.getActiveSpreadsheet(), tz = ss.getSpreadsheetTimeZone() || 'Asia/Kolkata';
    var prefix = 'BL-' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd') + '-', maxN = 0;
    (f.all || []).forEach(function (r) {
      var no = String(r[1] || '');
      if (no.indexOf(prefix) === 0) { var nn = parseInt(no.slice(prefix.length), 10); if (nn > maxN) maxN = nn; }
    });
    var cur = f.cur, now = new Date();
    var billNo = cur ? String(cur[1] || '') : '';
    if (!billNo) billNo = v11NextNo_(prefix, maxN);                              // [2.2] never reused
    var charges = '', totals = '';
    try { charges = JSON.stringify(bill.charges || []); } catch (e) { charges = '[]'; }
    try { totals = bill.totals ? JSON.stringify(bill.totals) : ''; } catch (e) { totals = ''; }
    var st = cur ? billStatus_({ readyAt: cur[11], miG: cur[12], miN: cur[13], vasyG: cur[17], vasyN: cur[18] }) : 'Draft';
    var vals = [id, billNo, String(bill.supplier || ''), String(bill.billDate || ''), String(bill.supBillG || ''),
      String(bill.supBillN || ''), billNumOr_(bill.roundG, 0), billNumOr_(bill.roundN, 0), charges, totals, st,
      cur ? cur[11] : '', cur ? cur[12] : '', cur ? cur[13] : '', cur ? cur[14] : '', cur ? cur[15] : '', cur ? cur[16] : '',
      cur ? cur[17] : '', cur ? cur[18] : '', cur ? cur[19] : '', cur ? cur[20] : '',
      String(bill.note || ''), cur ? (cur[22] || now) : now, now, by];
    if (f.rowIx) s.getRange(f.rowIx, 1, 1, BILL_HEADERS.length).setValues([vals]);
    else s.getRange(s.getLastRow() + 1, 1, 1, BILL_HEADERS.length).setValues([vals]);

    function nz(x) { return (x === '' || x == null) ? '' : Number(x); }
    var rows = (bill.lines || []).map(function (l, k) {
      return [id + '-' + (k + 1), id, String(l.shipmentId || '').trim(), shpCanon_(l.code), String(l.code || ''),
        String(l.name || ''), String(l.poRef || ''), billNumOr_(l.qtyG, 0), billNumOr_(l.rateG, 0),
        billNumOr_(l.qtyN, 0), billNumOr_(l.rateN, 0), (l.tax === '' || l.tax == null) ? '' : Number(l.tax),
        !!l.upName, String(l.upCode || ''), nz(l.mrpG), nz(l.spG), nz(l.mrpN), nz(l.spN), String(l.note || ''), now, by];
    });
    var removed = v11ReplaceRows_(sl, BILLL_HEADERS.length, function (r) { return String(r[1]) === id; }, rows).length;   // [2.6 R23] one block write
    if (typeof audit_ === 'function')
      audit_(by, 'BILL_UPSERT', 'Bill', id, '', cur ? 'updated' : '', billNo,
        rows.length + ' line(s)' + (chk.warnings.length ? ' · ' + chk.warnings.length + ' warning(s)' : ''));
    return { ok: true, billId: id, billNo: billNo, created: !cur, lines: rows.length, replacedLines: removed,
      status: st, warnings: chk.warnings };
  } finally { lock.releaseLock(); }
}

/* ===================== STAGES (set / reverse) ===================== */
// body = { billId, stage:'ready'|'mi'|'vasy', lane:'g'|'n' (mi/vasy), value:'…' ('' = reverse), override:true, by }
function apiBillStage_(body) {
  var id = String((body && body.billId) || '').trim(), stage = String((body && body.stage) || '');
  var lane = String((body && body.lane) || ''), by = String((body && body.by) || 'dashboard');
  var val = String((body && body.value) == null ? '' : body.value).trim();
  if (!id) return { ok: false, error: 'no billId' };
  if (['ready', 'mi', 'vasy'].indexOf(stage) < 0) return { ok: false, error: 'stage must be ready, mi or vasy' };
  if ((stage === 'mi' || stage === 'vasy') && lane !== 'g' && lane !== 'n') return { ok: false, error: 'lane must be g (w) or n (wo)' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BILL_TAB);
    var f = billFindRow_(s, id);
    if (!f.rowIx) return { ok: false, error: 'Bill not found.' };
    var cur = f.cur.slice(), now = new Date(), warnings = [], note = '';
    var laneName = lane === 'g' ? 'w (GST)' : 'wo (Non-GST)';
    if (stage === 'ready') {
      if (val) { if (!cur[11]) cur[11] = now; note = 'ready for upload'; }
      else {
        if (billLocked_(billRowObj_(cur))) return { ok: false, error: 'Clear the MI / Vasy numbers before un-marking "ready".' };
        cur[11] = ''; note = 'ready reversed';
      }
    } else if (stage === 'mi') {
      var ci = lane === 'g' ? 12 : 13, vi = lane === 'g' ? 17 : 18;
      if (val) {
        var lines = billReadLines_().filter(function (l) { return l.billId === id; });
        var hasLane = lines.some(function (l) { return (lane === 'g' ? l.qtyG : l.qtyN) > 0; });
        if (!hasLane) warnings.push('This bill has no ' + laneName + ' quantity.');
        var S = {}; shpReadShipments_().forEach(function (x) { S[x.shipmentId] = x; });
        var notArr = {};
        lines.forEach(function (l) { var x = S[l.shipmentId]; if (x && !x.arrivedAt) notArr[x.shipmentNo || x.shipmentId] = true; });
        var na = Object.keys(notArr);
        if (na.length && !(body && body.override === true))
          return { ok: false, needsOverride: true, error: 'Not arrived yet: ' + na.join(', ') +
            '. Mark the shipment(s) arrived, or use the manual override to record MI in advance.' };
        if (na.length) {
          cur[16] = 'override · ' + by + ' · ' + Utilities.formatDate(now, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' · not arrived: ' + na.join(', ');
          warnings.push('Recorded with manual override — not arrived: ' + na.join(', '));
        }
        cur[ci] = val; cur[14] = now; cur[15] = by; if (!cur[11]) cur[11] = now;
        note = 'MI ' + laneName + ' = ' + val + (na.length ? ' (override)' : '');
      } else {
        if (String(cur[vi] || '')) return { ok: false, error: 'Clear the Vasy bill number for ' + laneName + ' first.' };
        note = 'MI ' + laneName + ' cleared (was ' + cur[ci] + ')'; cur[ci] = '';
        if (!cur[12] && !cur[13]) { cur[14] = ''; cur[15] = ''; cur[16] = ''; }
      }
    } else {
      var vj = lane === 'g' ? 17 : 18, mj = lane === 'g' ? 12 : 13;
      if (val) {
        if (!String(cur[mj] || '')) warnings.push('No MI number recorded for ' + laneName + ' yet.');
        cur[vj] = val; cur[19] = now; cur[20] = by; if (!cur[11]) cur[11] = now;
        note = 'Vasy bill ' + laneName + ' = ' + val;
      } else {
        note = 'Vasy bill ' + laneName + ' cleared (was ' + cur[vj] + ')'; cur[vj] = '';
        if (!cur[17] && !cur[18]) { cur[19] = ''; cur[20] = ''; }
      }
    }
    cur[10] = billStatus_({ readyAt: cur[11], miG: cur[12], miN: cur[13], vasyG: cur[17], vasyN: cur[18] });
    cur[23] = now;
    s.getRange(f.rowIx, 1, 1, BILL_HEADERS.length).setValues([cur]);
    if (typeof audit_ === 'function') audit_(by, 'BILL_STAGE', 'Bill', id, stage + (lane ? ':' + lane : ''), '', val, note);
    return { ok: true, billId: id, billNo: String(cur[1] || ''), status: cur[10], warnings: warnings };
  } finally { lock.releaseLock(); }
}

/* ===================== UNASSIGN a shipment from a bill (shipment is NOT deleted) ===================== */
function apiBillUnassign_(body) {
  var id = String((body && body.billId) || '').trim(), sid = String((body && body.shipmentId) || '').trim();
  var by = String((body && body.by) || 'dashboard');
  if (!id || !sid) return { ok: false, error: 'billId and shipmentId are needed' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), f = billFindRow_(ss.getSheetByName(BILL_TAB), id);
    if (!f.rowIx) return { ok: false, error: 'Bill not found.' };
    if (billLocked_(billRowObj_(f.cur))) return { ok: false, error: 'This bill is locked — clear its MI / Vasy numbers first.' };
    var sl = ss.getSheetByName(BILLL_TAB), n = 0;
    if (sl && sl.getLastRow() > 1)
      n = v11ReplaceRows_(sl, BILLL_HEADERS.length, function (r) { return String(r[1]) === id && String(r[2]) === sid; }, []).length;   // [2.6 R23]
    if (n && typeof audit_ === 'function') audit_(by, 'BILL_UNASSIGN', 'Bill', id, 'shipment', sid, '', n + ' line(s) removed');
    return { ok: true, billId: id, shipmentId: sid, removedLines: n };
  } finally { lock.releaseLock(); }
}

/* ===================== DELETE a bill — only when empty and unlocked ===================== */
function apiBillDelete_(body) {
  var id = String((body && body.billId) || '').trim(), by = String((body && body.by) || 'dashboard');
  if (!id) return { ok: false, error: 'no billId' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BILL_TAB), f = billFindRow_(s, id);
    if (!f.rowIx) return { ok: false, error: 'Bill not found.' };
    if (billLocked_(billRowObj_(f.cur))) return { ok: false, error: 'This bill is locked — clear its MI / Vasy numbers first.' };
    var lines = billReadLines_().filter(function (l) { return l.billId === id; });
    if (lines.length) {
      var S = {}; shpReadShipments_().forEach(function (x) { S[x.shipmentId] = x.shipmentNo || x.shipmentId; });
      var sh = {}; lines.forEach(function (l) { sh[S[l.shipmentId] || l.shipmentId] = true; });
      return { ok: false, error: 'Unassign all shipments first — still assigned: ' + Object.keys(sh).join(', ') + '.' };
    }
    s.deleteRow(f.rowIx);
    if (typeof audit_ === 'function') audit_(by, 'BILL_DELETE', 'Bill', id, '', String(f.cur[1] || ''), 'deleted', '');
    return { ok: true, billId: id, deleted: true };
  } finally { lock.releaseLock(); }
}

/* ===================== SELF-TEST — TEST WORKBOOK ONLY ===================== */
function v11BillSelfTest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), lines = [], pass = 0, fail = 0;
  function log(x) { lines.push(x); Logger.log(x); }
  function check(name, ok, detail) { if (ok) pass++; else fail++; log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : '')); }
  if (ss.getId() !== V11_TEST_SHEET_ID) { log('STOPPED: this self-test only runs on the V1.1 TEST workbook. Nothing was changed.'); return lines.join('\n'); }
  log('V1.1 bill self-test · ' + V11_VERSION + ' · workbook: ' + ss.getName());
  var watch = ['PO Requests', 'PO Tracking', 'Receipts', 'PO Meta', 'Lots', 'Lot Lines', 'Products'];
  function counts() { var o = {}; watch.forEach(function (t) { var x = ss.getSheetByName(t); o[t] = x ? x.getLastRow() : -1; }); return o; }
  var before = counts();
  setupBillsV11();
  check('Bills + Bill Lines tabs exist', !!ss.getSheetByName(BILL_TAB) && !!ss.getSheetByName(BILLL_TAB));
  check('Shipments has Arrived At header', String(ss.getSheetByName(SHP_TAB).getRange(1, 13).getValue()) === 'Arrived At');

  var ord = shpOrderedByPoCode_(), keys = Object.keys(ord.qty), kA = null, kB = null;
  for (var i = 0; i < keys.length; i++) { if (!kA) { kA = keys[i]; continue; } if (keys[i].split('|')[0] !== kA.split('|')[0]) { kB = keys[i]; break; } }
  if (!kA || !kB) { log('STOPPED: need two POs in PO Tracking.'); return lines.join('\n'); }
  var poA = kA.split('|')[0], cA = kA.split('|')[1], poB = kB.split('|')[0], cB = kB.split('|')[1];
  log('Using ' + poA + ' / ' + cA + '  and  ' + poB + ' / ' + cB);
  var baseQ = shpQtyByPoCode_(), baseA = baseQ[kA] || { received: 0, shipped: 0 };
  var t = Date.now().toString(36), s1 = 'V11TEST-' + t + '-S1', s2 = 'V11TEST-' + t + '-S2', b1 = 'V11TEST-' + t + '-B1', b2 = 'V11TEST-' + t + '-B2';
  var sup = 'SELF TEST SUPPLIER';
  var r = apiShipment_({ by: 'v11BillSelfTest', shipment: { shipmentId: s1, supplier: sup, shipDate: '2026-10-05', expected: '2026-10-09',
    allocations: [{ type: 'PO', poNumber: poA, code: cA, qty: 5 }, { type: 'OFFPO', code: 'V11TESTX', name: 'test off-PO', qty: 2 }] } });
  var r2 = apiShipment_({ by: 'v11BillSelfTest', shipment: { shipmentId: s2, supplier: sup, shipDate: '2026-10-05',
    allocations: [{ type: 'PO', poNumber: poB, code: cB, qty: 3 }] } });
  check('Two test shipments saved', r.ok && r2.ok);

  function L(sid, code, qg, rg, qn, rn) { return { shipmentId: sid, code: code, qtyG: qg, rateG: rg, qtyN: qn, rateN: rn, tax: 18 }; }
  var bill = { billId: b1, supplier: sup, billDate: '2026-10-05', supBillG: 'SUPW-1', supBillN: 'SUPWO-1', roundG: 0.4, roundN: -0.2,
    charges: [{ name: 'Freight', amount: 150, gst: 18, lane: 'g' }], lines: [L(s1, cA, 5, 10, 0, 0), L(s1, 'V11TESTX', 0, 0, 2, 5), L(s2, cB, 3, 7, 0, 0)] };
  var rb = apiBill_({ by: 'v11BillSelfTest', bill: bill });
  check('Bill from 2 shipments saves', rb.ok, rb.ok ? rb.billNo : JSON.stringify(rb.errors));
  check('Bill number format BL-YYYYMMDD-NN', /^BL-\d{8}-\d{2,}$/.test(rb.billNo || ''), rb.billNo);
  check('Status Draft, no recheck warnings', rb.status === 'Draft' && !(rb.warnings || []).length, (rb.warnings || []).join(' | '));
  check('3 bill lines stored', billReadLines_().filter(function (l) { return l.billId === b1; }).length === 3);
  var stored = billReadBills_().filter(function (b) { return b.billId === b1; })[0] || {};
  check('Charges + round-off saved', /Freight/.test(stored.chargesJson || '') && stored.roundG === 0.4 && stored.roundN === -0.2);

  function bad(label, ln) { var x = apiBill_({ by: 'v11BillSelfTest', bill: { billId: 'V11TEST-' + t + '-BAD', supplier: sup, lines: [ln] } });
    check('Rejects ' + label, x.ok === false, (x.errors || [x.error]).join(' | ')); }
  bad('product the shipment does not carry', L(s1, cB, 1, 1, 0, 0));
  bad('unknown shipment', L('NOPE', cA, 1, 1, 0, 0));
  bad('zero quantity on both sides', L(s1, cA, 0, 1, 0, 1));
  bad('negative rate', L(s1, cA, 1, -1, 0, 0));

  var rq = apiBill_({ by: 'v11BillSelfTest', bill: { billId: b2, supplier: sup, lines: [L(s1, cA, 2, 10, 0, 0)] } });
  check('One shipment on a second bill saves, with RECHECK (7 billed vs 5 shipped)', rq.ok && (rq.warnings || []).some(function (w) { return /RECHECK/.test(w); }),
    (rq.warnings || []).join(' | '));
  var ub2 = apiBillUnassign_({ billId: b2, shipmentId: s1, by: 'v11BillSelfTest' });
  var db2 = apiBillDelete_({ billId: b2, by: 'v11BillSelfTest' });
  check('Unassign then delete the second bill', ub2.ok && ub2.removedLines === 1 && db2.ok);
  check('Shipment still exists after unassign', shpReadShipments_().some(function (x) { return x.shipmentId === s1; }));

  var st1 = apiBillStage_({ billId: b1, stage: 'ready', value: 'yes', by: 'v11BillSelfTest' });
  check('Mark ready → status Ready', st1.ok && st1.status === 'Ready');
  var mi0 = apiBillStage_({ billId: b1, stage: 'mi', lane: 'g', value: 'MI-W-1', by: 'v11BillSelfTest' });
  check('MI before arrival is refused', mi0.ok === false && mi0.needsOverride === true, mi0.error);
  var mi1 = apiBillStage_({ billId: b1, stage: 'mi', lane: 'g', value: 'MI-W-1', override: true, by: 'v11BillSelfTest' });
  check('MI with manual override → MI Uploaded', mi1.ok && mi1.status === 'MI Uploaded', (mi1.warnings || []).join(' | '));
  stored = billReadBills_().filter(function (b) { return b.billId === b1; })[0] || {};
  check('Override is recorded on the bill', /override/.test(stored.miOverride || ''), stored.miOverride);

  var e1 = apiBill_({ by: 'v11BillSelfTest', bill: bill });
  check('Locked bill: edit refused', e1.ok === false, e1.error);
  check('Locked bill: unassign refused', apiBillUnassign_({ billId: b1, shipmentId: s2, by: 'v11BillSelfTest' }).ok === false);
  check('Locked bill: delete refused', apiBillDelete_({ billId: b1, by: 'v11BillSelfTest' }).ok === false);
  var ds = apiShipmentDelete_({ shipmentId: s1, by: 'v11BillSelfTest' });
  check('Shipment on a bill: delete refused', ds.ok === false, ds.error);
  var cx = apiShipment_({ by: 'v11BillSelfTest', shipment: { shipmentId: s1, supplier: sup, status: 'Cancelled',
    allocations: [{ type: 'PO', poNumber: poA, code: cA, qty: 5 }, { type: 'OFFPO', code: 'V11TESTX', qty: 2 }] } });
  check('Shipment on a bill: cancel refused', cx.ok === false, (cx.errors || []).join(' | '));
  var rx = apiShipment_({ by: 'v11BillSelfTest', shipment: { shipmentId: s1, supplier: sup,
    allocations: [{ type: 'PO', poNumber: poA, code: cA, qty: 5 }] } });
  check('Shipment on a bill: removing a billed product refused', rx.ok === false, (rx.errors || []).join(' | '));
  var qx = apiShipment_({ by: 'v11BillSelfTest', shipment: { shipmentId: s1, supplier: sup, shipDate: '2026-10-05', expected: '2026-10-09',
    allocations: [{ type: 'PO', poNumber: poA, code: cA, qty: 5 }, { type: 'OFFPO', code: 'V11TESTX', qty: 2 }], note: 'qty edit ok' } });
  check('Shipment on a bill: editing other details still allowed', qx.ok, (qx.errors || []).join(' | '));

  var c1 = apiBillStage_({ billId: b1, stage: 'mi', lane: 'g', value: '', by: 'v11BillSelfTest' });
  check('Reverse MI → back to Ready, unlocked', c1.ok && c1.status === 'Ready');
  var a1 = apiShipmentArrive_({ shipmentId: s1, arrived: true, by: 'v11BillSelfTest' });
  check('Mark shipment 1 arrived', a1.ok && !!a1.arrivedAt);
  check('Status column shows Arrived', (shpReadShipments_().filter(function (x) { return x.shipmentId === s1; })[0] || {}).status === 'Arrived');
  var qa = shpQtyByPoCode_()[kA] || {};
  check('Arrived shipment counts as received', qa.received === (baseA.received || 0) + 5, 'received ' + qa.received);
  var dates = shpDatesByPoCode_()[kA] || {};
  check('Goods Check dates: ship + arrival date from the shipment', dates.shipped === '2026-10-05' && !!dates.received, JSON.stringify(dates));
  var mi2 = apiBillStage_({ billId: b1, stage: 'mi', lane: 'g', value: 'MI-W-1', by: 'v11BillSelfTest' });
  check('MI still refused while shipment 2 has not arrived', mi2.ok === false && mi2.needsOverride);
  apiShipmentArrive_({ shipmentId: s2, arrived: true, by: 'v11BillSelfTest' });
  var mi3 = apiBillStage_({ billId: b1, stage: 'mi', lane: 'g', value: 'MI-W-1', by: 'v11BillSelfTest' });
  var mi4 = apiBillStage_({ billId: b1, stage: 'mi', lane: 'n', value: 'MI-WO-1', by: 'v11BillSelfTest' });
  check('MI w + wo recorded after both arrived', mi3.ok && mi4.ok && mi4.status === 'MI Uploaded');
  var v1 = apiBillStage_({ billId: b1, stage: 'vasy', lane: 'g', value: 'VB-W-1', by: 'v11BillSelfTest' });
  check('Vasy bill w recorded → Bill Generated', v1.ok && v1.status === 'Bill Generated');
  check('Reverse arrival refused while MI recorded', apiShipmentArrive_({ shipmentId: s1, arrived: false, by: 'v11BillSelfTest' }).ok === false);
  check('Clear MI w refused while Vasy bill w recorded', apiBillStage_({ billId: b1, stage: 'mi', lane: 'g', value: '', by: 'v11BillSelfTest' }).ok === false);
  var rv = apiBillStage_({ billId: b1, stage: 'vasy', lane: 'g', value: '', by: 'v11BillSelfTest' });
  var rm1 = apiBillStage_({ billId: b1, stage: 'mi', lane: 'g', value: '', by: 'v11BillSelfTest' });
  var rm2 = apiBillStage_({ billId: b1, stage: 'mi', lane: 'n', value: '', by: 'v11BillSelfTest' });
  check('Full reversal → Ready again', rv.ok && rm1.ok && rm2.ok && rm2.status === 'Ready');
  check('Reverse arrival now allowed', apiShipmentArrive_({ shipmentId: s1, arrived: false, by: 'v11BillSelfTest' }).ok);
  check('Status back to In Transit after reversal', (shpReadShipments_().filter(function (x) { return x.shipmentId === s1; })[0] || {}).status === 'In Transit');

  check('Delete shipment 2 refused while assigned', apiShipmentDelete_({ shipmentId: s2, by: 'v11BillSelfTest' }).ok === false);
  check('Unassign shipment 2', apiBillUnassign_({ billId: b1, shipmentId: s2, by: 'v11BillSelfTest' }).ok);
  var dbx = apiBillDelete_({ billId: b1, by: 'v11BillSelfTest' });
  check('Delete bill refused while shipment 1 still assigned', dbx.ok === false, dbx.error);
  check('Unassign shipment 1', apiBillUnassign_({ billId: b1, shipmentId: s1, by: 'v11BillSelfTest' }).ok);
  check('Delete empty bill', apiBillDelete_({ billId: b1, by: 'v11BillSelfTest' }).ok);
  var d1 = apiShipmentDelete_({ shipmentId: s1, by: 'v11BillSelfTest' }), d2 = apiShipmentDelete_({ shipmentId: s2, by: 'v11BillSelfTest' });
  check('Delete both shipments', d1.ok && d2.ok);
  var left = shpReadShipments_().concat(shpReadAllocs_()).filter(function (x) { return String(x.shipmentId).indexOf('V11TEST-') === 0; }).length +
    billReadBills_().concat(billReadLines_()).filter(function (x) { return String(x.billId).indexOf('V11TEST-') === 0; }).length;
  check('No test rows left behind', left === 0, left + ' left');
  check('Quantities back to the starting values', JSON.stringify(shpQtyByPoCode_()[kA] || {}) === JSON.stringify(baseQ[kA] || {}));
  var after = counts();
  watch.forEach(function (tn) { check('Row count unchanged: ' + tn, after[tn] === before[tn], before[tn] + ' → ' + after[tn]); });
  log('RESULT: ' + pass + ' passed, ' + fail + ' failed' + (fail ? '  ← please send me this whole log' : '  ✔ all good'));
  return lines.join('\n');
}
