/**
 * ProductsApi.gs — Vithya Traders Purchase Intelligence V1.1.2  [R34]
 *
 * Builds the "Products" tab from Supabase first, with the old master sheet filling the gaps.
 *
 *   Supabase sku_master   → canonical code, name, brand, category, sub-category, unit, w / wo item codes
 *   Supabase erp_snapshot → Vasy MRP, Vasy selling price, GST % and unit for each w / wo item code
 *   Master sheet          → anything Supabase does not have, and the COST price (excl GST)
 *
 * Price meaning (shown in the dashboard as "incl GST" / "excl GST"):
 *   GST Price / NonGST Price   = cost, EXCL GST (master sheet). The dashboard prefers the purchase register.
 *   GST MRP / NonGST MRP       = INCL GST (Vasy)
 *   GST Selling / NonGST Selling = INCL GST (Vasy)
 *
 * Read-only on Supabase. The key stays in Script Properties (VT_SB_KEY) — never in the browser.
 * If Supabase cannot be reached, the old master-only sync runs instead, so the tab is never emptied.
 *
 * A comparison is written to the tab "V1.1 Product Sync Report" on every run.
 */

var PRODUCTS_V11_VERSION = 'products 1.0 (V1.1.2)';
var PROD_REPORT_TAB = 'V1.1 Product Sync Report';

function prodSbGetAll_(table, select, order) {
  var key = PropertiesService.getScriptProperties().getProperty('VT_SB_KEY');
  if (!key) throw new Error('VT_SB_KEY not set in Script Properties');
  var base = 'https://kssydapdfmkfufrqhwzp.supabase.co/rest/v1/' + table + '?select=' + encodeURIComponent(select) + '&order=' + order;
  var size = 1000, out = [], offset = 0, guard = 0;
  while (guard++ < 60) {
    var reqs = [];
    for (var k = 0; k < 5; k++) reqs.push({ url: base + '&offset=' + (offset + k * size) + '&limit=' + size, method: 'get', muteHttpExceptions: true,
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' } });
    var res = UrlFetchApp.fetchAll(reqs), short = false;
    for (var r = 0; r < res.length; r++) {
      var code = res[r].getResponseCode();
      if (code < 200 || code >= 300) throw new Error(table + ': Supabase HTTP ' + code + ' ' + String(res[r].getContentText()).slice(0, 150));
      var rows = JSON.parse(res[r].getContentText());
      for (var i = 0; i < rows.length; i++) out.push(rows[i]);
      if (rows.length < size) { short = true; break; }
    }
    if (short) break;
    offset += 5 * size;
  }
  return out;
}

function prodUnit_(u) {
  u = String(u || '').trim().toUpperCase();
  if (!u) return '';
  if (u === 'NUMBERS' || u === 'NOS' || u === 'NO' || u === 'NUMBER') return 'nos';
  if (u === 'KILOGRAMS' || u === 'KGS' || u === 'KG') return 'kg';
  if (u === 'METERS' || u === 'MTR' || u === 'METRE' || u === 'METRES') return 'metre';
  if (u === 'SET' || u === 'SETS') return 'set';
  return u.toLowerCase();
}
function prodR3_(v) { if (v === '' || v == null || isNaN(Number(v))) return ''; return Math.round(Number(v) * 1000) / 1000; }
function prodCanon_(c) { return String(c || '').replace(/\/+\s*$/, '').trim(); }
function prodStripLane_(n) { return String(n || '').replace(/\s*\/+\s*$/, '').trim(); }

function syncProductsV11_() {
  var started = new Date();
  var sku, erp;
  try {
    sku = prodSbGetAll_('sku_master', 'parent_sku,product_name,category,sub_category,brand,uom,gst_item_code,nongst_item_code,active', 'parent_sku.asc');
    erp = prodSbGetAll_('erp_snapshot', 'item_code,product_name,data', 'item_code.asc');
  } catch (e) {
    prodReport_(started, null, 'Supabase could not be read — used the master sheet only. ' + (e && e.message || e));
    return syncProductsMasterOnly_();
  }
  var master = {};
  var masterErr = '';
  try { master = readMasterByCanon_(); } catch (e2) { masterErr = String(e2 && e2.message || e2); }

  // erp by item code
  var E = {};
  erp.forEach(function (r) {
    var d = r.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { d = {}; } }
    d = d || {};
    E[String(r.item_code || '').trim()] = { name: String(d.productName || r.product_name || ''), mrp: prodR3_(d.mrp), sp: prodR3_(d.sellingPrice),
      tax: (d.taxRate === '' || d.taxRate == null) ? '' : Number(d.taxRate), unit: prodUnit_(d.measurement), brand: String(d.brand || ''), cat: String(d.category || '') };
  });

  var P = {}, order = [];
  function get(c) { if (!P[c]) { P[c] = { canon: c, inSb: false, inMaster: false }; order.push(c); } return P[c]; }
  sku.forEach(function (r) {
    var c = prodCanon_(r.parent_sku); if (!c) return;
    var p = get(c); p.inSb = true;
    p.name = prodStripLane_(r.product_name); p.brand = r.brand || ''; p.cat = r.category || ''; p.subcat = r.sub_category || '';
    p.unit = prodUnit_(r.uom); p.gstCode = String(r.gst_item_code || '').trim(); p.nonCode = String(r.nongst_item_code || '').trim();
  });
  Object.keys(E).forEach(function (code) {
    var c = prodCanon_(code); if (!c) return;
    var p = get(c); p.inSb = true;
    var isNon = /\/\s*$/.test(code);
    if (isNon) { if (!p.nonCode) p.nonCode = code; } else { if (!p.gstCode) p.gstCode = code; }
  });
  Object.keys(master).forEach(function (c) { var p = get(c); p.inMaster = true; });

  var rows = [], rep = [], cBoth = 0, cSb = 0, cMa = 0, cDiff = 0, cPrice = 0;
  order.forEach(function (c) {
    var p = P[c], m = master[c] || {};
    var eg = p.gstCode ? E[p.gstCode] : null, en = p.nonCode ? E[p.nonCode] : null;
    var name = p.name || m.name || (eg && prodStripLane_(eg.name)) || (en && prodStripLane_(en.name)) || '';
    if (!name) return;
    var gstMrp = (eg && eg.mrp !== '') ? eg.mrp : (m.gstMrp !== undefined ? m.gstMrp : '');
    var nonMrp = (en && en.mrp !== '') ? en.mrp : (m.nonMrp !== undefined ? m.nonMrp : '');
    var gstSp = (eg && eg.sp !== '') ? eg.sp : '';
    var nonSp = (en && en.sp !== '') ? en.sp : '';
    if (eg || en) cPrice++;
    var unit = p.unit || (eg && eg.unit) || (en && en.unit) || '';
    var tax = (eg && eg.tax !== '') ? eg.tax : '';
    var src = (p.inSb && p.inMaster) ? 'Supabase+Master' : (p.inSb ? 'Supabase' : 'Master');
    if (p.inSb && p.inMaster) cBoth++; else if (p.inSb) cSb++; else cMa++;
    rows.push([c, name, p.brand || m.brand || (eg && eg.brand) || '', p.cat || m.cat || (eg && eg.cat) || '', p.subcat || m.subcat || '',
      p.gstCode || m.gstCode || '', (m.gstPrice === undefined ? '' : m.gstPrice), p.nonCode || m.nonCode || '', (m.nonPrice === undefined ? '' : m.nonPrice),
      gstMrp, nonMrp, gstSp, nonSp, unit, tax, src]);
    // report lines
    var note = '';
    if (src === 'Master') note = 'only in the master sheet';
    else if (src === 'Supabase') note = 'only in Supabase';
    var mg = Number(m.gstMrp) || 0, vg = (eg && Number(eg.mrp)) || 0;
    if (mg && vg && Math.abs(mg - vg) / vg > 0.01) { note = (note ? note + '; ' : '') + 'MRP w differs (master ' + mg + ' vs Vasy ' + vg + ')'; cDiff++; }
    if (note && rep.length < 6000) rep.push([c, name, src, m.gstMrp === undefined ? '' : m.gstMrp, eg ? eg.mrp : '', m.nonMrp === undefined ? '' : m.nonMrp, en ? en.mrp : '', note]);
  });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dest = ss.getSheetByName(TABS.PROD) || ss.insertSheet(TABS.PROD);
  if (dest.getMaxColumns() < PROD_HEADERS.length) dest.insertColumnsAfter(dest.getMaxColumns(), PROD_HEADERS.length - dest.getMaxColumns());
  dest.getRange(1, 1, 1, PROD_HEADERS.length).setValues([PROD_HEADERS]).setFontWeight('bold');
  if (dest.getLastRow() > 1) dest.getRange(2, 1, dest.getLastRow() - 1, PROD_HEADERS.length).clearContent();
  if (rows.length) dest.getRange(2, 1, rows.length, PROD_HEADERS.length).setValues(rows);

  var st = ss.getSheetByName(TABS.SET);
  if (st) {
    st.getRange('A4:B4').setValues([['Last product sync', new Date()]]);
    st.getRange('A5:B5').setValues([['Products synced', rows.length]]);
    st.getRange('A7:B7').setValues([['Product source', 'Supabase + master (' + PRODUCTS_V11_VERSION + ')']]);
  }
  prodReport_(started, { total: rows.length, both: cBoth, sbOnly: cSb, masterOnly: cMa, withVasyPrice: cPrice, mrpDiff: cDiff,
    skuRows: sku.length, erpRows: erp.length, masterRows: Object.keys(master).length, masterErr: masterErr }, '', rep);
  return rows.length;
}

function prodReport_(started, s, err, rep) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(PROD_REPORT_TAB) || ss.insertSheet(PROD_REPORT_TAB);
    sh.clear();
    var head = [['V1.1 Product Sync Report', PRODUCTS_V11_VERSION], ['Run at', started], ['Took (seconds)', Math.round((new Date() - started) / 1000)]];
    if (err) head.push(['RESULT', err]);
    if (s) {
      head.push(['Products written', s.total], ['In Supabase AND master', s.both], ['Only in Supabase', s.sbOnly], ['Only in master sheet', s.masterOnly],
        ['With a Vasy MRP / selling price', s.withVasyPrice], ['MRP (w) differs master vs Vasy by more than 1%', s.mrpDiff],
        ['Supabase sku_master rows', s.skuRows], ['Supabase erp_snapshot rows', s.erpRows], ['Master sheet products', s.masterRows]);
      if (s.masterErr) head.push(['Master sheet problem', s.masterErr]);
      head.push(['Prices', 'MRP and Selling = incl GST (Vasy). Price = cost, excl GST (master; the dashboard prefers the purchase register).']);
    }
    sh.getRange(1, 1, head.length, 2).setValues(head);
    sh.getRange(1, 1, 1, 2).setFontWeight('bold');
    if (rep && rep.length) {
      var r0 = head.length + 2;
      var h = ['Canonical Code', 'Product', 'Source', 'Master MRP w', 'Vasy MRP w (incl GST)', 'Master MRP wo', 'Vasy MRP wo', 'Note'];
      sh.getRange(r0, 1, 1, h.length).setValues([h]).setFontWeight('bold');
      sh.getRange(r0 + 1, 1, rep.length, h.length).setValues(rep);
    }
  } catch (e) { }
}
