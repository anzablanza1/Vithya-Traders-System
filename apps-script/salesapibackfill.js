/**********************************************************************
 * VITHYA TRADERS — SALES ITEMS FROM THE API → SUPABASE   [VT-049]
 *
 * Globals declared here (check before pasting):
 *   SAB, fillAugustGap, backfill2425, sabPullWindow_, sabRow_, sabPush_,
 *   sabProp_, sabNum_, sabDate_, sabFy_, sabVouchersInFtp_, sabReset,
 *   sabStatus, onOpenApiBackfill
 *
 * ── TWO JOBS, SAME MACHINERY ──
 *
 *   1. THE AUGUST HOLE. v_sales_all shows 8-14 Aug 2026 carrying 66 to 172
 *      lines a day where a normal day is 600 to 750:
 *
 *          07 Aug   738   sheet + ftp
 *          08 Aug    66   ftp only     <- hole
 *          12 Aug   172   ftp only     <- hole
 *          17 Aug   652   ftp          normal again
 *
 *      The sheet pull died on 7 Aug and the FTP window only reaches back to
 *      17 Aug. Nine days fall between them and exist in neither.
 *
 *   2. FY2024-25, which is in no sheet at all.
 *
 * ── WHAT IT TOUCHES ──
 *   Writes : public.sales_history ONLY, keyed on (source, src_row).
 *   Never  : sales_data.
 *   Vouchers already in sales_data are skipped, same rule as SalesBackfill.
 *
 * ── PACE ──
 *   Page 100, 20 seconds apart. Those are SAUT.ITEM_PAGE and SAUT.GAP from
 *   sales_automation.gs, which has called this endpoint for months. Not
 *   guesses — every time I have guessed at this endpoint I have been wrong.
 *
 * ── RUN ──
 *   fillAugustGap()   ~9 days, a few minutes. Do this first.
 *   backfill2425()    a full year. Run repeatedly; it resumes.
 *   sabStatus()       what is loaded
 **********************************************************************/

const SAB = {
  URL_PROP:   'SUPABASE_URL',
  KEY_PROP:   'SUPABASE_SERVICE_KEY',
  TABLE:      'sales_history',

  VASY_BASE:  'VASY_BASE_URL',
  VASY_TOKEN: 'VASY_API_TOKEN',
  VASY_BRANCH:'VASY_BRANCH_ID',
  /* SAUT.ITEM_PATH, verbatim. I dropped the /api/v1 prefix. */
  PATH:       '/api/v1/report/sales-item-register/invoice',
  /* salesItemRegisterData, from SAUT. I reused salesDataListDTOList, which
     belongs to the INVOICE endpoint — a different response for a different
     report. Same class of mistake as the path and the page size. */
  LIST_KEY:   'salesItemRegisterData',

  /* SAUT.ITEM_PAGE is 500 for the ITEM register — the 100 cap applies to the
     INVOICE endpoint, which is a different one. I carried the wrong number
     across. 500 with a 20s gap is what has been running nightly for months. */
  PAGE:       500,
  GAP:        20000,
  CHUNK:      500,
  MAX_RUN_MS: 1500000,

  /* Checked against the Vasy Sales Item Register, 76,279 rows.
     Only four days are short, and they are 1 to 6 August — not the 8-16 I
     first guessed. I read "FTP only, 44 lines" as normal for those days
     instead of comparing them with the register.

         date      register   database   missing
         01 Aug         805         44       761
         04 Aug         772         31       741
         05 Aug         703         44       659
         06 Aug         485        371       114

     Every other day from 1 Apr 2026 to 4 Sep 2026 matches the register
     exactly, to the rupee. */
  GAP_FROM:   '2026-08-01',
  GAP_TO:     '2026-08-07',
  GAP_SOURCE: 'API-AUGGAP2',

  FY2425_FROM:'2024-04-01',
  FY2425_TO:  '2025-03-31',
  FY2425_SOURCE: 'API-2425',
  FY2425_CURSOR: 'SAB_CUR_2425',
};

function sabNum_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : null;
}

function sabDate_(v) {
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

function sabFy_(iso) {
  if (!iso) return null;
  const y = parseInt(iso.slice(0, 4), 10), m = parseInt(iso.slice(5, 7), 10);
  const s = (m >= 4) ? y : y - 1;
  return String(s).slice(-2) + String(s + 1).slice(-2);
}

function sabProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

/** ISO 8601 UTC — plain yyyy-MM-dd returns HTTP 400 on these endpoints */
function sabIso_(day, endOfDay) {
  return day + (endOfDay ? 'T23:59:59Z' : 'T00:00:00Z');
}

function sabVouchersInFtp_() {
  const base = sabProp_(SAB.URL_PROP).replace(/\/+$/, '');
  const key = sabProp_(SAB.KEY_PROP);
  const out = {};
  let from = 0;
  while (from < 60000) {
    const res = UrlFetchApp.fetch(
      base + '/rest/v1/sales_data?select=voucher_no',
      { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
                   'Range-Unit': 'items', 'Range': from + '-' + (from + 999) },
        muteHttpExceptions: true });
    if (res.getResponseCode() >= 400) break;
    let arr = [];
    try { arr = JSON.parse(res.getContentText()); } catch (e) { break; }
    if (!arr.length) break;
    arr.forEach(function (r) {
      const v = String(r.voucher_no || '').trim();
      if (v) out[v] = 1;
    });
    if (arr.length < 1000) break;
    from += 1000;
  }
  return out;
}

function sabRow_(o, source, srcRow) {
  const voucher = String(o.salesNo || '').trim();
  if (!voucher) return null;
  const d = sabDate_(o.salesDate);
  return {
    voucher_no:     voucher,
    sales_date:     d,
    item_code:      o.itemCode ? String(o.itemCode) : null,
    product_name:   o.productName ? String(o.productName) : null,
    category_name:  o.categoryName ? String(o.categoryName) : null,
    sub_category_name: o.subCategoryName ? String(o.subCategoryName) : null,
    brand_name:     o.brandName ? String(o.brandName) : null,
    sub_brand_name: o.subBrandName ? String(o.subBrandName) : null,
    department_name:o.departmentName ? String(o.departmentName) : null,
    product_type:   o.productType ? String(o.productType) : null,
    qty:            sabNum_(o.qty),
    mrp:            sabNum_(o.mrp),
    unit_price:     sabNum_(o.price),
    selling_price:  sabNum_(o.sellingPrice),
    purchase_price: sabNum_(o.purchasePrice),
    landing_cost:   sabNum_(o.landingCost),
    net_amount:     sabNum_(o.netAmount),
    /* the item register calls it totalDiscount, not discount */
    discount:       sabNum_(o.totalDiscount !== undefined
                              ? o.totalDiscount : o.discount),
    tax_rate:       sabNum_(o.taxRate),
    tax_amount:     sabNum_(o.taxAmount),
    customer_name:  (o.customerName && String(o.customerName) !== 'None')
                      ? String(o.customerName) : null,
    contact_id:     null,        // the item register does not carry it
    mobile_no:      o.mobNo ? String(o.mobNo) : null,
    sale_type:      o.type ? String(o.type) : null,
    hsn:            o.hsnCode ? String(o.hsnCode) : null,
    uom:            o.measurementCode ? String(o.measurementCode) : null,
    batch_no:       o.batchNo ? String(o.batchNo) : null,
    sales_man:      o.employeeName ? String(o.employeeName) : null,
    receipt_data:   o.receiptData ? String(o.receiptData) : null,
    sale_month:     d ? d.slice(0, 7) : null,
    fy:             sabFy_(d),
    source:         source,
    src_row:        srcRow,
    loaded_at:      new Date().toISOString(),
  };
}

function sabPush_(rows) {
  const seen = {}, clean = [];
  rows.forEach(function (r) {
    const k = r.source + '|' + r.src_row;
    if (seen[k]) return;
    seen[k] = 1;
    clean.push(r);
  });
  const url = sabProp_(SAB.URL_PROP).replace(/\/+$/, '') +
    '/rest/v1/' + SAB.TABLE + '?on_conflict=source,src_row';
  const key = sabProp_(SAB.KEY_PROP);
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
               'Prefer': 'resolution=merge-duplicates,return=minimal' },
    payload: JSON.stringify(clean), muteHttpExceptions: true,
  });
  return { code: res.getResponseCode(), text: res.getContentText(), n: clean.length };
}

/**
 * Pull one date window and push it.
 * offset doubles as src_row, so a repeat overwrites rather than duplicating.
 */
function sabPullWindow_(fromDay, toDay, source, cursorProp) {
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();
  let offset = cursorProp ? parseInt(props.getProperty(cursorProp) || '0', 10) : 0;

  const base = sabProp_(SAB.VASY_BASE).replace(/\/+$/, '');
  const token = sabProp_(SAB.VASY_TOKEN);
  const branch = sabProp_(SAB.VASY_BRANCH);

  Logger.log(source + ': ' + fromDay + ' to ' + toDay +
    ', starting at offset ' + offset);
  const skip = sabVouchersInFtp_();
  Logger.log('  ' + Object.keys(skip).length.toLocaleString() +
    ' vouchers already in sales_data — skipping those');

  let total = 0, sent = 0, skipped = 0, pages = 0, ranOut = false;

  while (true) {
    if (Date.now() - t0 > SAB.MAX_RUN_MS) { ranOut = true; break; }

    let res = UrlFetchApp.fetch(base + SAB.PATH, {
      method: 'post', contentType: 'application/json',
      headers: { 'api-token': token },
      payload: JSON.stringify({
        branch_list: branch,
        from_date: sabIso_(fromDay, false),
        to_date:   sabIso_(toDay, true),
        limit: SAB.PAGE, offset: offset,
      }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 429) {
      Logger.log('  rate limited, waiting 45s');
      Utilities.sleep(45000);
      continue;
    }
    if (res.getResponseCode() !== 200) {
      if (cursorProp) props.setProperty(cursorProp, String(offset));
      throw new Error('HTTP ' + res.getResponseCode() + ' at offset ' + offset +
        '\n\n' + res.getContentText().slice(0, 300));
    }
    let j;
    try { j = JSON.parse(res.getContentText()); }
    catch (e) { throw new Error('Non-JSON at offset ' + offset); }
    const resp = j.response || {};
    if (!total) total = sabNum_(resp.totalCount) || 0;
    let list = resp[SAB.LIST_KEY];
    if (!list) {
      /* an empty page is a normal end; a MISSING key is a wrong key, and
         reporting that as "part way" wasted a run */
      const keys = Object.keys(resp);
      const arrKey = keys.filter(function (k) { return Array.isArray(resp[k]); })[0];
      if (!arrKey) {
        throw new Error('No array in the response at offset ' + offset +
          '.\n\nresponse keys: ' + keys.join(', ') +
          '\ntotalCount: ' + resp.totalCount +
          '\n\nExpected "' + SAB.LIST_KEY + '".');
      }
      Logger.log('  using response.' + arrKey + ' (expected ' + SAB.LIST_KEY + ')');
      list = resp[arrKey];
    }
    if (!list.length) break;

    const batch = [];
    list.forEach(function (o, i) {
      const voucher = String(o.salesNo || '').trim();
      if (voucher && skip[voucher]) { skipped++; return; }
      const row = sabRow_(o, source, offset + i + 1);
      if (row) batch.push(row);
    });

    for (let i = 0; i < batch.length; i += SAB.CHUNK) {
      const part = batch.slice(i, i + SAB.CHUNK);
      const pr = sabPush_(part);
      if (pr.code < 200 || pr.code >= 300) {
        if (cursorProp) props.setProperty(cursorProp, String(offset));
        throw new Error('Push failed at offset ' + offset +
          '\n\nHTTP ' + pr.code + '  ' + pr.text.slice(0, 300) +
          '\n\n' + sent + ' rows already loaded.');
      }
      sent += pr.n;
    }

    pages++;
    offset += list.length;
    if (cursorProp) props.setProperty(cursorProp, String(offset));
    Logger.log('  page ' + pages + ': ' + offset + ' of ' + total +
      ', pushed ' + sent + ', skipped ' + skipped +
      '   (' + Math.round((Date.now() - t0) / 1000) + 's)');

    if (total && offset >= total) break;
    if (list.length < SAB.PAGE) break;
    Utilities.sleep(SAB.GAP);
  }

  const done = !ranOut && (!total || offset >= total);
  if (done && cursorProp) props.deleteProperty(cursorProp);

  const msg = (done ? source + ' COMPLETE' : source + ' — PART WAY') +
    '  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'window  : ' + fromDay + ' to ' + toDay + '\n' +
    'pages   : ' + pages + '\n' +
    'read    : ' + offset.toLocaleString() +
      (total ? ' of ' + total.toLocaleString() : '') + '\n' +
    'pushed  : ' + sent.toLocaleString() + '\n' +
    'skipped (FTP has them) : ' + skipped.toLocaleString() + '\n' +
    (done ? '' : '\nRun it again to carry on from offset ' + offset + '.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return sent;
}

/** the nine days that exist in neither the sheet nor the FTP window */
function fillAugustGap() {
  return sabPullWindow_(SAB.GAP_FROM, SAB.GAP_TO, SAB.GAP_SOURCE, 'SAB_CUR_AUG');
}

function backfill2425() {
  return sabPullWindow_(SAB.FY2425_FROM, SAB.FY2425_TO,
    SAB.FY2425_SOURCE, SAB.FY2425_CURSOR);
}

function sabReset() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('SAB_CUR_AUG');
  props.deleteProperty(SAB.FY2425_CURSOR);
  try { SpreadsheetApp.getUi().alert('Cursors cleared. Nothing was deleted — ' +
    'the upsert makes a repeat safe.'); } catch (e) {}
}

function sabStatus() {
  const base = sabProp_(SAB.URL_PROP).replace(/\/+$/, '');
  const key = sabProp_(SAB.KEY_PROP);
  const count = function (filter) {
    const res = UrlFetchApp.fetch(
      base + '/rest/v1/sales_history?select=id' +
      (filter ? '&' + filter : '') + '&limit=1',
      { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
                   'Prefer': 'count=exact', 'Range': '0-0' },
        muteHttpExceptions: true });
    const cr = res.getHeaders()['content-range'] ||
               res.getHeaders()['Content-Range'] || '?/?';
    return String(cr).split('/')[1];
  };
  const props = PropertiesService.getScriptProperties();
  const msg = 'SALES HISTORY\n\n' +
    'total          : ' + count('') + '\n' +
    '   SHEET-2627  : ' + count('source=eq.SHEET-2627') + '\n' +
    '   SHEET-2526  : ' + count('source=eq.SHEET-2526') + '\n' +
    '   API-AUGGAP  : ' + count('source=eq.API-AUGGAP') + '\n' +
    '   API-2425    : ' + count('source=eq.API-2425') + '\n\n' +
    'cursors\n' +
    '   august : ' + (props.getProperty('SAB_CUR_AUG') || 'done or not started') + '\n' +
    '   2425   : ' + (props.getProperty(SAB.FY2425_CURSOR) || 'done or not started');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenApiBackfill() {
  SpreadsheetApp.getUi()
    .createMenu('🕳 API backfill')
    .addItem('1. Fill the August hole', 'fillAugustGap')
    .addItem('2. FY2024-25', 'backfill2425')
    .addSeparator()
    .addItem('Status', 'sabStatus')
    .addItem('Reset cursors', 'sabReset')
    .addToUi();
}