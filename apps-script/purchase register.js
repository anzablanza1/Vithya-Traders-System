/**********************************************************************
 * VITHYA TRADERS — Purchase Register Pull + Batch Cost + Lane Audit
 * [v2 — conservative pacing after observed 429s]
 *
 * WHAT CHANGED FROM v1
 *   - Default gap between pages raised 13s -> 30s (report endpoints are
 *     rate-limited harder than the product endpoints).
 *   - Exponential backoff on 429: 60s, 120s, 180s, 240s, 300s (5 tries),
 *     instead of a flat 60s x3. Retries are themselves requests, so a flat
 *     short retry just burns the budget that would let the limiter reset.
 *   - After recovering from a 429 the script adds a cool-off before the
 *     next normal call.
 *   - Pace is tunable WITHOUT editing code, via Script Property
 *         PRG_SLEEP_MS       (e.g. 45000 for 45 seconds)
 *   - Run budget trimmed to 20 min so it always exits cleanly under the
 *     30 min Workspace cap and can be resumed.
 *
 * RESUMABLE: progress is stored in Script Property PRG_CURSOR.
 * Just run pullPurchaseRegister() again and it continues where it stopped.
 *
 * RUN ORDER
 *   1. pullPurchaseRegister()   (repeat until it says COMPLETE)
 *      purchaseStatus()         to see progress at any time
 *   2. buildBatchCost()
 *   3. buildLaneAudit()
 **********************************************************************/

const PRG = {
  BASE_PROP: 'VASY_BASE_URL',
  TOKEN_PROP: 'VASY_API_TOKEN',

  RAW_SHEET: 'Purchase_Register',
  COST_SHEET: 'Batch_Cost',
  AUDIT_SHEET: 'Lane_Audit',
  PRICING_SHEET: 'Pricing',

  DATE_FROM: '2015-01-01T00:00:00Z',
  DATE_TO:   '2030-12-31T23:59:59Z',

  PAGE: 500,
  SLEEP_PROP: 'PRG_SLEEP_MS',
  SLEEP_DEFAULT: 30000,     // 30s between pages — conservative on purpose
  COOLOFF_AFTER_429: 45000, // extra pause once a 429 has been survived
  BACKOFF: [60000, 120000, 180000, 240000, 300000],
  MAX_RUN_MS: 1200000,      // 20 min, safely under the 30 min cap
  CURSOR_PROP: 'PRG_CURSOR',
  TOTAL_PROP: 'PRG_TOTAL',
};

/* ================= API ================= */

function prgProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function prgSleepMs_() {
  const v = PropertiesService.getScriptProperties().getProperty(PRG.SLEEP_PROP);
  const n = parseInt(v || '', 10);
  return (isFinite(n) && n >= 5000) ? n : PRG.SLEEP_DEFAULT;
}

/* returns { ok:true, data } or { ok:false, rateLimited:true } */
function prgPost_(path, bodyObj) {
  const url = prgProp_(PRG.BASE_PROP).replace(/\/+$/, '') + path;
  const opts = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'api-token': prgProp_(PRG.TOKEN_PROP) },
    payload: JSON.stringify(bodyObj),
    muteHttpExceptions: true,
  };

  let hit429 = false;
  for (let attempt = 0; attempt <= PRG.BACKOFF.length; attempt++) {
    const resp = UrlFetchApp.fetch(url, opts);
    const code = resp.getResponseCode();
    const body = resp.getContentText();

    if (code === 200) {
      const json = JSON.parse(body);
      if (json.status === false) throw new Error('status=false :: ' + (json.message || ''));
      if (hit429) {
        Logger.log('   recovered from 429 — cooling off ' +
                   (PRG.COOLOFF_AFTER_429 / 1000) + 's');
        Utilities.sleep(PRG.COOLOFF_AFTER_429);
      }
      return json.response || {};
    }

    if (code === 429) {
      hit429 = true;
      if (attempt === PRG.BACKOFF.length) {
        return { __rateLimited: true };
      }
      const wait = PRG.BACKOFF[attempt];
      Logger.log('   429 — backing off ' + (wait / 1000) + 's (attempt ' +
                 (attempt + 1) + '/' + PRG.BACKOFF.length + ')');
      Utilities.sleep(wait);
      continue;
    }

    if (code === 401 || code === 403) {
      throw new Error(code + ' Unauthorized — check VASY_API_TOKEN. ' + body.slice(0, 200));
    }
    throw new Error('HTTP ' + code + ' :: ' + body.slice(0, 250));
  }
  return { __rateLimited: true };
}

function prgFetchPage_(offset) {
  return prgPost_('/api/v1/report/purchase-item-register', {
    dateFrom: PRG.DATE_FROM, dateTo: PRG.DATE_TO,
    branchList: '', categoryIds: '', brandIds: '', subBrandIds: '',
    subCategoryIds: '', productIds: '', productType: '', departmentIds: '',
    contactId: '', createdByIds: '', shippingFromDate: '', shippingToDate: '',
    dueFromDate: '', dueToDate: '',
    limit: PRG.PAGE, offset: offset,
  });
}

/* ================= raw columns ================= */

const PR_COLS = ['purchaseId','billDate','billNo','voucherNo','contactId','partyName',
  'address','gstNo','panNo','department','category','subCategory','brand','subBrand',
  'unit','hsn','productType','productName','shortDescription','itemCode',
  'rate','landingCost','mrp','sellingPrice','qty','freeQty',
  'discount1','discount2','flatDiscountAmount','cessRate','cessAmount',
  'totalAmount','taxableAmount','cgst','igst','sgst','taxRate','taxAmount',
  'tcsAmount','tdsAmount','location','totalBillAmount','createdBy'];

function prgRow_(it) {
  return PR_COLS.map(c => (it[c] !== undefined && it[c] !== null) ? it[c] : '');
}

function prgSheet_(reset) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PRG.RAW_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PRG.RAW_SHEET);
    sh.getRange(1, 1, 1, PR_COLS.length).setValues([PR_COLS]);
    sh.setFrozenRows(1);
  } else if (reset) {
    sh.clear();
    sh.getRange(1, 1, 1, PR_COLS.length).setValues([PR_COLS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ================= PULL ================= */

function pullPurchaseRegister() {
  const props = PropertiesService.getScriptProperties();
  const t0 = Date.now();
  const gap = prgSleepMs_();

  let cursor = parseInt(props.getProperty(PRG.CURSOR_PROP) || '0', 10);
  const sh = prgSheet_(cursor === 0);
  Logger.log('Resuming at row ' + cursor + ' | page gap ' + (gap / 1000) + 's');

  let wrote = 0;
  let total = parseInt(props.getProperty(PRG.TOTAL_PROP) || '0', 10);

  while (true) {
    if (Date.now() - t0 > PRG.MAX_RUN_MS) {
      Logger.log('Time budget reached at ' + cursor + (total ? '/' + total : '') +
                 '. Run pullPurchaseRegister() again to continue.');
      try { SpreadsheetApp.getUi().alert('Paused at ' + cursor + (total ? ' / ' + total : '') +
        '.\n\nRun pullPurchaseRegister() again to continue.'); } catch (e) {}
      return cursor;
    }

    const page = prgFetchPage_(cursor);

    if (page && page.__rateLimited) {
      Logger.log('Rate limited repeatedly. Stopping cleanly at ' + cursor + '.');
      Logger.log('Wait a few minutes, then run pullPurchaseRegister() again.');
      Logger.log('If it keeps happening, raise the gap: Script Property ' +
                 PRG.SLEEP_PROP + ' = 60000');
      try { SpreadsheetApp.getUi().alert('Rate limited. Stopped at ' + cursor +
        '.\n\nWait a few minutes and run pullPurchaseRegister() again.\n\n' +
        'If it repeats, set Script Property ' + PRG.SLEEP_PROP + ' = 60000'); } catch (e) {}
      return cursor;
    }

    if (!total) {
      total = Number(page.totalCount || 0);
      if (total) props.setProperty(PRG.TOTAL_PROP, String(total));
      Logger.log('Total purchase lines: ' + total);
    }

    const items = page.items || [];
    if (!items.length) break;

    sh.getRange(sh.getLastRow() + 1, 1, items.length, PR_COLS.length)
      .setValues(items.map(prgRow_));
    wrote += items.length;
    cursor += items.length;
    props.setProperty(PRG.CURSOR_PROP, String(cursor));
    Logger.log('  ' + cursor + ' / ' + total);

    if (cursor >= total) break;
    Utilities.sleep(gap);
  }

  props.deleteProperty(PRG.CURSOR_PROP);
  props.deleteProperty(PRG.TOTAL_PROP);
  const msg = 'COMPLETE — ' + wrote + ' line(s) this run, ' + cursor + ' total.\n\n' +
              'Now run buildBatchCost().';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return cursor;
}

function purchaseStatus() {
  const props = PropertiesService.getScriptProperties();
  const cursor = props.getProperty(PRG.CURSOR_PROP);
  const total = props.getProperty(PRG.TOTAL_PROP);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PRG.RAW_SHEET);
  const rows = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  const msg = 'Purchase register\n\nRows in sheet: ' + rows +
              '\nCursor: ' + (cursor === null ? '(none — finished or not started)' : cursor) +
              '\nTotal: ' + (total || 'unknown') +
              '\nPage gap: ' + (prgSleepMs_() / 1000) + 's';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function resetPurchasePull() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PRG.CURSOR_PROP);
  props.deleteProperty(PRG.TOTAL_PROP);
  Logger.log('Cursor reset — next run starts from zero and clears the sheet.');
  try { SpreadsheetApp.getUi().alert('Cursor reset. Next pull starts fresh.'); } catch (e) {}
}

/* ================= helpers ================= */

function prgNum_(v) { const n = Number(v); return isFinite(n) ? n : null; }
function prgCanon_(code) { return String(code || '').trim().replace(/\/+$/, ''); }
function prgItemLane_(code) { return String(code || '').trim().slice(-1) === '/' ? 'WO' : 'W'; }
function prgSupplierLane_(name) {
  return String(name || '').trim().charAt(0) === '.' ? 'NON_GST' : 'GST';
}
function prgDate_(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

/* ================= BATCH COST ================= */

const BC_COLS = ['canonical_code','description','category','brand',
  'last_bill_date','last_bill_no','last_supplier','last_supplier_lane','last_entered_by',
  'w_last_rate','w_last_landing','w_last_date',
  'wo_last_rate','wo_last_landing','wo_last_date',
  'lane_rate_gap_pct','times_purchased','distinct_suppliers',
  'min_rate','max_rate','avg_rate','rate_spread_pct',
  'first_bill_date','total_qty_purchased','master_cost','delta_vs_master_pct','flag'];

function buildBatchCost() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(PRG.RAW_SHEET);
  if (!src || src.getLastRow() < 2) throw new Error('No data in ' + PRG.RAW_SHEET);

  const data = src.getRange(2, 1, src.getLastRow() - 1, PR_COLS.length).getValues();
  const I = {};
  PR_COLS.forEach((c, i) => I[c] = i);

  const agg = {};
  data.forEach(r => {
    const code = String(r[I.itemCode] || '').trim();
    if (!code) return;
    const canon = prgCanon_(code);
    const lane = prgItemLane_(code);
    const d = prgDate_(r[I.billDate]);
    const rate = prgNum_(r[I.rate]);
    const land = prgNum_(r[I.landingCost]);
    const qty = prgNum_(r[I.qty]) || 0;

    if (!agg[canon]) {
      agg[canon] = { desc: '', cat: '', brand: '', n: 0, suppliers: {},
        rates: [], qty: 0, first: null, last: null,
        lastBill: '', lastSup: '', lastSupLane: '', lastBy: '', W: null, WO: null };
    }
    const a = agg[canon];
    if (!a.desc) a.desc = String(r[I.productName] || '').replace(/\/+\s*$/, '').trim();
    if (!a.cat) a.cat = r[I.category] || '';
    if (!a.brand) a.brand = r[I.brand] || '';
    a.n++;
    a.qty += qty;
    if (rate !== null) a.rates.push(rate);
    const sup = String(r[I.partyName] || '').trim();
    if (sup) a.suppliers[sup] = true;
    if (d) {
      if (!a.first || d < a.first) a.first = d;
      if (!a.last || d >= a.last) {
        a.last = d;
        a.lastBill = r[I.billNo] || '';
        a.lastSup = sup;
        a.lastSupLane = prgSupplierLane_(sup);
        a.lastBy = r[I.createdBy] || '';
      }
      const cur = a[lane];
      if (!cur || d >= cur.date) a[lane] = { date: d, rate: rate, land: land };
    }
  });

  const master = {};
  const pg = ss.getSheetByName(PRG.PRICING_SHEET);
  if (pg && pg.getLastRow() > 1) {
    pg.getRange(2, 2, pg.getLastRow() - 1, 3).getValues().forEach(r => {
      const c = String(r[0] || '').trim();
      if (c) master[c] = Number(r[2]);
    });
  }

  const fmt = d => d ? Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd') : '';
  const out = [];
  Object.keys(agg).sort().forEach(canon => {
    const a = agg[canon];
    const w = a.W, wo = a.WO;
    const rates = a.rates;
    const mn = rates.length ? Math.min.apply(null, rates) : null;
    const mx = rates.length ? Math.max.apply(null, rates) : null;
    const av = rates.length ? rates.reduce((s, v) => s + v, 0) / rates.length : null;
    const spread = (mn && mn > 0 && mx !== null) ? (mx - mn) / mn * 100 : null;

    let gap = null;
    if (w && wo && w.rate && wo.rate && w.rate > 0) gap = (wo.rate - w.rate) / w.rate * 100;

    const base = (w && w.rate !== null) ? w.rate : (wo ? wo.rate : null);
    const mc = master[canon];
    let dPct = null, flag = '';
    if (base !== null && mc !== undefined && isFinite(mc) && mc > 0) {
      dPct = (base - mc) / mc * 100;
      const ab = Math.abs(dPct);
      flag = ab < 1 ? '' : (ab < 10 ? 'MOVED' : 'BIG_MOVE');
    } else if (mc === undefined || !isFinite(mc) || mc === 0) {
      flag = 'NO_MASTER_COST';
    }
    if (spread !== null && spread > 25) flag = flag ? flag + '+VOLATILE' : 'VOLATILE';

    out.push([canon, a.desc, a.cat, a.brand,
      fmt(a.last), a.lastBill, a.lastSup, a.lastSupLane, a.lastBy,
      w ? w.rate : '', w ? w.land : '', w ? fmt(w.date) : '',
      wo ? wo.rate : '', wo ? wo.land : '', wo ? fmt(wo.date) : '',
      gap === null ? '' : Math.round(gap * 100) / 100,
      a.n, Object.keys(a.suppliers).length,
      mn === null ? '' : mn, mx === null ? '' : mx,
      av === null ? '' : Math.round(av * 1000) / 1000,
      spread === null ? '' : Math.round(spread * 100) / 100,
      fmt(a.first), a.qty,
      mc === undefined ? '' : mc,
      dPct === null ? '' : Math.round(dPct * 100) / 100,
      flag]);
  });

  let sh = ss.getSheetByName(PRG.COST_SHEET);
  if (!sh) sh = ss.insertSheet(PRG.COST_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, BC_COLS.length).setValues([BC_COLS]);
  sh.setFrozenRows(1);
  if (out.length) sh.getRange(2, 1, out.length, BC_COLS.length).setValues(out);

  const purchased = {};
  out.forEach(r => purchased[r[0]] = true);
  let noHistory = 0;
  Object.keys(master).forEach(c => { if (!purchased[c]) noHistory++; });

  let volatile_ = 0, bigMove = 0, bothLanes = 0;
  out.forEach(r => {
    if (String(r[26]).indexOf('VOLATILE') >= 0) volatile_++;
    if (String(r[26]).indexOf('BIG_MOVE') >= 0) bigMove++;
    if (r[9] !== '' && r[12] !== '') bothLanes++;
  });

  const msg = 'Batch_Cost built.\n\n' +
    'Products with purchase history: ' + out.length + '\n' +
    'Purchased in BOTH lanes: ' + bothLanes + '\n' +
    'Master products with NO purchase history: ' + noHistory + '\n' +
    'Cost moved >10% vs master: ' + bigMove + '\n' +
    'Volatile (rate spread >25%): ' + volatile_ + '\n\n' +
    'Nothing in Pricing was changed.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= LANE AUDIT ================= */

const LA_COLS = ['billDate','billNo','partyName','supplier_lane','itemCode','item_lane',
  'lane_match','productName','qty','rate','landingCost','taxRate','taxAmount',
  'tax_per_unit','expected_landing_with_tax','tax_treatment','issue','createdBy'];

function buildLaneAudit() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(PRG.RAW_SHEET);
  if (!src || src.getLastRow() < 2) throw new Error('No data in ' + PRG.RAW_SHEET);

  const data = src.getRange(2, 1, src.getLastRow() - 1, PR_COLS.length).getValues();
  const I = {};
  PR_COLS.forEach((c, i) => I[c] = i);

  const out = [];
  let cross = 0, taxIn = 0, taxOut = 0, ambiguous = 0, clean = 0;

  data.forEach(r => {
    const code = String(r[I.itemCode] || '').trim();
    if (!code) return;
    const sup = String(r[I.partyName] || '').trim();
    const sLane = prgSupplierLane_(sup);
    const iLane = prgItemLane_(code);
    const match = ((sLane === 'GST' && iLane === 'W') ||
                   (sLane === 'NON_GST' && iLane === 'WO')) ? 'OK' : 'CROSS';
    if (match === 'CROSS') cross++;

    const rate = prgNum_(r[I.rate]);
    const land = prgNum_(r[I.landingCost]);
    const qty = prgNum_(r[I.qty]) || 0;
    const taxAmt = prgNum_(r[I.taxAmount]) || 0;
    const perUnitTax = qty > 0 ? taxAmt / qty : 0;
    const expWith = (rate === null) ? null : rate + perUnitTax;

    let treatment = '';
    if (taxAmt === 0) {
      treatment = 'NO_TAX';
    } else if (rate !== null && land !== null) {
      const dSame = Math.abs(land - rate);
      const dWith = expWith === null ? 1e9 : Math.abs(land - expWith);
      if (dSame <= 0.01 && dWith > 0.01) { treatment = 'TAX_SEPARATE'; taxOut++; }
      else if (dWith <= Math.max(0.02, Math.abs(perUnitTax) * 0.02)) { treatment = 'TAX_IN_LANDING'; taxIn++; }
      else { treatment = 'UNCLEAR'; ambiguous++; }
    }

    let issue = '';
    if (match === 'CROSS') issue = 'lane cross-entry';
    if (treatment === 'UNCLEAR') issue = issue ? issue + '; unclear tax' : 'unclear tax in landing cost';

    if (issue) {
      out.push([r[I.billDate], r[I.billNo], sup, sLane, code, iLane, match,
        r[I.productName], qty, rate, land, r[I.taxRate], taxAmt,
        Math.round(perUnitTax * 1000) / 1000,
        expWith === null ? '' : Math.round(expWith * 1000) / 1000,
        treatment, issue, r[I.createdBy]]);
    } else {
      clean++;
    }
  });

  let sh = ss.getSheetByName(PRG.AUDIT_SHEET);
  if (!sh) sh = ss.insertSheet(PRG.AUDIT_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, LA_COLS.length).setValues([LA_COLS]);
  sh.setFrozenRows(1);
  if (out.length) sh.getRange(2, 1, out.length, LA_COLS.length).setValues(out);

  const msg = 'Lane_Audit built — ' + out.length + ' problem line(s).\n\n' +
    'Clean lines: ' + clean + '\n' +
    'Lane cross-entries: ' + cross + '\n' +
    'Tax folded INTO landing cost: ' + taxIn + '\n' +
    'Tax kept SEPARATE: ' + taxOut + '\n' +
    'Unclear treatment: ' + ambiguous;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}