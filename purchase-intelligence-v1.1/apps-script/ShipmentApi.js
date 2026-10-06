/**
 * VITHYA TRADERS — PURCHASE INTELLIGENCE V1.1 · SHIPMENT API
 * ───────────────────────────────────────────────────────────
 * VERSION: V1.1 "Vaigai" · server 2.1  (2026-10)
 *   2.1 adds: Arrived At/By columns + mark-arrived (V1.1-06 interim), arrived = received,
 *   Excess counts as shipped/in transit (decision D1), bill-protection on delete / cancel /
 *   product removal (BillApi.gs), V1.1 shipment dates for Goods Check, old-lot lock switch.
 *   2.2 adds: numbers are NEVER reused (permanent per-day counter in Script Properties),
 *   Status column shows "Arrived" when marked arrived, PO delete on the server (apiPoDelete_)
 *   that refuses POs carried by a V1.1 shipment.
 *   2.3 adds: api=v11data — returns only the V1.1 data (fast refresh after a save).
 *   2.4 adds: UOM column on Shipment Allocations (unit can be changed per product on a shipment).
 *   2.5: (LiveApi) register-function name clash fixed; writes return fresh V1.1 data in the same reply.
 *
 * WHAT THIS FILE DOES
 *  V1.1-01  Two new tabs + server support for multi-PO shipments:
 *             Shipments              — one row per physical shipment
 *             Shipment Allocations   — one row per shipment × product × destination
 *                                      (Type = PO | EXCESS | OFFPO)
 *  V1.1-02  Read-time mapping of old V1 Lots: every V1 lot is treated as a one-PO
 *           shipment when quantities are calculated. Nothing is copied; the Lots /
 *           Lot Lines tabs are never written by this file.
 *  V1.1-04a True received quantity comes from Lots (lot marked received, qty − return),
 *           NOT from the Receipts tab (which repeats rows and logs shipped qty).
 *           See shpQtyByPoCode_().
 *
 * RULES THIS FILE KEEPS
 *  - Never edits PO Tracking, Receipts, PO Meta, Lots or Lot Lines.
 *  - Never changes a PO's ordered quantity (Excess / Off-PO stay separate).
 *  - A new shipment is always "In Transit". Arrival is recorded later (V1.1-06).
 *  - Readers never throw: a missing tab returns an empty list, so the dashboard
 *    sync can never break because of this file.
 *
 * Depends on helpers that already exist in LiveApi 7.2.js:
 *   readTrack_(), readLots_(), readLotLines_(), dstr_(), audit_()
 *
 * SETUP: run setupShipmentsV11() once (it only creates the two tabs if missing).
 */

var V11_VERSION = 'V1.1 "Vaigai" · server 2.7';
var V11_TEST_SHEET_ID = '1ojAFR5wv6tKt94CB0EwoEs14iCp7lPeRbnhBvjm6XX8';   // self-test runs ONLY here

var SHP_TAB  = 'Shipments';
var SHPA_TAB = 'Shipment Allocations';
var SHP_HEADERS  = ['Shipment ID', 'Shipment No', 'Supplier', 'Ship Date', 'Transport', 'LR No',
                    'Expected Delivery', 'Status', 'Note', 'Created At', 'Updated At', 'By', 'Arrived At', 'Arrived By'];
var SHPA_HEADERS = ['Allocation ID', 'Shipment ID', 'Type', 'PO Number', 'Canonical Code', 'Item Code',
                    'Item Name', 'Qty', 'Suggested Qty', 'Note', 'Updated At', 'By', 'UOM', 'Returned'];   // [2.6] N = qty sent back (converted V1 lots)
var SHP_TYPES    = { PO: true, EXCESS: true, OFFPO: true };
var SHP_STATUSES = { 'In Transit': true, 'Arrived': true, 'Cancelled': true };

/* ===================== SETUP ===================== */
function setupShipmentsV11() {
  var made = [];
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHP_TAB)) made.push(SHP_TAB);
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHPA_TAB)) made.push(SHPA_TAB);
  shpSheet_(SHP_TAB, SHP_HEADERS, '#0F766E', [1, 2, 4, 7]);
  shpSheet_(SHPA_TAB, SHPA_HEADERS, '#7C3AED', [1, 2, 4, 5, 6]);
  var msg = 'V1.1 Shipment tabs ready (' + V11_VERSION + '). ' +
    (made.length ? 'Created: ' + made.join(', ') + '.' : 'Both tabs already existed — nothing changed.') +
    ' No existing tab was touched.';
  Logger.log(msg);
  return msg;
}
// get-or-create a tab; header written only when the tab is empty; listed columns forced to plain text
function shpSheet_(name, headers, color, textCols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(name);
  if (!s) s = ss.insertSheet(name);
  if (s.getLastRow() > 0) {                                   // [2.1] add any header cells a newer version needs
    var have = s.getRange(1, 1, 1, headers.length).getValues()[0];
    for (var h = 0; h < headers.length; h++) {
      if (String(have[h] || '') === '') {
        s.getRange(1, h + 1, 1, headers.length - h).setValues([headers.slice(h)])
          .setFontWeight('bold').setBackground(color).setFontColor('#FFFFFF');
        break;
      }
    }
  }
  if (s.getLastRow() === 0) {
    s.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground(color).setFontColor('#FFFFFF');
    s.setFrozenRows(1);
    if (textCols && s.getMaxRows() > 1) {
      for (var i = 0; i < textCols.length; i++) {
        s.getRange(2, textCols[i], s.getMaxRows() - 1, 1).setNumberFormat('@');   // codes / IDs / dates stay text
      }
    }
  }
  return s;
}

/* ===================== SMALL HELPERS ===================== */
// [2.2] permanent per-day counter — a deleted number is never handed out again
function v11NextNo_(prefix, maxInSheet) {
  var p = PropertiesService.getScriptProperties(), key = 'V11_SEQ_' + prefix;
  var last = parseInt(p.getProperty(key) || '0', 10) || 0;
  var n = Math.max(last, maxInSheet || 0) + 1;
  p.setProperty(key, String(n));
  return prefix + ('0' + n).slice(-2);
}
// [2.2] PO numbers carried by live (not cancelled) V1.1 shipments → {poNumber: [shipmentNo…]}
function shpPoUse_() {
  var live = {}, out = {};
  shpReadShipments_().forEach(function (s) { if (s.status !== 'Cancelled') live[s.shipmentId] = s.shipmentNo || s.shipmentId; });
  shpReadAllocs_().forEach(function (a) {
    if (!live[a.shipmentId] || !a.poNumber) return;
    var l = out[a.poNumber] = out[a.poNumber] || [];
    if (l.indexOf(live[a.shipmentId]) < 0) l.push(live[a.shipmentId]);
  });
  return out;
}
function shpCanon_(c) { return String(c == null ? '' : c).replace(/\/+\s*$/, '').trim(); }
function shpStr_(v) { return (typeof dstr_ === 'function') ? dstr_(v) : String(v == null ? '' : v); }
function shpNum_(v) { var n = Number(v); return isFinite(n) ? n : NaN; }
/* [2.6 R23] remove every data row for which isGone(row) is true and append newRows — in ONE block write.
   Replaces the old one-deleteRow-per-line loops (each deleteRow costs ~0.2 s).
   Keeps any extra columns the sheet may have to the right. Returns the removed rows. */
function v11ReplaceRows_(sh, width, isGone, newRows) {
  newRows = newRows || [];
  var w = Math.max(width, sh.getLastColumn ? sh.getLastColumn() : width);
  var last = sh.getLastRow();
  var data = last > 1 ? sh.getRange(2, 1, last - 1, w).getValues() : [];
  var keep = [], gone = [];
  for (var i = 0; i < data.length; i++) (isGone(data[i]) ? gone : keep).push(data[i]);
  var add = newRows.map(function (r) { r = r.slice(); while (r.length < w) r.push(''); return r; });
  if (!gone.length) {
    if (add.length) sh.getRange(last + 1, 1, add.length, w).setValues(add);
    return gone;
  }
  var out = keep.concat(add);
  if (out.length) sh.getRange(2, 1, out.length, w).setValues(out);
  if (data.length > out.length) sh.getRange(2 + out.length, 1, data.length - out.length, w).clearContent();
  return gone;
}

/* ===================== READERS (never throw) ===================== */
function shpReadShipments_() {
  var out = [];
  try {
    var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHP_TAB);
    if (!s || s.getLastRow() < 2) return out;
    var v = s.getRange(2, 1, s.getLastRow() - 1, SHP_HEADERS.length).getValues();
    for (var i = 0; i < v.length; i++) {
      var r = v[i]; if (!r[0]) continue;
      out.push({ shipmentId: String(r[0]), shipmentNo: String(r[1] || ''), supplier: String(r[2] || ''),
        shipDate: shpStr_(r[3]), transport: String(r[4] || ''), lr: String(r[5] || ''),
        expected: shpStr_(r[6]), status: String(r[7] || 'In Transit'), note: String(r[8] || ''),
        createdAt: String(r[9] || ''), updatedAt: String(r[10] || ''), by: String(r[11] || ''),
        arrivedAt: shpStr_(r[12]), arrivedBy: String(r[13] || '') });
    }
  } catch (e) { return []; }
  return out;
}
function shpReadAllocs_() {
  var out = [];
  try {
    var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHPA_TAB);
    if (!s || s.getLastRow() < 2) return out;
    var v = s.getRange(2, 1, s.getLastRow() - 1, SHPA_HEADERS.length).getValues();
    for (var i = 0; i < v.length; i++) {
      var r = v[i]; if (!r[0] || !r[1]) continue;
      out.push({ allocId: String(r[0]), shipmentId: String(r[1]), type: String(r[2] || '').toUpperCase(),
        poNumber: String(r[3] || ''), canon: shpCanon_(r[4]), code: String(r[5] || ''), name: String(r[6] || ''),
        qty: Number(r[7]) || 0, suggestedQty: (r[8] === '' || r[8] == null) ? '' : (Number(r[8]) || 0),
        note: String(r[9] || ''), updatedAt: String(r[10] || ''), by: String(r[11] || ''), uom: String(r[12] || ''),
        ret: Number(r[13]) || 0 });                                                       // [2.6]
    }
  } catch (e) { return []; }
  return out;
}

/* ===================== V1.1-02 — OLD V1 LOTS, READ AS ONE-PO SHIPMENTS ===================== */
// Nothing is copied. Each V1 lot line becomes a virtual PO allocation at read time.
function shpLegacyAllocs_() {
  var out = [];
  try {
    var lots = (typeof readLots_ === 'function') ? readLots_() : [];
    var lines = (typeof readLotLines_ === 'function') ? readLotLines_() : [];
    var byId = {};
    lots.forEach(function (L) { byId[L.lotId] = L; });
    lines.forEach(function (x) {
      var L = byId[x.lotId]; if (!L) return;
      var qty = Number(x.qty) || 0;
      var recd = L.receivedAt ? Math.max(0, qty - (Number(x.ret) || 0)) : 0;
      out.push({ source: 'V1-LOT', shipmentId: 'LOT:' + x.lotId, lotId: x.lotId, type: 'PO',
        poNumber: String(x.poNumber || L.poNumber || ''), canon: shpCanon_(x.code), qty: qty,
        received: recd, receivedAt: L.receivedAt || '', shipDate: L.date || '' });
    });
  } catch (e) { return []; }
  return out;
}

/* ===================== COMBINED QUANTITIES per (PO Number | canonical code) ===================== */
// shippedPO = qty shipped AGAINST the PO (V1 lots + V1.1 PO-type allocations) — used for "pending"
// excess    = V1.1 EXCESS allocations that name this PO
// shipped   = shippedPO + excess  (decision D1: excess is physically on the way, so it counts as shipped)
// received  = V1 lots marked received (qty − return) + V1.1 arrived shipments (PO + EXCESS lines)
function shpQtyByPoCode_() {
  var out = {};
  function e(po, canon) {
    var k = String(po || '') + '|' + shpCanon_(canon);
    if (!out[k]) out[k] = { shipped: 0, shippedPO: 0, shippedV1: 0, shippedV11: 0, excess: 0, received: 0 };
    return out[k];
  }
  try {
    shpLegacyAllocs_().forEach(function (a) {
      var x = e(a.poNumber, a.canon);
      x.shipped += a.qty; x.shippedPO += a.qty; x.shippedV1 += a.qty; x.received += a.received;
    });
    var live = {}, arrived = {};
    shpReadShipments_().forEach(function (s) {
      if (s.status === 'Cancelled') return;
      live[s.shipmentId] = true;
      if (s.arrivedAt) arrived[s.shipmentId] = true;
    });
    shpReadAllocs_().forEach(function (a) {
      if (!live[a.shipmentId] || !a.poNumber) return;
      var x;
      if (a.type === 'PO') { x = e(a.poNumber, a.canon); x.shipped += a.qty; x.shippedPO += a.qty; x.shippedV11 += a.qty; }
      else if (a.type === 'EXCESS') { x = e(a.poNumber, a.canon); x.shipped += a.qty; x.excess += a.qty; }
      else return;
      if (arrived[a.shipmentId]) x.received += Math.max(0, a.qty - (a.ret || 0));   // [2.6] returns
    });
  } catch (err) {}
  return out;
}

// [2.1] V1.1 shipment dates per (PO|canon) for Goods Check — same rules as the V1 lot dates
function shpDatesByPoCode_() {
  var out = {};
  try {
    var S = {};
    shpReadShipments_().forEach(function (s) { if (s.status !== 'Cancelled') S[s.shipmentId] = s; });
    shpReadAllocs_().forEach(function (a) {
      var s = S[a.shipmentId]; if (!s || !a.poNumber || (a.type !== 'PO' && a.type !== 'EXCESS')) return;
      var k = a.poNumber + '|' + a.canon;
      var d = out[k] || { shipped: '', expected: '', received: '' };
      if (s.shipDate && (!d.shipped || s.shipDate > d.shipped)) d.shipped = s.shipDate;
      if (!s.arrivedAt && s.expected && (!d.expected || s.expected < d.expected)) d.expected = s.expected;
      if (s.arrivedAt && (!d.received || s.arrivedAt > d.received)) d.received = s.arrivedAt;
      out[k] = d;
    });
  } catch (e) {}
  return out;
}

// [2.1] old-lot lock — Script Property V11_LOT_LOCK = on  → server refuses NEW V1 lots
function v11LotLocked_() {
  try { return String(PropertiesService.getScriptProperties().getProperty('V11_LOT_LOCK') || '').toLowerCase() === 'on'; }
  catch (e) { return false; }
}
// [2.1] which bills carry this shipment (BillApi.gs). [] if BillApi is not installed.
function shpBills_(shipmentId) {
  return (typeof billsForShipment_ === 'function') ? billsForShipment_(shipmentId) : [];
}

// ordered qty per (PO|canon) from PO Tracking — rows repeat the full line qty per request line, so take MAX
function shpOrderedByPoCode_() {
  var out = {}, pos = {};
  try {
    var track = (typeof readTrack_ === 'function') ? readTrack_() : [];
    track.forEach(function (t) {
      var po = String(t.poNumber || ''); if (!po) return;
      pos[po] = true;
      if (String(t.poStatus || '') === 'PO Split') return;
      var k = po + '|' + shpCanon_(t.code);
      out[k] = Math.max(out[k] || 0, Number(t.poQty) || 0);
    });
  } catch (e) {}
  return { qty: out, pos: pos };
}

/* ===================== VALIDATION ===================== */
function shpValidate_(sh, existingId) {
  var errors = [], warnings = [];
  if (!sh || typeof sh !== 'object') return { errors: ['No shipment supplied.'], warnings: [] };
  var id = String(sh.shipmentId || '').trim();
  if (!id) errors.push('Shipment ID is missing.');
  if (id.length > 80) errors.push('Shipment ID is too long.');
  var status = String(sh.status || 'In Transit');
  if (!SHP_STATUSES[status]) errors.push('Status must be "In Transit", "Arrived" or "Cancelled" (got "' + status + '").');
  var al = sh.allocations || [];
  if (!al.length) errors.push('A shipment needs at least one product line.');

  var ord = shpOrderedByPoCode_();
  var qtyNow = shpQtyByPoCode_();
  // this shipment's own previously-saved PO allocations must not count twice during an edit
  var mine = {};
  if (existingId) {
    shpReadAllocs_().forEach(function (a) {
      if (a.shipmentId === existingId && a.type === 'PO' && a.poNumber) {
        var k = a.poNumber + '|' + a.canon; mine[k] = (mine[k] || 0) + a.qty;
      }
    });
  }
  var addPo = {};
  for (var i = 0; i < al.length; i++) {
    var a = al[i] || {}, n = 'Line ' + (i + 1) + ': ';
    var type = String(a.type || '').toUpperCase();
    var po = String(a.poNumber || '').trim();
    var canon = shpCanon_(a.code);
    var q = shpNum_(a.qty);
    if (!SHP_TYPES[type]) { errors.push(n + 'type must be PO, EXCESS or OFFPO (got "' + (a.type || '') + '").'); continue; }
    if (!canon) errors.push(n + 'product code is missing.');
    if (!(q > 0)) errors.push(n + 'quantity must be more than 0.');
    if (a.suggestedQty !== undefined && a.suggestedQty !== '' && a.suggestedQty !== null && !(shpNum_(a.suggestedQty) >= 0))
      errors.push(n + 'suggested quantity is not a valid number.');
    if (type === 'PO' && !po) errors.push(n + 'a PO allocation needs a PO number.');
    if (type === 'OFFPO' && po) errors.push(n + 'an Off-PO line must not have a PO number.');
    if (po && (type === 'PO' || type === 'EXCESS')) {
      if (!ord.pos[po]) warnings.push(n + 'PO ' + po + ' was not found in PO Tracking.');
      else if (ord.qty[po + '|' + canon] == null) warnings.push(n + 'product ' + canon + ' is not on PO ' + po + '.');
    }
    if (type === 'PO' && po && canon && q > 0) { var k2 = po + '|' + canon; addPo[k2] = (addPo[k2] || 0) + q; }
  }
  Object.keys(addPo).forEach(function (k) {
    var ordered = ord.qty[k];
    if (ordered == null) return;
    var already = ((qtyNow[k] && qtyNow[k].shippedPO) || 0) - (mine[k] || 0);
    var total = already + addPo[k];
    if (total > ordered) warnings.push(k.replace('|', ' · ') + ': PO allocations total ' + total +
      ' but only ' + ordered + ' ordered (' + (total - ordered) + ' over). Consider marking the extra as EXCESS.');
  });
  return { errors: errors, warnings: warnings };
}

/* ===================== WRITE: upsert one shipment + replace its allocations ===================== */
// body = { shipment:{ shipmentId, supplier, shipDate, transport, lr, expected, status, note,
//                     allocations:[{ type, poNumber, code, name, qty, suggestedQty, note }] }, by }
function apiShipment_(body) {
  var sh = (body && body.shipment) || null;
  var by = String((body && body.by) || 'dashboard');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = shpSheet_(SHP_TAB, SHP_HEADERS, '#0F766E', [1, 2, 4, 7]);
    var sa = shpSheet_(SHPA_TAB, SHPA_HEADERS, '#7C3AED', [1, 2, 4, 5, 6]);
    var id = String((sh && sh.shipmentId) || '').trim();

    // find existing row + the next human number for today
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tz = ss.getSpreadsheetTimeZone() || 'Asia/Kolkata';
    var prefix = 'SH-' + Utilities.formatDate(new Date(), tz, 'yyyyMMdd') + '-';
    var rowIx = 0, maxN = 0, cur = null;
    if (s.getLastRow() > 1) {
      var keys = s.getRange(2, 1, s.getLastRow() - 1, SHP_HEADERS.length).getValues();
      for (var i = 0; i < keys.length; i++) {
        if (id && String(keys[i][0]) === id) { rowIx = i + 2; cur = keys[i]; }
        var no = String(keys[i][1] || '');
        if (no.indexOf(prefix) === 0) { var nn = parseInt(no.slice(prefix.length), 10); if (nn > maxN) maxN = nn; }
      }
    }

    var chk = shpValidate_(sh, rowIx ? id : '');
    // [2.1] a shipment on a bill cannot be cancelled, and a product a bill uses cannot be removed
    if (rowIx) {
      var onBills = shpBills_(id);
      if (onBills.length) {
        var nums = onBills.map(function (b) { return b.billNo || b.billId; }).join(', ');
        if (String(sh.status || '') === 'Cancelled')
          chk.errors.push('This shipment is on bill ' + nums + '. Unassign it from the bill(s) before cancelling.');
        var keep = {};
        (sh.allocations || []).forEach(function (a) { keep[shpCanon_(a.code)] = true; });
        onBills.forEach(function (b) {
          Object.keys(b.canons).forEach(function (c) {
            if (!keep[c]) chk.errors.push('Product ' + c + ' is billed on ' + (b.billNo || b.billId) +
              ' from this shipment. Change or unassign it on the bill before removing it here.');
          });
        });
      }
    }
    if (chk.errors.length) return { ok: false, error: 'Shipment not saved.', errors: chk.errors, warnings: chk.warnings };

    var now = new Date();
    var shipNo = cur ? String(cur[1] || '') : '';
    if (!shipNo) shipNo = v11NextNo_(prefix, maxN);                            // [2.2] never reused
    var created = cur ? (cur[9] || now) : now;
    // [2.2] status: Cancelled if asked, otherwise derived from the arrival record
    var stOut = String(sh.status || '') === 'Cancelled' ? 'Cancelled' : ((cur && cur[12]) ? 'Arrived' : 'In Transit');
    var vals = [id, shipNo, String(sh.supplier || ''), String(sh.shipDate || ''), String(sh.transport || ''),
      String(sh.lr || ''), String(sh.expected || ''), stOut, String(sh.note || ''),
      created, now, by, cur ? (cur[12] || '') : '', cur ? (cur[13] || '') : ''];   // [2.1] arrival kept on edit
    if (rowIx) s.getRange(rowIx, 1, 1, SHP_HEADERS.length).setValues([vals]);
    else s.getRange(s.getLastRow() + 1, 1, 1, SHP_HEADERS.length).setValues([vals]);

    // replace this shipment's allocations — [2.6 R23] one block rewrite instead of one deleteRow per line
    var oldRet = {};
    (sa.getLastRow() > 1 ? sa.getRange(2, 1, sa.getLastRow() - 1, SHPA_HEADERS.length).getValues() : []).forEach(function (r) {
      if (String(r[1]) === id && Number(r[13])) oldRet[String(r[2]).toUpperCase() + '|' + String(r[3]) + '|' + shpCanon_(r[4])] = Number(r[13]);
    });
    var rows = (sh.allocations || []).map(function (a, k) {
      var sug = (a.suggestedQty === undefined || a.suggestedQty === null || a.suggestedQty === '') ? '' : Number(a.suggestedQty);
      var ty = String(a.type).toUpperCase(), po = String(a.poNumber || '').trim(), cn = shpCanon_(a.code);
      var ret = (a.ret != null && a.ret !== '') ? (Number(a.ret) || 0) : (oldRet[ty + '|' + po + '|' + cn] || '');   // returns survive an edit
      return [id + '-' + (k + 1), id, ty, po, cn,
        String(a.code || ''), String(a.name || ''), Number(a.qty), sug, String(a.note || ''), now, by, String(a.uom || ''), ret];
    });
    var removed = v11ReplaceRows_(sa, SHPA_HEADERS.length, function (r) { return String(r[1]) === id; }, rows).length;

    if (typeof audit_ === 'function')
      audit_(by, 'SHIPMENT_UPSERT', 'Shipment', id, '', cur ? 'updated' : '', shipNo,
        rows.length + ' allocation(s)' + (chk.warnings.length ? ' · ' + chk.warnings.length + ' warning(s)' : ''));
    return { ok: true, shipmentId: id, shipmentNo: shipNo, created: !cur, allocations: rows.length,
      replacedAllocations: removed, warnings: chk.warnings };
  } finally { lock.releaseLock(); }
}

/* ===================== DELETE one shipment + its allocations ===================== */
function apiShipmentDelete_(body) {
  var id = String((body && body.shipmentId) || '').trim();
  if (!id) return { ok: false, error: 'no shipmentId' };
  var by = String((body && body.by) || 'dashboard');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var onBills = shpBills_(id);                                              // [2.1]
    if (onBills.length) return { ok: false, error: 'This shipment is on bill ' +
      onBills.map(function (b) { return b.billNo || b.billId; }).join(', ') + '. Unassign it from the bill(s) first.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet(), nS = 0, nA = 0, shipNo = '';
    var s = ss.getSheetByName(SHP_TAB);
    if (s && s.getLastRow() > 1) {
      var v = s.getRange(2, 1, s.getLastRow() - 1, 2).getValues();
      for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]) === id) { shipNo = String(v[i][1] || ''); s.deleteRow(i + 2); nS++; }
    }
    var sa = ss.getSheetByName(SHPA_TAB);
    if (sa && sa.getLastRow() > 1) nA = v11ReplaceRows_(sa, SHPA_HEADERS.length, function (r) { return String(r[1]) === id; }, []).length;   // [2.6 R23]
    if (typeof audit_ === 'function' && (nS || nA))
      audit_(by, 'SHIPMENT_DELETE', 'Shipment', id, '', shipNo, 'deleted', nA + ' allocation(s) removed');
    return { ok: true, shipmentId: id, removedShipments: nS, removedAllocations: nA };
  } finally { lock.releaseLock(); }
}

/* ===================== [2.1] MARK ARRIVED / REVERSE (interim V1.1-06) ===================== */
// body = { shipmentId, arrived:true|false, by }
function apiShipmentArrive_(body) {
  var id = String((body && body.shipmentId) || '').trim();
  if (!id) return { ok: false, error: 'no shipmentId' };
  var on = !(body && body.arrived === false);
  var by = String((body && body.by) || 'dashboard');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHP_TAB);
    if (!s || s.getLastRow() < 2) return { ok: false, error: 'Shipment not found.' };
    shpSheet_(SHP_TAB, SHP_HEADERS, '#0F766E', [1, 2, 4, 7]);   // make sure the Arrived columns exist
    var v = s.getRange(2, 1, s.getLastRow() - 1, SHP_HEADERS.length).getValues(), rowIx = 0, cur = null;
    for (var i = 0; i < v.length; i++) if (String(v[i][0]) === id) { rowIx = i + 2; cur = v[i]; break; }
    if (!rowIx) return { ok: false, error: 'Shipment not found.' };
    if (String(cur[7]) === 'Cancelled') return { ok: false, error: 'This shipment is cancelled.' };
    if (!on) {
      var mi = shpBills_(id).filter(function (b) { return b.miAny; });
      if (mi.length) return { ok: false, error: 'Material Inward is already recorded on bill ' +
        mi.map(function (b) { return b.billNo || b.billId; }).join(', ') + '. Clear the MI number first.' };
    }
    var when = on ? (cur[12] || new Date()) : '';
    s.getRange(rowIx, 13, 1, 2).setValues([[when, on ? (cur[13] || by) : '']]);
    s.getRange(rowIx, 8).setValue(on ? 'Arrived' : 'In Transit');                // [2.2] readable status
    s.getRange(rowIx, 11).setValue(new Date());
    if (typeof audit_ === 'function') audit_(by, on ? 'SHIPMENT_ARRIVED' : 'SHIPMENT_ARRIVAL_REVERSED', 'Shipment', id, 'Arrived At',
      on ? '' : shpStr_(cur[12]), on ? shpStr_(when) : '', String(cur[1] || ''));
    return { ok: true, shipmentId: id, arrived: on, arrivedAt: on ? shpStr_(when) : '' };
  } finally { lock.releaseLock(); }
}

/* ===================== [2.2] DELETE A PO ON THE SERVER ===================== */
// body = { poNumbers:[…], by }  — removes the PO Tracking rows (and the PO Meta row) for those PO numbers.
// Refused when any of them is carried by a V1.1 shipment (delete or edit the shipment first).
// The dashboard deletes the PO's old V1 lots separately (api=lotDelete), as before.
function apiPoDelete_(body) {
  var list = ((body && body.poNumbers) || []).map(function (x) { return String(x || '').trim(); }).filter(String);
  var by = String((body && body.by) || 'dashboard');
  if (!list.length) return { ok: false, error: 'no poNumbers' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var use = shpPoUse_(), blocked = [];
    list.forEach(function (po) { if (use[po]) blocked.push(po + ' (on ' + use[po].join(', ') + ')'); });
    if (blocked.length) return { ok: false, error: 'This PO is on V1.1 shipment(s): ' + blocked.join('; ') +
      '. Delete those shipments, or remove this PO from them, first.' };
    var ss = SpreadsheetApp.getActiveSpreadsheet(), set = {}, nT = 0, nM = 0;
    list.forEach(function (po) { set[po] = true; });
    var t = ss.getSheetByName(TRACK_TAB);
    if (t && t.getLastRow() > 1) {
      var tv = t.getRange(2, 8, t.getLastRow() - 1, 1).getValues();
      for (var i = tv.length - 1; i >= 0; i--) if (set[String(tv[i][0])]) { t.deleteRow(i + 2); nT++; }
    }
    var m = ss.getSheetByName(META_TAB);
    if (m && m.getLastRow() > 1) {
      var mv = m.getRange(2, 1, m.getLastRow() - 1, 1).getValues();
      for (var j = mv.length - 1; j >= 0; j--) if (set[String(mv[j][0])]) { m.deleteRow(j + 2); nM++; }
    }
    if (typeof audit_ === 'function') audit_(by, 'PO_DELETE', 'PO', list.join(', '), '', '', 'deleted', nT + ' tracking row(s), ' + nM + ' meta row(s)');
    return { ok: true, poNumbers: list, removedTrackingRows: nT, removedMetaRows: nM };
  } finally { lock.releaseLock(); }
}

/* ===================== SELF-TEST — TEST WORKBOOK ONLY ===================== */
// Creates two temporary test shipments, checks everything, then deletes them.
// Refuses to run on any workbook other than the V1.1 TEST copy.
function v11SelfTest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lines = [], pass = 0, fail = 0;
  function log(s) { lines.push(s); Logger.log(s); }
  function check(name, ok, detail) {
    if (ok) pass++; else fail++;
    log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''));
  }
  if (ss.getId() !== V11_TEST_SHEET_ID) {
    log('STOPPED: this self-test only runs on the V1.1 TEST workbook. Nothing was changed.');
    return lines.join('\n');
  }
  log('V1.1 self-test · ' + V11_VERSION + ' · workbook: ' + ss.getName());

  var watch = ['PO Requests', 'PO Tracking', 'Receipts', 'PO Meta', 'Lots', 'Lot Lines', 'Products'];
  function counts() { var o = {}; watch.forEach(function (t) { var x = ss.getSheetByName(t); o[t] = x ? x.getLastRow() : -1; }); return o; }
  var before = counts();
  setupShipmentsV11();
  check('Shipments tab exists', !!ss.getSheetByName(SHP_TAB));
  check('Shipment Allocations tab exists', !!ss.getSheetByName(SHPA_TAB));

  // pick two real POs with a product each (skip split parents)
  var ord = shpOrderedByPoCode_();
  var keys = Object.keys(ord.qty);
  var kA = null, kB = null;
  for (var i = 0; i < keys.length; i++) {
    var po = keys[i].split('|')[0];
    if (!kA) { kA = keys[i]; continue; }
    if (po !== kA.split('|')[0]) { kB = keys[i]; break; }
  }
  if (!kA || !kB) { log('STOPPED: could not find two POs in PO Tracking to test with.'); return lines.join('\n'); }
  var poA = kA.split('|')[0], cA = kA.split('|')[1], poB = kB.split('|')[0], cB = kB.split('|')[1];
  log('Using PO A = ' + poA + ' / ' + cA + ' (ordered ' + ord.qty[kA] + ')   PO B = ' + poB + ' / ' + cB + ' (ordered ' + ord.qty[kB] + ')');

  var baseQ = shpQtyByPoCode_();
  var baseA = baseQ[kA] || { shipped: 0, shippedPO: 0, shippedV1: 0, received: 0 };
  var baseB = baseQ[kB] || { shipped: 0, shippedPO: 0, shippedV1: 0, received: 0 };
  var t = Date.now().toString(36);
  var id1 = 'V11TEST-' + t + '-1', id2 = 'V11TEST-' + t + '-2';

  // 1) one shipment, two POs + Excess + Off-PO
  var r1 = apiShipment_({ by: 'v11SelfTest', shipment: { shipmentId: id1, supplier: 'SELF TEST', shipDate: '2026-10-05',
    transport: 'test lorry', lr: 'LR-TEST', expected: '2026-10-08', note: 'automatic self-test — will be deleted',
    allocations: [
      { type: 'PO', poNumber: poA, code: cA, name: 'test A', qty: 10, suggestedQty: 10 },
      { type: 'PO', poNumber: poB, code: cB, name: 'test B', qty: 5, suggestedQty: 6 },
      { type: 'EXCESS', poNumber: poA, code: cA, name: 'test A extra', qty: 2 },
      { type: 'OFFPO', poNumber: '', code: 'V11TESTOFFPO', name: 'off-PO test item', qty: 3 } ] } });
  check('Save shipment covering 2 POs + Excess + Off-PO', r1 && r1.ok, r1 && (r1.ok ? r1.shipmentNo : JSON.stringify(r1.errors)));
  check('Shipment number format SH-YYYYMMDD-NN', r1 && /^SH-\d{8}-\d{2,}$/.test(r1.shipmentNo || ''), r1 && r1.shipmentNo);
  var S = shpReadShipments_().filter(function (x) { return x.shipmentId === id1; });
  check('Exactly one shipment row', S.length === 1);
  check('Status is In Transit', S.length === 1 && S[0].status === 'In Transit', S.length ? S[0].status : '');
  var A1 = shpReadAllocs_().filter(function (x) { return x.shipmentId === id1; });
  check('Four allocation rows saved', A1.length === 4, A1.length + ' rows');
  check('Off-PO line has no PO number', A1.some(function (a) { return a.type === 'OFFPO' && !a.poNumber; }));
  check('Suggested qty kept separately (B: 6 suggested, 5 entered)',
    A1.some(function (a) { return a.type === 'PO' && a.poNumber === poB && a.qty === 5 && a.suggestedQty === 6; }));

  // 2) edit: A from 10 to 8 — rows replaced, not duplicated
  var r2 = apiShipment_({ by: 'v11SelfTest', shipment: { shipmentId: id1, supplier: 'SELF TEST', shipDate: '2026-10-05',
    allocations: [
      { type: 'PO', poNumber: poA, code: cA, qty: 8, suggestedQty: 10 },
      { type: 'PO', poNumber: poB, code: cB, qty: 5 },
      { type: 'EXCESS', poNumber: poA, code: cA, qty: 2 },
      { type: 'OFFPO', code: 'V11TESTOFFPO', qty: 3 } ] } });
  var S2 = shpReadShipments_().filter(function (x) { return x.shipmentId === id1; });
  var A2 = shpReadAllocs_().filter(function (x) { return x.shipmentId === id1; });
  check('Edit saves', r2 && r2.ok, r2 && !r2.ok ? JSON.stringify(r2.errors) : '');
  check('Edit keeps the same shipment number', r2 && r1 && r2.shipmentNo === r1.shipmentNo);
  check('Edit does not duplicate the shipment row', S2.length === 1);
  check('Edit replaces allocations (still 4, A now 8)', A2.length === 4 &&
    A2.some(function (a) { return a.type === 'PO' && a.poNumber === poA && a.qty === 8; }), A2.length + ' rows');

  // 3) second shipment on the same PO
  var r3 = apiShipment_({ by: 'v11SelfTest', shipment: { shipmentId: id2, supplier: 'SELF TEST', shipDate: '2026-10-06',
    allocations: [{ type: 'PO', poNumber: poA, code: cA, qty: 4 }] } });
  check('Second shipment on the same PO saves', r3 && r3.ok);
  check('Second shipment gets the next number', r3 && r1 && r3.shipmentNo !== r1.shipmentNo, r3 && r3.shipmentNo);
  var q = shpQtyByPoCode_();
  var qA = q[kA] || {}, qB = q[kB] || {};
  check('PO A shipped (new shipments) = 8 + 4 = 12', qA.shippedV11 === 12, 'got ' + qA.shippedV11);
  check('PO A Excess = 2, counted in shipped but not in shippedPO (pending)', qA.excess === 2 &&
    qA.shipped === baseA.shipped + 14 && qA.shippedPO === (baseA.shippedPO || 0) + 12,
    'excess ' + qA.excess + ', shipped ' + qA.shipped + ' (was ' + baseA.shipped + ')');
  check('PO B shipped (new shipments) = 5', qB.shippedV11 === 5, 'got ' + qB.shippedV11);
  check('Old V1 lot quantities unchanged for A and B', qA.shippedV1 === baseA.shippedV1 && qB.shippedV1 === baseB.shippedV1);
  check('New shipments add nothing to received (In Transit)', qA.received === baseA.received && qB.received === baseB.received);

  // 3b) [2.2] a PO carried by a shipment cannot be deleted / removed on the server
  var pd = apiPoDelete_({ poNumbers: [poA], by: 'v11SelfTest' });
  check('Server PO delete refused while a shipment carries the PO', pd.ok === false, pd.error);
  var pr = apiRecord_({ removePoNumbers: [poA], rows: [], by: 'v11SelfTest' });
  check('Split/remove of that PO refused on the server', pr.ok === false, pr.error);

  // 4) validation — nothing may be written
  var nBefore = shpReadShipments_().length, aBefore = shpReadAllocs_().length;
  function bad(label, alloc) {
    var r = apiShipment_({ by: 'v11SelfTest', shipment: { shipmentId: 'V11TEST-' + t + '-BAD', allocations: [alloc] } });
    check('Rejects ' + label, r && r.ok === false, r && r.errors ? r.errors.join(' | ') : JSON.stringify(r));
  }
  bad('quantity 0', { type: 'PO', poNumber: poA, code: cA, qty: 0 });
  bad('PO line without PO number', { type: 'PO', poNumber: '', code: cA, qty: 1 });
  bad('Off-PO line with a PO number', { type: 'OFFPO', poNumber: poA, code: 'X', qty: 1 });
  bad('unknown type', { type: 'FREE', poNumber: poA, code: cA, qty: 1 });
  bad('missing product code', { type: 'OFFPO', code: '', qty: 1 });
  check('Rejected saves wrote nothing', shpReadShipments_().length === nBefore && shpReadAllocs_().length === aBefore);

  // 5) over-allocation is warned, not blocked
  var big = (ord.qty[kA] || 0) + 1000;
  var r5 = apiShipment_({ by: 'v11SelfTest', shipment: { shipmentId: id2, supplier: 'SELF TEST',
    allocations: [{ type: 'PO', poNumber: poA, code: cA, qty: big }] } });
  check('Over-allocation saves with a warning', r5 && r5.ok && (r5.warnings || []).length > 0,
    r5 && (r5.warnings || []).join(' | '));

  // 6) PO ordered qty untouched
  var ord2 = shpOrderedByPoCode_();
  check('PO A ordered qty unchanged', ord2.qty[kA] === ord.qty[kA], ord.qty[kA] + ' → ' + ord2.qty[kA]);

  // 7) delete both test shipments
  var d1 = apiShipmentDelete_({ shipmentId: id1, by: 'v11SelfTest' });
  var d2 = apiShipmentDelete_({ shipmentId: id2, by: 'v11SelfTest' });
  check('Delete test shipment 1', d1.ok && d1.removedShipments === 1 && d1.removedAllocations === 4,
    d1.removedShipments + ' / ' + d1.removedAllocations);
  check('Delete test shipment 2', d2.ok && d2.removedShipments === 1 && d2.removedAllocations === 1);
  var left = shpReadShipments_().filter(function (x) { return x.shipmentId.indexOf('V11TEST-') === 0; }).length +
    shpReadAllocs_().filter(function (x) { return x.shipmentId.indexOf('V11TEST-') === 0; }).length;
  check('No test rows left behind', left === 0, left + ' left');
  // 7b) [2.2] numbers are never reused after a delete
  var id3 = 'V11TEST-' + t + '-3';
  var r7 = apiShipment_({ by: 'v11SelfTest', shipment: { shipmentId: id3, supplier: 'SELF TEST', allocations: [{ type: 'OFFPO', code: 'V11TESTOFFPO', qty: 1 }] } });
  check('New shipment after deletes gets a NEW number (not reused)', r7.ok && r7.shipmentNo !== r1.shipmentNo && r7.shipmentNo !== r3.shipmentNo, r7.shipmentNo);
  apiShipmentDelete_({ shipmentId: id3, by: 'v11SelfTest' });
  var q2 = shpQtyByPoCode_();
  check('Quantities back to the starting values', JSON.stringify(q2[kA] || {}) === JSON.stringify(baseQ[kA] || {}) &&
    JSON.stringify(q2[kB] || {}) === JSON.stringify(baseQ[kB] || {}));

  // 8) existing tabs untouched
  var after = counts();
  watch.forEach(function (tn) { check('Row count unchanged: ' + tn, after[tn] === before[tn], before[tn] + ' → ' + after[tn]); });

  // 9) V1.1-02 legacy view totals (for comparison with Phase 0 diagnostic)
  var leg = shpLegacyAllocs_(), tShip = 0, tRec = 0, lotSet = {};
  leg.forEach(function (a) { tShip += a.qty; tRec += a.received; lotSet[a.lotId] = true; });
  log('INFO  Old V1 lots read as shipments: ' + Object.keys(lotSet).length + ' lots, ' + leg.length +
    ' lines, shipped ' + tShip + ', truly received ' + tRec);

  log('RESULT: ' + pass + ' passed, ' + fail + ' failed' + (fail ? '  ← please send me this whole log' : '  ✔ all good'));
  return lines.join('\n');
}
