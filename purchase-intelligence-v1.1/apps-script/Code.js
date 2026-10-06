/**
 * VITHYA TRADERS — PO REQUEST SYSTEM (server)
 * ───────────────────────────────────────────
 * VERSION:  VT-PO v9 "Thamirabarani"   (2026-07)
 * CHANGELOG (newest first):
 *   V1.1-04a "Vaigai" (2026-10) - getLineProgress(): received & shipped now come from
 *                shpQtyByPoCode_() (ShipmentApi.gs) — true received from V1 lots, not the
 *                Receipts tab (which repeats rows and logs shipped qty). Falls back to the old
 *                V1 path if ShipmentApi.gs is missing. Nothing else in this file changed.
 *   v9 Thamirabarani - [v4-D] w/wo chips; real shipped/lot data in progress bars
 *                (reads Lots + Lot Lines tabs when present); excess segment.
 *   v8 Narmada - [VT-016] getLineProgress(): per request line, the live order &
 *                receipt progress (ordered / received qty + PO numbers + status),
 *                derived from the dashboard's PO Tracking + Receipts tabs and shown
 *                read-only in the request app's Submissions view. No new sheet writes.
 *   v7 Krishna - [VT-015] Master "mrp" column split into GST MRP / NonGST MRP by the
 *                trailing "/" (same lane logic as price); both surfaced to the dashboard
 *                so the Material-Inward preview auto-fills MRP per lane.
 *   v6 Ganga   - Unique Line ID per row, employee-settable Status (+ custom
 *                status memory), GST/Non-GST treated as ONE canonical product
 *                (code minus trailing "/") with both lane prices surfaced.
 *   v5 Lalith  - Responsive submissions, expandable rows, submit reason hints.
 *   v4 Kaveri  - New-product flow (+ "New Product" column), already-requested
 *                product totals, name memory tab, rate-limited in-form sync.
 *   v3 Saravana- Master-sheet sync (by gid) + subcategory + nightly/manual sync.
 *   v2         - Web-app hosted form, locked PO numbering, drafts, submissions.
 *
 * SETUP: run setup() once (authorize), then "PO Form > Sync products now",
 *        then Deploy > Manage deployments > Edit > New version.
 *
 * NOTE: After replacing this file, run "PO Form > Sync products now" so the Products
 *       tab picks up the two new MRP columns, then redeploy a New version.
 */

var APP_VERSION = 'VT-PO v9 "Thamirabarani"';

var TABS = { REQ: 'PO Requests', PROD: 'Products', DRAFT: 'Drafts', SET: 'Settings', NAMES: 'Names', STATUSES: 'Statuses' };

var REQ_HEADERS = ['Line ID', 'PO Request No', 'Date & Time', 'User Name', 'Request Type', 'Urgency',
  'New Product', 'Product Code', 'Product Name', 'Quantity', 'Line Comment', 'Submission Comment', 'Status'];
var PROD_HEADERS = ['Canonical Code', 'Product Name', 'Brand', 'Category', 'Subcategory',
  'GST Code', 'GST Price', 'NonGST Code', 'NonGST Price', 'GST MRP', 'NonGST MRP',   // VT-015
  'GST Selling', 'NonGST Selling', 'Unit', 'GST %', 'Source'];                          // [V1.1.2 R34] MRP + Selling are GST-INCLUSIVE; Price = cost, excl GST

var DEFAULT_STATUSES = ['Pending', 'Product Received', 'PO Created', 'Delete Requested'];

var MASTER_ID = '1fVUY4JinmlovVLfQO6fkDL8ghElDeslCr_pZDHYpq7s';
var MASTER_GID = 2046213878;
var MASTER_MAP = [
  ['Product Name', 'description'], ['Code', 'code no'], ['Brand', 'brand'],
  ['Category', 'category'], ['Subcategory', 'subcategory'], ['Price', 'no tax'],
  ['MRP', 'mrp']   // VT-015 — single master column, split by lane in syncProducts()
];

var SYNC_COOLDOWN_MIN = 30;

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var req = getOrCreate_(ss, TABS.REQ);
  setHeader_(req, REQ_HEADERS, '#D23023'); req.setFrozenRows(1);

  var prod = getOrCreate_(ss, TABS.PROD);
  setHeader_(prod, PROD_HEADERS, '#736F64'); prod.setFrozenRows(1);
  if (prod.getLastRow() < 2) {
    prod.getRange(2, 1, 3, PROD_HEADERS.length).setValues([
      ['18429640', '19*26*21(31.5*3) MM GODAVARI T BUSH', 'Godavari', 'RUBBER BUSH', 'GM T BUSH', '18429640', 42, '18429640/', 40, '', ''],
      ['18429210', '25*32*28 MM CRI T BUSH', 'CRI', 'RUBBER BUSH', 'GM T BUSH', '18429210', 55, '', '', '', ''],
      ['17320011', '6203 ZZ TEXMO BEARING', 'Texmo', 'BEARING', 'BALL BEARING', '17320011', 120, '', '', '', '']
    ].map(function (r) { while (r.length < PROD_HEADERS.length) r.push(''); return r; }));
  }

  var dr = getOrCreate_(ss, TABS.DRAFT);
  if (dr.getLastRow() === 0) { dr.appendRow(['User Key', 'User Name', 'Draft JSON', 'Last Updated']); dr.setFrozenRows(1); }

  var nm = getOrCreate_(ss, TABS.NAMES);
  if (nm.getLastRow() === 0) { nm.appendRow(['Name Key', 'Name']); nm.setFrozenRows(1); }

  var sst = getOrCreate_(ss, TABS.STATUSES);
  if (sst.getLastRow() === 0) {
    sst.appendRow(['Status Key', 'Status']);
    DEFAULT_STATUSES.forEach(function (s) { sst.appendRow([s.toLowerCase(), s]); });
    sst.setFrozenRows(1);
  }

  var st = getOrCreate_(ss, TABS.SET);
  if (st.getLastRow() === 0) {
    st.getRange('A1:B1').setValues([['Last PO Date', 'Counter']]);
    st.getRange('A2:B2').setValues([['', 0]]);
  }

  installTriggers_();
  return 'Setup complete';
}

function setHeader_(sh, headers, color) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground(color).setFontColor('#FFFFFF');
}
function getOrCreate_(ss, name) { return ss.getSheetByName(name) || ss.insertSheet(name); }

function installTriggers_() {
  var trigs = ScriptApp.getProjectTriggers();
  for (var i = 0; i < trigs.length; i++) if (trigs[i].getHandlerFunction() === 'syncProducts') ScriptApp.deleteTrigger(trigs[i]);
  ScriptApp.newTrigger('syncProducts').timeBased().everyDays(1).atHour(2).create();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('PO Form')
    .addItem('Sync products now', 'syncProductsMenu')
    .addSeparator()
    .addItem('Run setup (first time / after edits)', 'setup')
    .addToUi();
}

// [V1.1.2 R34] Supabase first (ProductsApi.gs), master sheet fills the gaps. If ProductsApi.gs is
// not installed, or Supabase cannot be reached, the old master-only sync runs exactly as before.
// Switch: Script Property V11_PRODUCTS_SB = on  (off / missing = old master-only sync, exactly as before).
function syncProducts() {
  var on = false;
  try { on = String(PropertiesService.getScriptProperties().getProperty('V11_PRODUCTS_SB') || '').toLowerCase() === 'on'; } catch (e) {}
  if (on && typeof syncProductsV11_ === 'function') return syncProductsV11_();
  return syncProductsMasterOnly_();
}
// master sheet → { canon: {name, brand, cat, subcat, gstCode, gstPrice, nonCode, nonPrice, gstMrp, nonMrp} }
function readMasterByCanon_() {
  var master = SpreadsheetApp.openById(MASTER_ID);
  var sheets = master.getSheets(), src = null;
  for (var i = 0; i < sheets.length; i++) if (sheets[i].getSheetId() === MASTER_GID) { src = sheets[i]; break; }
  if (!src) src = sheets[0];

  var data = src.getDataRange().getValues();
  if (data.length < 2) throw new Error('Master sheet tab has no data rows.');
  var hdr = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  function findCol(name) {
    var n = name.toLowerCase().trim(), i = hdr.indexOf(n);
    if (i >= 0) return i;
    var nd = n.replace(/\s+/g, '');
    for (var j = 0; j < hdr.length; j++) if (hdr[j].replace(/\s+/g, '') === nd) return j;
    return -1;
  }
  var idx = {}, missing = [];
  for (var m = 0; m < MASTER_MAP.length; m++) {
    var c = findCol(MASTER_MAP[m][1]); if (c < 0) missing.push(MASTER_MAP[m][1]); idx[MASTER_MAP[m][0]] = c;
  }
  if (missing.length) throw new Error('Columns not found in master sheet: ' + missing.join(', '));

  var byCanon = {};
  for (var r = 1; r < data.length; r++) {
    var rawCode = String(data[r][idx['Code']] || '').trim();
    var name = String(data[r][idx['Product Name']] || '').trim();
    if (!name) continue;
    var isNonGst = /\/\s*$/.test(rawCode);
    var canon = rawCode.replace(/\/+\s*$/, '').trim() || ('NM:' + name.toLowerCase());
    if (!byCanon[canon]) {
      byCanon[canon] = {
        name: name, brand: String(data[r][idx['Brand']] || '').trim(),
        cat: String(data[r][idx['Category']] || '').trim(), subcat: String(data[r][idx['Subcategory']] || '').trim(),
        gstCode: '', gstPrice: '', nonCode: '', nonPrice: '', gstMrp: '', nonMrp: ''   // VT-015
      };
    }
    var rec = byCanon[canon];
    if (!rec.name) rec.name = name;
    var price = data[r][idx['Price']];
    var mrp = data[r][idx['MRP']];                                                       // VT-015
    if (isNonGst) { rec.nonCode = rawCode; rec.nonPrice = price; rec.nonMrp = mrp; }      // VT-015
    else { rec.gstCode = rawCode || canon; rec.gstPrice = price; rec.gstMrp = mrp; }      // VT-015
  }
  return byCanon;
}
function syncProductsMasterOnly_() {
  var byCanon = readMasterByCanon_();

  var out = [];
  for (var canonKey in byCanon) {
    if (!byCanon.hasOwnProperty(canonKey)) continue;
    var rec = byCanon[canonKey];
    out.push([canonKey, rec.name, rec.brand, rec.cat, rec.subcat, rec.gstCode, rec.gstPrice, rec.nonCode, rec.nonPrice, rec.gstMrp, rec.nonMrp,   // VT-015
      '', '', '', '', 'Master']);                                                          // [V1.1.2]
  }

  var dest = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.PROD);
  if (dest.getLastRow() > 1) dest.getRange(2, 1, dest.getLastRow() - 1, PROD_HEADERS.length).clearContent();
  if (out.length) dest.getRange(2, 1, out.length, PROD_HEADERS.length).setValues(out);

  var st = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.SET);
  st.getRange('A4:B4').setValues([['Last product sync', new Date()]]);
  st.getRange('A5:B5').setValues([['Products synced', out.length]]);
  return out.length;
}
function syncProductsMenu() {
  try { var n = syncProducts(); SpreadsheetApp.getActiveSpreadsheet().toast('Synced ' + n + ' canonical products.', 'PO Form', 6); }
  catch (e) { SpreadsheetApp.getUi().alert('Sync failed: ' + e.message); }
}
function syncFromForm() {
  var st = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.SET);
  var last = st.getRange('A6').getValue();
  var lastMs = (last instanceof Date) ? last.getTime() : 0;
  var mins = (Date.now() - lastMs) / 60000;
  if (lastMs && mins < SYNC_COOLDOWN_MIN) return { skipped: true, agoMin: Math.round(mins) };
  var n = syncProducts();
  st.getRange('A6:B6').setValues([[new Date(), 'in-form sync']]);
  return { skipped: false, count: n };
}


function prodNum_(v) { return (v === '' || v == null || isNaN(Number(v))) ? '' : Number(v); }
function getProducts() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.PROD);
  if (!sh || sh.getLastRow() < 2) return [];
  var nc = Math.min(PROD_HEADERS.length, sh.getMaxColumns());                          // [V1.1.2] older tabs have 11 columns
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, nc).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var name = String(vals[i][1] || '').trim(); if (!name) continue;
    var gstPrice = vals[i][6], nonPrice = vals[i][8];
    var gstMrp = vals[i][9], nonMrp = vals[i][10];                                        // VT-015
    out.push({
      code: String(vals[i][0] || '').trim(),
      name: name, brand: String(vals[i][2] || '').trim(),
      category: String(vals[i][3] || '').trim(), subcategory: String(vals[i][4] || '').trim(),
      gstCode: String(vals[i][5] || '').trim(),
      gstPrice: (gstPrice === '' || gstPrice == null) ? '' : Number(gstPrice),
      nonCode: String(vals[i][7] || '').trim(),
      nonPrice: (nonPrice === '' || nonPrice == null) ? '' : Number(nonPrice),
      gstMrp: (gstMrp === '' || gstMrp == null) ? '' : Number(gstMrp),                    // VT-015
      nonMrp: (nonMrp === '' || nonMrp == null) ? '' : Number(nonMrp),                    // VT-015
      gstSp: prodNum_(vals[i][11]), nonSp: prodNum_(vals[i][12]),                                 // [V1.1.2 R34] selling, incl GST
      unit: String(vals[i][13] == null ? '' : vals[i][13]).trim(), gstPct: prodNum_(vals[i][14]),
      source: String(vals[i][15] == null ? '' : vals[i][15]).trim()
    });
  }
  return out;
}

// [VT-016] Live order + receipt progress per request line, derived from the dashboard's
// PO Tracking + Receipts tabs (same spreadsheet). Reuses LiveApi_v2.gs readers when present.
// Returns { lineId: { ordered, received, status, pos:[{poNumber,realNo,status,lane,expected,ordered,received}] } }.

// [v4-D] lightweight lot info for the request app — shipped qty + lot list per (PO, product)
function readLotsLite_() {
  var out = { ship: {}, lots: {} };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var s = ss.getSheetByName('Lots'), sl = ss.getSheetByName('Lot Lines');
    if (!s || !sl || s.getLastRow() < 2 || sl.getLastRow() < 2) return out;
    var lm = {};
    var v = s.getRange(2, 1, s.getLastRow() - 1, 14).getValues();
    var conv = (typeof lotConvSet_ === 'function') ? lotConvSet_() : {};   // [V1.1.2 R09] converted lots are V1.1 shipments now
    v.forEach(function (r) {
      if (!r[0] || conv[String(r[0])]) return;
      var d = r[3];
      var ds = (Object.prototype.toString.call(d) === '[object Date]')
        ? (d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2))
        : String(d || '');
      lm[String(r[0])] = { no: String(r[2] || ''), date: ds, recd: !!String(r[9] || '') };
    });
    var w = sl.getRange(2, 1, sl.getLastRow() - 1, 17).getValues();
    w.forEach(function (r) {
      var L = lm[String(r[0] || '')]; if (!L) return;
      var po = String(r[1] || ''), canon = String(r[3] || '').replace(/\/+\s*$/, '');
      var qty = Number(r[5]) || 0;
      var k = po + '|' + canon;
      out.ship[k] = (out.ship[k] || 0) + qty;
      (out.lots[k] = out.lots[k] || []).push({ no: L.no, date: L.date, recd: L.recd, qty: qty });
    });
    // [V1.1.2] V1.1 shipments are listed with the old lots (request app shows SH numbers too)
    try {
      if (typeof shpReadShipments_ === 'function') {
        var S = {}; shpReadShipments_().forEach(function (x) { if (x.status !== 'Cancelled') S[x.shipmentId] = x; });
        shpReadAllocs_().forEach(function (a) {
          var sh = S[a.shipmentId]; if (!sh || !a.poNumber || (a.type !== 'PO' && a.type !== 'EXCESS')) return;
          var k2 = a.poNumber + '|' + a.canon;
          (out.lots[k2] = out.lots[k2] || []).push({ no: sh.shipmentNo || sh.shipmentId, date: sh.shipDate || '', recd: !!sh.arrivedAt, qty: a.qty });
        });
      }
    } catch (e2) {}
    Object.keys(out.lots).forEach(function (k) { out.lots[k].sort(function (a, b) { return String(a.no).localeCompare(String(b.no)); }); });
  } catch (e) {}
  return out;
}
function getLineProgress() {
  var track = (typeof readTrack_ === 'function') ? readTrack_() : [];
  var recv  = (typeof readRecv_  === 'function') ? readRecv_()  : [];
  if (!track.length) return {};
  // [V1.1-04a] true shipped / received per (PO + canonical code); old Receipts path only as fallback
  var Q = (typeof shpQtyByPoCode_ === 'function') ? shpQtyByPoCode_() : null;
  // received qty per (PO number + canonical code)
  var recvBy = {};
  if (!Q) recv.forEach(function (r) {
    var k = String(r.poNumber || '') + '|' + String(r.code || '').replace(/\/+\s*$/, '');
    recvBy[k] = (recvBy[k] || 0) + (Number(r.recvQty) || 0);
  });
  var LL = readLotsLite_();   // [v4-D] real shipped/lot data
  var RANK = { 'PO Created': 1, 'PO Sent': 2, 'PO Split': 2, 'Shipped': 3, 'Received': 4, 'Closed': 5 };
  var byLine = {};
  track.forEach(function (t) {
    var lid = String(t.lineId || ''); if (!lid) return;
    if (String(t.poStatus || '') === 'PO Split') return;   // split parents carry no real qty; children do
    var canon = String(t.code || '').replace(/\/+\s*$/, '');
    var qk = String(t.poNumber || '') + '|' + canon;                                       // [V1.1-04a]
    var received = Q ? ((Q[qk] && Q[qk].received) || 0) : (recvBy[qk] || 0);
    if (!byLine[lid]) byLine[lid] = { ordered: 0, received: 0, status: '', _rank: 99, pos: [] };
    var e = byLine[lid];
    e.ordered += Number(t.poQty) || 0;
    e.received += received;
    var lk = String(t.poNumber || '') + '|' + canon;
    e.pos.push({ poNumber: String(t.poNumber || ''), realNo: String(t.realNo || ''),
      status: String(t.poStatus || ''), lane: String(t.lane || ''), expected: String(t.expected || ''),
      ordered: Number(t.poQty) || 0, received: received,
      shipped: Q ? ((Q[lk] && Q[lk].shipped) || 0) : (LL.ship[lk] || 0), lots: LL.lots[lk] || [] });   // [V1.1-04a]
    var rnk = RANK[String(t.poStatus || '')] || 1;
    if (rnk < e._rank) { e._rank = rnk; e.status = String(t.poStatus || ''); }
  });
  Object.keys(byLine).forEach(function (lid) {
    var e = byLine[lid];
    if (e.ordered > 0 && e.received >= e.ordered) e.status = 'Received';
    else if (e.received > 0) e.status = 'Partially received';
    delete e._rank;
  });
  return byLine;
}

function getProductTotals() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.REQ);
  if (!sh || sh.getLastRow() < 2) return {};
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, REQ_HEADERS.length).getValues();
  var map = {};
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i]; if (!r[0]) continue;
    var type = String(r[4]); var code = String(r[7] || '').trim(); var name = String(r[8] || '').trim();
    var qty = Number(r[9]) || 0;
    if (!name && !code) continue;
    var key = code ? ('c:' + code) : ('n:' + name.toLowerCase());
    if (!map[key]) map[key] = { total: 0, 'No Stock': 0, 'Stock Planning': 0, 'Customer Order': 0 };
    map[key].total += qty;
    if (map[key][type] != null) map[key][type] += qty;
  }
  return map;
}

function getNames() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.NAMES);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) { var n = String(vals[i][0] || '').trim(); if (n) out.push(n); }
  out.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
  return out;
}
function addName_(name) {
  name = String(name || '').trim(); if (!name) return;
  var key = name.toLowerCase();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.NAMES);
  var last = sh.getLastRow();
  if (last >= 2) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) if (String(keys[i][0]).toLowerCase() === key) return;
  }
  sh.appendRow([key, name]);
}

function getStatuses() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.STATUSES);
  if (!sh || sh.getLastRow() < 2) return DEFAULT_STATUSES.slice();
  var vals = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) { var s = String(vals[i][0] || '').trim(); if (s) out.push(s); }
  return out;
}
function addStatus_(status) {
  status = String(status || '').trim(); if (!status) return;
  var key = status.toLowerCase();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.STATUSES);
  var last = sh.getLastRow();
  if (last >= 2) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) if (String(keys[i][0]).toLowerCase() === key) return;
  }
  sh.appendRow([key, status]);
}
function setLineStatus(lineId, status) {
  if (!lineId) throw new Error('Missing line ID.');
  status = String(status || '').trim();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.REQ);
  var last = sh.getLastRow();
  if (last < 2) throw new Error('No requests found.');
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(lineId)) {
      sh.getRange(i + 2, REQ_HEADERS.length).setValue(status);
      addStatus_(status);
      return { ok: true };
    }
  }
  throw new Error('Line not found — it may have been removed from the sheet.');
}

function submitRequest(payload) {
  if (!payload || !payload.userName || !payload.lines || !payload.lines.length) throw new Error('Missing name or products.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tz = ss.getSpreadsheetTimeZone();
    var now = new Date();
    var today = Utilities.formatDate(now, tz, 'yyyyMMdd');
    var dt = Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm');

    var st = ss.getSheetByName(TABS.SET);
    var lastDate = String(st.getRange('A2').getValue() || '');
    var counter = Number(st.getRange('B2').getValue() || 0);
    if (lastDate !== today) counter = 0;
    counter++;
    st.getRange('A2:B2').setValues([[today, counter]]);
    var po = 'PR-' + today + '-' + ('000' + counter).slice(-3);

    var rows = [], seq = 0;
    for (var i = 0; i < payload.lines.length; i++) {
      var l = payload.lines[i], q = Number(l.qty) || 0;
      if (q <= 0) continue;
      seq++;
      var lineId = po + '-' + seq;
      rows.push([lineId, po, dt, String(payload.userName).trim(), String(l.requestType || ''), l.urgent ? 'Yes' : 'No',
        l.isNew ? 'Yes' : 'No', String(l.code || ''), String(l.name || ''), q,
        String(l.lineComment || ''), String(payload.submissionComment || ''), 'Pending']);
    }
    if (!rows.length) throw new Error('No lines with quantity above 0.');

    var req = ss.getSheetByName(TABS.REQ);
    req.getRange(req.getLastRow() + 1, 1, rows.length, REQ_HEADERS.length).setValues(rows);
    deleteDraft_(payload.userName);
    addName_(payload.userName);
    return { po: po, lineCount: rows.length };
  } finally {
    lock.releaseLock();
  }
}

function getSubmissions() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.REQ);
  if (!sh || sh.getLastRow() < 2) return [];
  var last = sh.getLastRow(), MAX = 600;
  var startRow = Math.max(2, last - MAX + 1), n = last - startRow + 1;
  var vals = sh.getRange(startRow, 1, n, REQ_HEADERS.length).getValues();
  var out = [];
  for (var i = vals.length - 1; i >= 0; i--) {
    var r = vals[i]; if (!r[0]) continue;
    out.push({
      lineId: String(r[0]), po: String(r[1]), dt: String(r[2]), user: String(r[3]), requestType: String(r[4]),
      urgency: String(r[5]), newProduct: String(r[6]), code: String(r[7]), name: String(r[8]),
      qty: r[9], lineComment: String(r[10]), subComment: String(r[11]), status: String(r[12] || 'Pending')
    });
  }
  return out;
}

function saveDraft(userName, draftJson) {
  if (!userName) return false;
  var key = String(userName).trim().toLowerCase();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.DRAFT);
  var row = findDraftRow_(sh, key, sh.getLastRow());
  var vals = [key, String(userName).trim(), draftJson, new Date()];
  if (row > 0) sh.getRange(row, 1, 1, 4).setValues([vals]); else sh.appendRow(vals);
  return true;
}
function getDraft(userName) {
  if (!userName) return null;
  var key = String(userName).trim().toLowerCase();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.DRAFT);
  var row = findDraftRow_(sh, key, sh.getLastRow());
  if (row > 0) return String(sh.getRange(row, 3).getValue() || '') || null;
  return null;
}
function deleteDraft_(userName) {
  var key = String(userName).trim().toLowerCase();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.DRAFT);
  var row = findDraftRow_(sh, key, sh.getLastRow());
  if (row > 0) sh.getRange(row, 3).setValue('');
}
function findDraftRow_(sh, key, last) {
  if (last < 2) return -1;
  var keys = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) if (String(keys[i][0]).toLowerCase() === key) return i + 2;
  return -1;
}