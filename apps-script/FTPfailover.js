/**********************************************************************
 * VITHYA TRADERS — FTP FAILOVER + STOCK/ERP → SUPABASE   [VT-072]
 *
 * Globals declared here (check before pasting):
 *   FOV, pushStockToSupabase, pushErpToSupabase, ftpFailoverCheck,
 *   installFailoverTrigger, removeFailoverTrigger, fovProp_, fovPost_,
 *   fovFtpFresh_, fovPullGap_, clearFtpGap, onOpenFailover
 *
 * ── WHAT THIS SOLVES ──
 *   The FTP feed fills the raw *_data tables. When it stops (as it has for
 *   4 days) those tables freeze and Supabase drifts from reality. But we
 *   already pull the same data by API into the sheets every night.
 *
 *   So: a 3 AM check. If the FTP sales feed did not land by then, push the
 *   API data we DO have into Supabase, into API-sourced tables that
 *   v_sales_all already ranks BELOW FTP. When FTP resumes, its rows win
 *   again automatically — nothing to undo.
 *
 * ── STOCK AND ERP, ALWAYS ──
 *   Stock and the ERP snapshot come only by API (no FTP equivalent), so they
 *   push every night regardless. This is where current stock and the ERP
 *   cost/price snapshot land in Supabase.
 *
 * ── WHAT IT TOUCHES ──
 *   Writes : stock_live, erp_snapshot, and (on failover) sales_history rows
 *            tagged API-FAILOVER. Never a raw FTP *_data table.
 *
 * ── SETUP ──
 *   Script Properties: SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * ── RUN ──
 *   pushStockToSupabase()      current stock -> stock_live
 *   pushErpToSupabase()        ERP snapshot -> erp_snapshot
 *   ftpFailoverCheck()         the 3 AM guard (also safe to run by hand)
 *   installFailoverTrigger()   runs the check nightly at 03:00
 **********************************************************************/

const FOV = {
  URL_PROP: 'SUPABASE_URL',
  KEY_PROP: 'SUPABASE_SERVICE_KEY',
  CHUNK: 500,
  GAP: 250,
  /* if the newest FTP sales row is older than this many days, fail over */
  STALE_DAYS: 1,
};

function fovProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function fovGet_(path) {
  const base = fovProp_(FOV.URL_PROP).replace(/\/+$/, '');
  const key = fovProp_(FOV.KEY_PROP);
  const res = UrlFetchApp.fetch(base + '/rest/v1/' + path, {
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
    muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  try { return JSON.parse(res.getContentText()); } catch (e) { return null; }
}

function fovPost_(table, rows, conflict) {
  const base = fovProp_(FOV.URL_PROP).replace(/\/+$/, '');
  const key = fovProp_(FOV.KEY_PROP);
  let sent = 0;
  for (let i = 0; i < rows.length; i += FOV.CHUNK) {
    const part = rows.slice(i, i + FOV.CHUNK);
    const res = UrlFetchApp.fetch(
      base + '/rest/v1/' + table + (conflict ? '?on_conflict=' + conflict : ''),
      { method: 'post', contentType: 'application/json',
        headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
                   'Prefer': 'resolution=merge-duplicates,return=minimal' },
        payload: JSON.stringify(part), muteHttpExceptions: true });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      throw new Error(table + ': HTTP ' + res.getResponseCode() + ' at row ' +
        (i + 1) + ' — ' + res.getContentText().slice(0, 250));
    }
    sent += part.length;
    if (i + FOV.CHUNK < rows.length) Utilities.sleep(FOV.GAP);
  }
  return sent;
}

function fovNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}

/* ================= stock ================= */

function pushStockToSupabase() {
  const t0 = Date.now();
  let sh = null;
  try { sh = vtSheet('Stock_Live'); } catch (e) {}
  if (!sh) { try { sh = lsBook_().getSheetByName('Stock_Live'); } catch (e) {} }
  if (!sh || sh.getLastRow() < 2) throw new Error('Stock_Live is empty — run pullStock first.');

  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  const H = {}; hdr.forEach(function (h, i) { H[h] = i; });
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, hdr.length).getValues();
  const stamp = new Date().toISOString();

  const rows = [];
  v.forEach(function (r) {
    const code = String(r[H['item_code']] || '').trim();
    if (!code) return;
    rows.push({
      item_code: code,
      product_name: H['product_name'] !== undefined ? String(r[H['product_name']] || '') : null,
      qty_w: fovNum_(r[H['qty_w']]),
      qty_wo: fovNum_(r[H['qty_wo']]),
      qty_total: fovNum_(r[H['qty_total']]),
      category: H['category'] !== undefined ? String(r[H['category']] || '') : null,
      brand: H['brand'] !== undefined ? String(r[H['brand']] || '') : null,
      source: 'API', loaded_at: stamp,
    });
  });
  if (!rows.length) throw new Error('No stock rows with an item code.');

  const sent = fovPost_('stock_live', rows, 'item_code');
  const msg = 'STOCK -> SUPABASE  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'products: ' + sent.toLocaleString();
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return sent;
}

/* ================= ERP snapshot ================= */

function pushErpToSupabase() {
  const t0 = Date.now();
  let sh = null;
  try { sh = vtSheet('ERP_Snapshot'); } catch (e) {}
  if (!sh || sh.getLastRow() < 2) throw new Error('ERP_Snapshot not found or empty.');

  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  const H = {}; hdr.forEach(function (h, i) { H[h] = i; });
  const codeCol = (H['item_code'] !== undefined) ? 'item_code'
                : (H['itemCode'] !== undefined) ? 'itemCode' : null;
  if (!codeCol) throw new Error('No item code column on ERP_Snapshot. Columns: ' +
    hdr.join(', '));

  const v = sh.getRange(2, 1, sh.getLastRow() - 1, hdr.length).getValues();
  const stamp = new Date().toISOString();
  const rows = [];
  v.forEach(function (r) {
    const code = String(r[H[codeCol]] || '').trim();
    if (!code) return;
    /* store the whole row as JSON plus the columns we know we want, so the
       snapshot survives a schema change on the Vasy side */
    const obj = {};
    hdr.forEach(function (h, i) { if (h) obj[h] = r[i]; });
    rows.push({
      item_code: code,
      product_name: obj.product_name || obj.productName || null,
      selling_w: fovNum_(obj.erp_selling_w || obj.selling_w_incGST),
      selling_wo: fovNum_(obj.erp_selling_wo || obj.selling_wo),
      mrp_w: fovNum_(obj.erp_mrp_w || obj.mrp_w),
      mrp_wo: fovNum_(obj.erp_mrp_wo || obj.mrp_wo),
      gst_rate: fovNum_(obj.gst_rate),
      qty: fovNum_(obj.qty),
      data: JSON.stringify(obj),
      source: 'API', loaded_at: stamp,
    });
  });
  if (!rows.length) throw new Error('No ERP rows with an item code.');

  const sent = fovPost_('erp_snapshot', rows, 'item_code');
  const msg = 'ERP SNAPSHOT -> SUPABASE  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'products: ' + sent.toLocaleString();
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return sent;
}

/* ================= the FTP failover ================= */

/** is the FTP sales feed fresh? true if the newest FTP row is recent enough */
function fovFtpFresh_() {
  const rows = fovGet_('sales_data?select=date&order=id.desc&limit=200');
  if (!rows || !rows.length) return false;
  /* dates are DD/MM/YYYY text; find the newest */
  let newest = null;
  rows.forEach(function (r) {
    const m = String(r.date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (!newest || d > newest) newest = d;
  });
  if (!newest) return false;
  const ageDays = (Date.now() - newest.getTime()) / 86400000;
  return ageDays <= FOV.STALE_DAYS + 1;   // +1 for the day boundary
}

/**
 * The 3 AM guard.
 *
 * If FTP is fresh, do nothing — its data is authoritative and already there.
 * If it is stale, push what the API has so Supabase is not left frozen:
 *   - the recent sales lines the nightly API pull put in the sheets,
 *     tagged API-FAILOVER so v_sales_all keeps them BELOW any FTP row
 *   - stock and ERP always push, FTP or not
 */
function ftpFailoverCheck() {
  const t0 = Date.now();
  const fresh = fovFtpFresh_();
  const L = ['FTP FAILOVER CHECK', ''];

  /* stock and ERP have no FTP equivalent — always push */
  try { L.push('stock : ' + pushStockToSupabase() + ' products'); }
  catch (e) { L.push('stock FAILED: ' + e.message); }
  try { L.push('erp   : ' + pushErpToSupabase() + ' products'); }
  catch (e) { L.push('erp FAILED: ' + e.message); }

  if (fresh) {
    L.push('');
    L.push('FTP is fresh — sales left to the FTP feed, as normal.');
  } else {
    L.push('');
    L.push('FTP is STALE. Pushing recent API sales as a stand-in.');
    try {
      const n = fovPushRecentSales_();
      L.push('sales gap-fill: ' + n + ' lines pulled from the API into sales_ftp_gap');
    } catch (e) { L.push('sales failover FAILED: ' + e.message); }
  }

  const msg = L.join('\n') + '\n\n(' + Math.round((Date.now() - t0) / 1000) + 's)';
  try { sautLog_('FTP failover', fresh ? 'ok' : 'ok (failover)', msg); }
  catch (e) { Logger.log(msg); }
  return msg;
}

/**
 * Pull the days FTP is missing straight from the Vasy API into
 * sales_ftp_gap. The old version copied the sheets, but the sheets stop the
 * day the nightly pull died — they do not have the missing days. Only the
 * API does. Reuses the proven item-register call (path, page 500, 20s gap,
 * ISO dates, salesItemRegisterData) via SalesApiBackfill's machinery.
 *
 * Window: from the day after the newest FTP sale, to today.
 */
function fovPushRecentSales_() {
  /* where does FTP stop? */
  const rows = fovGet_('sales_data?select=date&order=id.desc&limit=300') || [];
  let newest = null;
  rows.forEach(function (r) {
    const m = String(r.date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    if (!newest || d > newest) newest = d;
  });
  /* start the day after FTP's newest, or 14 days back if we cannot tell */
  const from = newest
    ? new Date(newest.getTime() + 86400000)
    : new Date(Date.now() - 14 * 86400000);
  const fromDay = Utilities.formatDate(from, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const toDay = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (fromDay > toDay) return 0;   // FTP is current, nothing to fill

  return fovPullGap_(fromDay, toDay);
}

/**
 * The API pull, into sales_ftp_gap. Kept here (not in SalesApiBackfill) so
 * this file stands alone, but the constants are SAUT's proven ones.
 */
function fovPullGap_(fromDay, toDay) {
  const base = fovProp_('VASY_BASE_URL').replace(/\/+$/, '');
  const token = fovProp_('VASY_API_TOKEN');
  const branch = fovProp_('VASY_BRANCH_ID');
  const PATH = '/api/v1/report/sales-item-register/invoice';
  const PAGE = 500, GAP = 20000, MAX_MS = 280000;
  const t0 = Date.now();
  let offset = 0, total = 0, pages = 0, pushed = 0;
  const iso = function (d, eod) { return d + (eod ? 'T23:59:59Z' : 'T00:00:00Z'); };

  let batch = [];
  const flush = function () {
    if (!batch.length) return;
    pushed += fovPost_('sales_ftp_gap', batch, 'voucher_no,item_code,qty,net_amount');
    batch = [];
  };

  while (Date.now() - t0 < MAX_MS) {
    let res = UrlFetchApp.fetch(base + PATH, {
      method: 'post', contentType: 'application/json',
      headers: { 'api-token': token },
      payload: JSON.stringify({ branch_list: branch,
        from_date: iso(fromDay, false), to_date: iso(toDay, true),
        limit: PAGE, offset: offset }),
      muteHttpExceptions: true });
    if (res.getResponseCode() === 429) { Utilities.sleep(45000); continue; }
    if (res.getResponseCode() !== 200) {
      throw new Error('HTTP ' + res.getResponseCode() + ' at offset ' + offset +
        ' — ' + res.getContentText().slice(0, 200));
    }
    const j = JSON.parse(res.getContentText());
    const resp = j.response || {};
    if (!total) total = fovNum_(resp.totalCount) || 0;
    const list = resp.salesItemRegisterData || [];
    if (!list.length) break;

    list.forEach(function (o) {
      const voucher = String(o.salesNo || '').trim();
      if (!voucher) return;
      const ds = String(o.salesDate || '').slice(0, 10);
      batch.push({
        voucher_no: voucher, sales_date: ds || null,
        sale_month: ds ? ds.slice(0, 7) : null,
        item_code: String(o.itemCode || ''),
        product_name: String(o.productName || ''),
        category_name: String(o.categoryName || ''),
        sub_category_name: String(o.subCategoryName || ''),
        brand_name: String(o.brandName || ''),
        department_name: String(o.departmentName || ''),
        qty: fovNum_(o.qty), mrp: fovNum_(o.mrp),
        unit_price: fovNum_(o.price), selling_price: fovNum_(o.sellingPrice),
        purchase_price: fovNum_(o.purchasePrice), landing_cost: fovNum_(o.landingCost),
        net_amount: fovNum_(o.netAmount), tax_rate: fovNum_(o.taxRate),
        tax_amount: fovNum_(o.taxAmount),
        customer_name: (o.customerName && o.customerName !== 'None') ? String(o.customerName) : null,
        sale_type: String(o.type || ''), sales_man: String(o.employeeName || ''),
        pulled_for_day: toDay,
        source: 'API-FTPGAP', loaded_at: new Date().toISOString(),
      });
    });
    if (batch.length >= 500) flush();

    pages++;
    offset += list.length;
    if (total && offset >= total) break;
    if (list.length < PAGE) break;
    Utilities.sleep(GAP);
  }
  flush();
  Logger.log('gap pull ' + fromDay + '..' + toDay + ': ' + pushed +
    ' lines over ' + pages + ' pages');
  return pushed;
}

/** empty the gap table — run once FTP has caught up and re-sent those days */
function clearFtpGap() {
  const base = fovProp_(FOV.URL_PROP).replace(/\/+$/, '');
  const key = fovProp_(FOV.KEY_PROP);
  const res = UrlFetchApp.fetch(base + '/rest/v1/sales_ftp_gap?id=gt.0', {
    method: 'delete',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
               'Prefer': 'return=minimal' },
    muteHttpExceptions: true });
  const ok = res.getResponseCode() >= 200 && res.getResponseCode() < 300;
  const m = ok ? 'Gap table cleared. FTP data now stands alone.'
              : 'Clear failed: HTTP ' + res.getResponseCode();
  Logger.log(m);
  try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
}

/* ================= schedule ================= */

function installFailoverTrigger() {
  removeFailoverTrigger();
  ScriptApp.newTrigger('ftpFailoverCheck')
    .timeBased().atHour(3).nearMinute(0).everyDays(1).create();
  const m = 'FTP failover check will run nightly at about 03:00 — after the ' +
    '02:00 FTP sync, so it can see whether that landed.';
  Logger.log(m);
  try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
}

function removeFailoverTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ftpFailoverCheck') {
      ScriptApp.deleteTrigger(t); n++;
    }
  });
  return n;
}

function onOpenFailover() {
  SpreadsheetApp.getUi()
    .createMenu('🔄 FTP failover')
    .addItem('Run the check now', 'ftpFailoverCheck')
    .addItem('Push stock only', 'pushStockToSupabase')
    .addItem('Push ERP only', 'pushErpToSupabase')
    .addItem('Clear the gap table (after FTP catches up)', 'clearFtpGap')
    .addSeparator()
    .addItem('Run nightly at 03:00', 'installFailoverTrigger')
    .addItem('Stop the nightly check', 'removeFailoverTrigger')
    .addToUi();
}