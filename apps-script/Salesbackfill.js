/**********************************************************************
 * VITHYA TRADERS — SALES BACKFILL → SUPABASE            [VT-048]
 *
 * Globals declared here (check before pasting):
 *   SBF, backfill2627, backfill2526, backfillStatus, backfillReset,
 *   sbfRun_, sbfVouchersInFtp_, sbfRow_, sbfPush_, sbfSheet_, sbfNum_,
 *   sbfDate_, sbfFy_, sbfProp_, sbfInvoiceMap_, onOpenBackfill
 *
 * ── WHAT IT WRITES, AND WHAT IT WILL NOT TOUCH ──
 *   Writes : public.sales_history ONLY.
 *   Never  : sales_data. That table is what the FTP sent and the PHP sync is
 *            its only writer. Nothing here goes near it.
 *
 * ── THE RULE THAT MATTERS ──
 *   The PHP deletes by voucher_no, but only for vouchers named in its own
 *   file. So a backfilled copy of a voucher the FTP already holds would sit
 *   beside it forever and double the sales for that document.
 *
 *   Therefore: the voucher list is read from sales_data first, and any
 *   voucher already there is SKIPPED. 2,093 vouchers as of 4 Sep 2026.
 *
 * ── WHERE THE DATA COMES FROM ──
 *   Sales_Items_2627 / _2526   the year workbooks, pulled from the Vasy API
 *                              and verified against the FTP feed to the rupee
 *   Sales_Invoices_2627/_2526  joined on salesNo -> orderNo to recover
 *                              contact_id, which the item sheet does not have
 *
 *   Every row is stamped source = 'SHEET-2627' or 'SHEET-2526' so you can
 *   always tell where a number came from.
 *
 * ── SETUP ──
 *   Script Properties: SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * ── RUN, IN THIS ORDER ──
 *   backfill2627()     ~66,000 rows   run repeatedly until it says done
 *   backfill2526()    ~132,000 rows   same
 *   backfillStatus()   what is loaded, by source
 **********************************************************************/

const SBF = {
  URL_PROP: 'SUPABASE_URL',
  KEY_PROP: 'SUPABASE_SERVICE_KEY',
  TABLE:    'sales_history',
  CHUNK:    500,
  GAP:      200,
  MAX_RUN_MS: 1500000,        // manual runs get 30 minutes; stop before that

  YEARS: {
    '2627': { items: 'Sales_Items_2627', invoices: 'Sales_Invoices_2627',
              source: 'SHEET-2627', cursor: 'SBF_CUR_2627' },
    '2526': { items: 'Sales_Items_2526', invoices: 'Sales_Invoices_2526',
              source: 'SHEET-2526', cursor: 'SBF_CUR_2526' },
  },
};

/* ---------- helpers ---------- */

function sbfNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}

function sbfDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return null;
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return null;
}

function sbfFy_(iso) {
  if (!iso) return null;
  const y = parseInt(iso.slice(0, 4), 10), m = parseInt(iso.slice(5, 7), 10);
  const s = (m >= 4) ? y : y - 1;
  return String(s).slice(-2) + String(s + 1).slice(-2);
}

function sbfProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function sbfSheet_(name) {
  try { const sh = vtSheet(name); if (sh) return sh; } catch (e) {}
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (sh) return sh;
  } catch (e) {}
  const props = PropertiesService.getScriptProperties().getProperties();
  const ids = Object.keys(props)
    .filter(function (k) { return /_ID$/.test(k) && String(props[k]).length > 30; })
    .map(function (k) { return props[k]; });
  for (let i = 0; i < ids.length; i++) {
    try {
      const sh = SpreadsheetApp.openById(ids[i]).getSheetByName(name);
      if (sh) return sh;
    } catch (e) {}
  }
  return null;
}

/**
 * Every voucher the FTP already holds. These must never be backfilled.
 *
 * Paged because PostgREST caps a response, and read once per run rather than
 * per chunk — 2,093 values is a small object and a large number of requests.
 */
function sbfVouchersInFtp_() {
  const base = sbfProp_(SBF.URL_PROP).replace(/\/+$/, '');
  const key = sbfProp_(SBF.KEY_PROP);
  const out = {};
  let from = 0;
  const PAGE = 1000;
  while (from < 60000) {
    const res = UrlFetchApp.fetch(
      base + '/rest/v1/sales_data?select=voucher_no',
      { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
                   'Range-Unit': 'items',
                   'Range': from + '-' + (from + PAGE - 1) },
        muteHttpExceptions: true });
    if (res.getResponseCode() >= 400) {
      throw new Error('Could not read sales_data vouchers: HTTP ' +
        res.getResponseCode() + '  ' + res.getContentText().slice(0, 200));
    }
    let arr;
    try { arr = JSON.parse(res.getContentText()); }
    catch (e) { throw new Error('Non-JSON reading sales_data vouchers'); }
    if (!arr.length) break;
    arr.forEach(function (r) {
      const v = String(r.voucher_no || '').trim();
      if (v) out[v] = 1;
    });
    if (arr.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

/** salesNo -> { contact_id, sales_id } from the invoice tab of the same year */
function sbfInvoiceMap_(invSheetName) {
  const sh = sbfSheet_(invSheetName);
  if (!sh || sh.getLastRow() < 2) return {};
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  const iOrder = hdr.indexOf('orderNo');
  const iContact = hdr.indexOf('contactId');
  const iId = hdr.indexOf('salesId');
  if (iOrder < 0) return {};
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, hdr.length).getValues();
  const out = {};
  v.forEach(function (r) {
    const k = String(r[iOrder] || '').trim();
    if (!k) return;
    const cid = iContact >= 0 ? sbfNum_(r[iContact]) : null;
    out[k] = { contact_id: (cid && cid > 0) ? Math.round(cid) : null,
               sales_id: iId >= 0 ? sbfNum_(r[iId]) : null };
  });
  return out;
}

/** one sheet row -> one sales_history row */
function sbfRow_(o, source, inv, srcRow) {
  const voucher = String(o.salesNo || '').trim();
  if (!voucher) return null;
  const d = sbfDate_(o.salesDate);
  const link = inv[voucher] || {};
  return {
    voucher_no:     voucher,
    sales_date:     d,
    item_code:      o.itemCode ? String(o.itemCode) : null,
    product_name:   o.productName ? String(o.productName) : null,
    category_name:  o.categoryName ? String(o.categoryName) : null,
    brand_name:     o.brandName ? String(o.brandName) : null,
    qty:            sbfNum_(o.qty),
    mrp:            sbfNum_(o.mrp),
    unit_price:     sbfNum_(o.price),
    selling_price:  sbfNum_(o.sellingPrice),
    purchase_price: sbfNum_(o.purchasePrice),
    landing_cost:   sbfNum_(o.landingCost),
    net_amount:     sbfNum_(o.netAmount),
    discount:       sbfNum_(o.discount),
    tax_rate:       sbfNum_(o.taxRate),
    tax_amount:     sbfNum_(o.taxAmount),
    customer_name:  (o.customerName && String(o.customerName) !== 'None')
                      ? String(o.customerName) : null,
    /* the item sheet has no contact id — recovered from the invoice tab */
    contact_id:     link.contact_id || null,
    mobile_no:      o.mobNo ? String(o.mobNo) : null,
    sale_type:      o.type ? String(o.type) : null,
    hsn:            o.hsnCode ? String(o.hsnCode) : null,
    uom:            o.measurementCode ? String(o.measurementCode) : null,
    batch_no:       o.batchNo ? String(o.batchNo) : null,
    sales_man:      o.employeeName ? String(o.employeeName) : null,
    receipt_data:   o.receiptData ? String(o.receiptData) : null,
    product_type:      o.productType ? String(o.productType) : null,
    sub_category_name: o.subCategoryName ? String(o.subCategoryName) : null,
    sub_brand_name:    o.subBrandName ? String(o.subBrandName) : null,
    department_name:   o.departmentName ? String(o.departmentName) : null,
    sale_month:     d ? d.slice(0, 7) : null,
    fy:             sbfFy_(d),
    source:         source,
    /* the sheet row number. Two invoices carry the same item twice at the
       same qty and amount, so voucher+item+qty+amount is NOT unique — the
       row number is, and it makes a re-run overwrite instead of duplicate. */
    src_row:        srcRow,
    loaded_at:      new Date().toISOString(),
  };
}

function sbfPush_(rows) {
  /* Postgres rejects a batch that names the same conflict key twice, and it
     rejects the WHOLE batch — 500 rows lost for one collision. Cheap to
     prevent here rather than rely on the key being perfect. */
  const seen = {}, clean = [];
  rows.forEach(function (r) {
    const k = r.source + '|' + r.src_row;
    if (seen[k]) return;
    seen[k] = 1;
    clean.push(r);
  });
  rows = clean;
  const url = sbfProp_(SBF.URL_PROP).replace(/\/+$/, '') +
    '/rest/v1/' + SBF.TABLE +
    '?on_conflict=source,src_row';
  const key = sbfProp_(SBF.KEY_PROP);
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
               'Prefer': 'resolution=merge-duplicates,return=minimal' },
    payload: JSON.stringify(rows), muteHttpExceptions: true,
  });
  return { code: res.getResponseCode(), text: res.getContentText() };
}

/* ---------- the run ---------- */

function sbfRun_(yearKey) {
  const t0 = Date.now();
  const cfg = SBF.YEARS[yearKey];
  if (!cfg) throw new Error('Unknown year ' + yearKey);
  const props = PropertiesService.getScriptProperties();

  const sh = sbfSheet_(cfg.items);
  if (!sh || sh.getLastRow() < 2) {
    throw new Error(cfg.items + ' not found or empty.');
  }
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  const total = sh.getLastRow() - 1;

  let cursor = parseInt(props.getProperty(cfg.cursor) || '0', 10);
  if (cursor >= total) {
    const m = cfg.items + ' is already fully loaded (' +
      total.toLocaleString() + ' rows).\n\nRun backfillReset() to do it again.';
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return 0;
  }

  Logger.log('backfill ' + yearKey + ': starting at row ' + cursor +
    ' of ' + total);

  /* read the two things that must not change mid-run */
  const skip = sbfVouchersInFtp_();
  const nSkipList = Object.keys(skip).length;
  Logger.log('  ' + nSkipList.toLocaleString() +
    ' vouchers already in sales_data — those will be skipped');
  const inv = sbfInvoiceMap_(cfg.invoices);
  Logger.log('  ' + Object.keys(inv).length.toLocaleString() +
    ' invoices available for contact-id lookup');

  const BLOCK = 2000;
  let sent = 0, skipped = 0, unusable = 0, blocks = 0;

  while (cursor < total) {
    if (Date.now() - t0 > SBF.MAX_RUN_MS) break;

    const take = Math.min(BLOCK, total - cursor);
    const v = sh.getRange(2 + cursor, 1, take, hdr.length).getValues();
    const batch = [];
    v.forEach(function (r, idx) {
      const o = {};
      hdr.forEach(function (h, i) { o[h] = r[i]; });
      const voucher = String(o.salesNo || '').trim();
      if (voucher && skip[voucher]) { skipped++; return; }
      /* 1-based sheet row, counting the header — the same number you would
         see if you scrolled to it */
      const row = sbfRow_(o, cfg.source, inv, cursor + idx + 2);
      if (!row) { unusable++; return; }
      batch.push(row);
    });

    for (let i = 0; i < batch.length; i += SBF.CHUNK) {
      const part = batch.slice(i, i + SBF.CHUNK);
      const res = sbfPush_(part);
      if (res.code < 200 || res.code >= 300) {
        props.setProperty(cfg.cursor, String(cursor));
        throw new Error('Push failed at sheet row ' + (cursor + i) +
          '\n\nHTTP ' + res.code + '  ' + res.text.slice(0, 300) +
          '\n\n' + sent.toLocaleString() + ' rows already loaded. The cursor ' +
          'is saved — fix and run again to carry on.');
      }
      sent += part.length;
      Utilities.sleep(SBF.GAP);
    }

    cursor += take;
    blocks++;
    props.setProperty(cfg.cursor, String(cursor));
    Logger.log('  ' + cursor.toLocaleString() + ' / ' + total.toLocaleString() +
      '   pushed ' + sent.toLocaleString() + ', skipped ' + skipped +
      '   (' + Math.round((Date.now() - t0) / 1000) + 's)');
  }

  const done = cursor >= total;
  const msg = (done ? 'BACKFILL ' + yearKey + ' COMPLETE'
                    : 'BACKFILL ' + yearKey + ' — PART WAY') +
    '  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'source        : ' + cfg.items + '  ->  ' + cfg.source + '\n' +
    'sheet rows    : ' + total.toLocaleString() + '\n' +
    'read so far   : ' + cursor.toLocaleString() + '\n' +
    'pushed        : ' + sent.toLocaleString() + '\n' +
    'skipped (FTP has them) : ' + skipped.toLocaleString() + '\n' +
    (unusable ? 'no voucher no : ' + unusable + '\n' : '') +
    '\n' + (done ? 'Done. Run backfillStatus() to check.'
                 : 'Run backfill' + yearKey + '() again to continue from row ' +
                   cursor.toLocaleString() + '.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return sent;
}

/** FY2026-27 first, as agreed — the smaller and more current year */
function backfill2627() { return sbfRun_('2627'); }
function backfill2526() { return sbfRun_('2526'); }

function backfillReset() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(SBF.YEARS).forEach(function (k) {
    props.deleteProperty(SBF.YEARS[k].cursor);
  });
  const m = 'Both cursors cleared. The next run starts from the first row.\n\n' +
    'Nothing was deleted from Supabase — the upsert means a repeat is safe.';
  Logger.log(m);
  try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
}

function backfillStatus() {
  const base = sbfProp_(SBF.URL_PROP).replace(/\/+$/, '');
  const key = sbfProp_(SBF.KEY_PROP);
  const count = function (table, filter) {
    const res = UrlFetchApp.fetch(
      base + '/rest/v1/' + table + '?select=id' + (filter ? '&' + filter : '') + '&limit=1',
      { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
                   'Prefer': 'count=exact', 'Range': '0-0' },
        muteHttpExceptions: true });
    const cr = res.getHeaders()['content-range'] ||
               res.getHeaders()['Content-Range'] || '?/?';
    return String(cr).split('/')[1];
  };
  const props = PropertiesService.getScriptProperties();
  const msg = 'SALES BACKFILL\n\n' +
    'sales_history total : ' + count('sales_history', '') + '\n' +
    '   from SHEET-2627  : ' + count('sales_history', 'source=eq.SHEET-2627') + '\n' +
    '   from SHEET-2526  : ' + count('sales_history', 'source=eq.SHEET-2526') + '\n' +
    '   from API-2425    : ' + count('sales_history', 'source=eq.API-2425') + '\n\n' +
    'cursors\n' +
    '   2627 : ' + (props.getProperty('SBF_CUR_2627') || '0') + '\n' +
    '   2526 : ' + (props.getProperty('SBF_CUR_2526') || '0') + '\n\n' +
    'sales_data (FTP, untouched) : ' + count('sales_data', '');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenBackfill() {
  SpreadsheetApp.getUi()
    .createMenu('📦 Sales backfill')
    .addItem('1. FY2026-27', 'backfill2627')
    .addItem('2. FY2025-26', 'backfill2526')
    .addSeparator()
    .addItem('Status', 'backfillStatus')
    .addItem('Reset the cursors', 'backfillReset')
    .addToUi();
}