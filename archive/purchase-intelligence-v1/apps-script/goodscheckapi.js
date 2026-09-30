/************ Goods Check API — add to the PO-Request Apps Script project (v1) ************
 * Returns open-PO status for the read-only Goods Check tab: per PO, per line, with
 * PO/transit/received/pending quantities and the four dates (promised ship, shipped,
 * expected delivery, received). No supplier/rate/amount — quantity & status only.
 * Reuses the same sheet tabs the dashboard writes (PO Tracking, Receipts, Lots, Lot Lines, PO Meta).
 ****************************************************************************************/
function getGoodsCheck() {
  var track = (typeof readTrack_ === 'function') ? readTrack_() : [];
  var recv  = (typeof readRecv_  === 'function') ? readRecv_()  : [];
  if (!track.length) return [];

  // received qty per (PO + canonical code)
  var recvBy = {};
  recv.forEach(function (r) {
    var k = String(r.poNumber || '') + '|' + String(r.code || '').replace(/\/+$/, '');
    recvBy[k] = (recvBy[k] || 0) + (Number(r.recvQty) || 0);
  });

  var LL = readLotsFull_();          // shipped qty + lot dates per (PO|code)
  var META = readMetaLite_();        // promised (ship) date per PO number

  // group tracking rows by PO number (skip split parents — children hold the real qty)
  var byPo = {};
  track.forEach(function (t) {
    if (String(t.poStatus || '') === 'PO Split') return;
    var po = String(t.poNumber || '');
    var canon = String(t.code || '').replace(/\/+$/, '');
    var k = po + '|' + canon;
    var ordered  = Number(t.poQty) || 0;
    var received = Math.min(recvBy[k] || 0, ordered);
    var shipped  = (LL.ship[k] || 0);
    var transit  = Math.max(0, shipped - received);
    var pending  = Math.max(0, ordered - shipped);
    var lotDates = LL.dates[k] || { shipped: '', expected: '', received: '' };
    if (!byPo[po]) byPo[po] = {
      poNumber: po, realNo: String(t.realNo || ''), status: String(t.poStatus || ''),
      promisedShip: (META[po] && META[po].promised) || '',
      lines: [], T: { ord: 0, transit: 0, rec: 0, pending: 0 }
    };
    var e = byPo[po];
    e.lines.push({
      name: String(t.name || t.code || ''), code: canon, unit: String(t.unit || 'nos'),
      cat: String(t.cat || ''),
      ord: ordered, transit: transit, rec: received, pending: pending,
      shipped: lotDates.shipped || '', expected: lotDates.expected || '', received: lotDates.received || ''
    });
    e.T.ord += ordered; e.T.transit += transit; e.T.rec += received; e.T.pending += pending;
  });

  // keep only OPEN POs (something still pending or in transit)
  var out = [];
  Object.keys(byPo).forEach(function (po) {
    var e = byPo[po];
    if (e.T.pending > 0 || e.T.transit > 0) {
      // roll a friendly status
      if (e.T.rec > 0 && e.T.pending > 0) e.statusLabel = 'Partially received';
      else if (e.T.transit > 0 && e.T.pending === 0) e.statusLabel = 'In transit';
      else if (e.T.transit > 0) e.statusLabel = 'Part shipped';
      else e.statusLabel = (e.status === 'PO Sent') ? 'Sent' : 'Created';
      out.push(e);
    }
  });
  out.sort(function (a, b) { return String(a.realNo || a.poNumber).localeCompare(String(b.realNo || b.poNumber)); });
  return out;
}

// Lots reader that also returns the latest ship / expected-delivery / received dates per (PO|code)
function readLotsFull_() {
  var out = { ship: {}, dates: {} };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var s = ss.getSheetByName('Lots'), sl = ss.getSheetByName('Lot Lines');
    if (!s || !sl || s.getLastRow() < 2 || sl.getLastRow() < 2) return out;
    function dstr(d){ return (Object.prototype.toString.call(d)==='[object Date]')
      ? (d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2))
      : String(d||''); }
    var lm = {};
    var n = Math.max(15, s.getLastColumn());
    var v = s.getRange(2, 1, s.getLastRow() - 1, n).getValues();
    v.forEach(function (r) {
      if (!r[0]) return;
      lm[String(r[0])] = {
        date: dstr(r[3]),                       // Date (shipped)
        received: dstr(r[9]),                    // Received At
        expected: dstr(r[14])                    // Expected Delivery (col 15)
      };
    });
    var w = sl.getRange(2, 1, sl.getLastRow() - 1, 17).getValues();
    w.forEach(function (r) {
      var L = lm[String(r[0] || '')]; if (!L) return;
      var po = String(r[1] || ''), canon = String(r[3] || '').replace(/\/+$/, '');
      var qty = Number(r[5]) || 0;
      var k = po + '|' + canon;
      out.ship[k] = (out.ship[k] || 0) + qty;
      var d = out.dates[k] || { shipped: '', expected: '', received: '' };
      if (L.date && (!d.shipped || L.date > d.shipped)) d.shipped = L.date;
      if (!L.received && L.expected && (!d.expected || L.expected < d.expected)) d.expected = L.expected;
      if (L.received && (!d.received || L.received > d.received)) d.received = L.received;
      out.dates[k] = d;
    });
  } catch (e) {}
  return out;
}

// PO Meta reader — promised (ship) date per PO number
function readMetaLite_() {
  var out = {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var m = ss.getSheetByName('PO Meta');
    if (!m || m.getLastRow() < 2) return out;
    var v = m.getRange(2, 1, m.getLastRow() - 1, Math.max(5, m.getLastColumn())).getValues();
    v.forEach(function (r) {
      if (!r[0]) return;
      var d = r[4];   // Promised (col 5)
      var ds = (Object.prototype.toString.call(d) === '[object Date]')
        ? (d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2))
        : String(d || '');
      out[String(r[0])] = { promised: ds };
    });
  } catch (e) {}
  return out;
}