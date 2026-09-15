/**********************************************************************
 * VITHYA TRADERS — SALES ITEM REGISTER  (line level)
 *
 * This is what unlocks realised margin, velocity, ABC, reorder and dead stock.
 *
 * ENDPOINT  POST /api/v1/report/sales-item-register/invoice
 *           body: { branch_list, from_date, to_date, limit (<=500), offset }
 *
 * ── THE SIZE PROBLEM, AND WHAT WE DO ABOUT IT ──
 *   All 43 fields x 249,609 lines = 10.7M cells — over the 10M workbook limit
 *   before a single new sale. So:
 *     1. Only 18 fields are stored, not 43. The rest are derivable or unused.
 *     2. Pulled MONTH BY MONTH, so a failure costs one month, not the run.
 *     3. Sales_Monthly (product x month) is built from it — that is what the
 *        dashboards read. Raw lines are for drill-down only.
 *     4. purgeOldSalesItems() drops raw lines older than a cutoff once the
 *        rollup has captured them. The analysis keeps full history; the raw
 *        detail keeps a rolling window.
 *
 * PACING  This IS a /report/ endpoint, so it rate-limits hard. The gap starts
 *         at 15s and doubles on any 429, remembering what worked.
 *
 * WRITES TO VT_Transactions.
 *
 * RUN
 *   1. siProbe()            read only — lines per month, one real line
 *   2. pullSalesItems()     resumable + auto-continuing
 *   3. buildSalesMonthly()  the rollup the dashboards read
 *   4. purgeOldSalesItems('2026-04-01')   optional, after the rollup exists
 **********************************************************************/

const SI = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',

  PATH: '/api/v1/report/sales-item-register/invoice',
  SHEET: 'Sales_Items',
  ROLL: 'Sales_Monthly',

  MONTH: 'SI_MONTH',        // which month we are on, yyyy-MM
  OFFSET: 'SI_OFFSET',
  GAP: 'SI_GAP',

  START: '2025-04',         // FY25-26 onward
  PAGE: 500,
  GAP_START: 20000,         // observed: ~18 calls at 15s then a 429
  GAP_MIN: 12000,
  GAP_MAX: 45000,           // 60s made the whole job 6+ hours
  GAP_UP: 1.4,              // gentle, not doubling
  GAP_DOWN: 0.85,           // and it can recover
  OK_BEFORE_FASTER: 15,     // consecutive good calls before easing off
  OKC: 'SI_OK_COUNT',
  BACKOFF: [45000, 90000, 150000],
  MAX_RUN_MS: 260000,       // 4.3 min — triggered runs are capped well below
                            // the manual limit, and sleep() counts toward it
  MANUAL_RUN_MS: 1500000,   // 25 min — a manual run gets the full allowance
  MANUAL: 'SI_MANUAL',
};

/* 27 of the 53 fields the register returns.
   Dropped only what is redundant or derivable:
     branchId/branchName      single branch
     cgst/igst/cess*          derivable from taxAmount + taxRate
     taxIncluded, *Type       formatting flags
     basicValue               equals netAmount here
     taxExclusiveMrp          equals mrp for WO, derivable for W
     flat/bill/other/itemTotalDiscount   subsumed by totalDiscount
     createdBy                duplicate of employeeName
     address, tcsAmount, mrpAmount, total   not used by any analysis

   NOTE: the register has NO salesId — it returns salesNo. That is the join
   key back to Sales_Invoices. */
const SI_COLS = ['salesNo','salesDate','type','customerName','mobNo',
  'itemCode','productName','productType','categoryName','subCategoryName',
  'brandName','subBrandName','departmentName','hsnCode','measurementCode',
  'batchNo','qty','mrp','price','sellingPrice','purchasePrice','landingCost',
  'netAmount','discount','taxRate','taxAmount','profit','employeeName',
  'receiptData'];

function siProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}
function siGap_() {
  const n = parseInt(PropertiesService.getScriptProperties().getProperty(SI.GAP) || '', 10);
  return isFinite(n) && n > 0 ? n : SI.GAP_START;
}
function siSlower_() {
  const p = PropertiesService.getScriptProperties();
  const now = siGap_();
  const next = Math.min(SI.GAP_MAX, Math.round(now * SI.GAP_UP));
  p.setProperty(SI.GAP, String(next));
  p.setProperty(SI.OKC, '0');
  Logger.log('   pace: ' + now + 'ms -> ' + next + 'ms');
}

/* after a run of clean calls, ease back toward the fast end.
   Without this the pace only ever ratchets up and never recovers. */
function siFaster_() {
  const p = PropertiesService.getScriptProperties();
  const okc = parseInt(p.getProperty(SI.OKC) || '0', 10) + 1;
  if (okc < SI.OK_BEFORE_FASTER) { p.setProperty(SI.OKC, String(okc)); return; }
  const now = siGap_();
  const next = Math.max(SI.GAP_MIN, Math.round(now * SI.GAP_DOWN));
  p.setProperty(SI.OKC, '0');
  if (next !== now) {
    p.setProperty(SI.GAP, String(next));
    Logger.log('   pace: ' + now + 'ms -> ' + next + 'ms (recovering)');
  }
}
function siNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function siDate_(v) {
  if (!v) return '';
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : String(v).slice(0, 10);
}

function siPost_(body) {
  const url = siProp_(SI.BASE).replace(/\/+$/, '') + SI.PATH;
  for (let a = 0; a <= SI.BACKOFF.length; a++) {
    const r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'api-token': siProp_(SI.TOKEN) },
      payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    const code = r.getResponseCode(), txt = r.getContentText();
    if (code === 200) {
      const j = JSON.parse(txt);
      if (j.status === false) throw new Error('API: ' + (j.message || ''));
      return j.response || {};
    }
    if (code === 429) {
      siSlower_();
      if (a === SI.BACKOFF.length) return { __rate: true };
      Logger.log('   429 — waiting ' + (SI.BACKOFF[a] / 1000) + 's');
      Utilities.sleep(SI.BACKOFF[a]);
      continue;
    }
    throw new Error('HTTP ' + code + ' :: ' + txt.slice(0, 250));
  }
  return { __rate: true };
}

/* month window helpers: 'yyyy-MM' -> ISO from / to */
function siWindow_(ym) {
  const y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
  const from = ym + '-01T00:00:00Z';
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const to = ny + '-' + ('0' + nm).slice(-2) + '-01T00:00:00Z';
  return { from: from, to: to };
}
function siNextMonth_(ym) {
  const y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return ny + '-' + ('0' + nm).slice(-2);
}
function siThisMonth_() {
  const d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}
function siBody_(ym, limit, offset) {
  const w = siWindow_(ym);
  return { branch_list: siProp_(SI.BRANCH), from_date: w.from, to_date: w.to,
    limit: limit, offset: offset };
}
function siRows_(d) { return (d && d.salesItemRegisterData) || []; }

/* Google Sheets silently converts a 'yyyy-MM-dd' string into a Date on write.
   Reading it back and doing String(x).slice(0,7) produced "Fri Feb" instead of
   "2025-04", which broke every downstream month key. This handles both. */
function siMonthOf_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM');
  }
  const m = String(v || '').match(/^\d{4}-\d{2}/);
  return m ? m[0] : '';
}

/* ================= 1. probe ================= */

function siProbe() {
  Logger.log('════════ SALES ITEM REGISTER ════════');
  let ym = SI.START, grand = 0;
  const stop = siNextMonth_(siThisMonth_());
  while (ym !== stop) {
    const r = siPost_(siBody_(ym, 1, 0));
    if (r.__rate) { Logger.log('   ' + ym + ' : rate limited — stopping probe'); break; }
    const n = siNum_(r.totalCount);
    grand += n;
    Logger.log('   ' + ym + ' : ' + n + ' lines');
    ym = siNextMonth_(ym);
    if (ym !== stop) Utilities.sleep(siGap_());
  }
  Logger.log('');
  Logger.log('TOTAL from ' + SI.START + ' : ' + grand + ' lines');
  const calls = Math.ceil(grand / SI.PAGE);
  Logger.log('at ' + SI.PAGE + '/call = ' + calls + ' calls');
  Logger.log('at ' + (siGap_() / 1000) + 's gap ≈ ' +
    Math.round(calls * siGap_() / 60000) + ' min');
  Logger.log('storage: ' + grand + ' x ' + SI_COLS.length + ' = ' +
    (grand * SI_COLS.length).toLocaleString() + ' cells');
  try { SpreadsheetApp.getUi().alert(grand + ' lines from ' + SI.START +
    '.\n≈' + calls + ' calls. See the log.'); } catch (e) {}
}

/* ================= 2. pull ================= */

function siSheet_() {
  const ss = txnBook_();
  let sh = vtSheet(SI.SHEET);
  if (!sh) {
    sh = ss.insertSheet(SI.SHEET);
    sh.getRange(1, 1, 1, SI_COLS.length).setValues([SI_COLS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SI_COLS.length).setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
  }
  /* keep salesDate as TEXT so Sheets cannot coerce it into a Date */
  const dcol = SI_COLS.indexOf('salesDate') + 1;
  if (dcol > 0) sh.getRange(1, dcol, sh.getMaxRows(), 1).setNumberFormat('@');
  return sh;
}

/**
 * Manual mode: the full 25-minute allowance and NO trigger is created.
 * Use this while triggers are deliberately off — 7 runs instead of 39, and
 * nothing schedules itself behind your back.
 */
function pullSalesItemsManual() {
  PropertiesService.getScriptProperties().setProperty(SI.MANUAL, '1');
  try { return pullSalesItems(); }
  finally { PropertiesService.getScriptProperties().deleteProperty(SI.MANUAL); }
}

function pullSalesItems() {
  const props = PropertiesService.getScriptProperties();
  const manual = props.getProperty(SI.MANUAL) === '1';
  const budget = manual ? SI.MANUAL_RUN_MS : SI.MAX_RUN_MS;
  const t0 = Date.now();
  let ym = props.getProperty(SI.MONTH) || SI.START;
  let offset = parseInt(props.getProperty(SI.OFFSET) || '0', 10);
  const stop = siNextMonth_(siThisMonth_());
  const sh = siSheet_();
  let wrote = 0;

  Logger.log('Resuming at ' + ym + ' offset ' + offset);

  while (ym !== stop) {
    if (Date.now() - t0 > budget) {
      if (!manual) siQueueNext_(1);
      Logger.log('Time budget reached at ' + ym + ' offset ' + offset +
        (manual ? '. Run pullSalesItemsManual() again.' : '. Auto-continuing shortly.'));
      try { SpreadsheetApp.getUi().alert('Paused at ' + ym + ' offset ' + offset +
        (manual ? '.\nRun pullSalesItemsManual() again.' : '.\nContinuing automatically.')); } catch (e) {}
      return;
    }

    const r = siPost_(siBody_(ym, SI.PAGE, offset));
    if (r.__rate) {
      siQueueNext_(3);
      Logger.log('Rate limited at ' + ym + ' offset ' + offset + '. Retrying in ~3 min.');
      try { SpreadsheetApp.getUi().alert('Rate limited.\nWill retry automatically.'); } catch (e) {}
      return;
    }

    siFaster_();
    const rows = siRows_(r);
    const total = siNum_(r.totalCount);

    if (rows.length) {
      const vals = rows.map(o => [
        o.salesNo || '', siDate_(o.salesDate), o.type || '',
        String(o.customerName || '').trim(), o.mobNo || '',
        o.itemCode || '', o.productName || '', o.productType || '',
        o.categoryName || '', o.subCategoryName || '',
        o.brandName || '', o.subBrandName || '', o.departmentName || '',
        o.hsnCode || '', o.measurementCode || '',
        o.batchNo || '', siNum_(o.qty),
        siNum_(o.mrp), siNum_(o.price), siNum_(o.sellingPrice),
        siNum_(o.purchasePrice), siNum_(o.landingCost),
        siNum_(o.netAmount), siNum_(o.totalDiscount), siNum_(o.taxRate),
        siNum_(o.taxAmount), siNum_(o.profit),
        o.employeeName || '', o.receiptData || '',
      ]);
      sh.getRange(sh.getLastRow() + 1, 1, vals.length, SI_COLS.length).setValues(vals);
      wrote += vals.length;
      offset += rows.length;
    }

    if (!rows.length || offset >= total) {
      Logger.log('  ' + ym + ' done (' + total + ' lines)');
      ym = siNextMonth_(ym);
      offset = 0;
    } else {
      Logger.log('  ' + ym + '  ' + offset + ' / ' + total);
    }
    props.setProperty(SI.MONTH, ym);
    props.setProperty(SI.OFFSET, String(offset));
    if (ym === stop) break;
    /* would the next sleep push us past the budget? stop now instead */
    if (Date.now() - t0 + siGap_() > budget) {
      if (!manual) siQueueNext_(1);
      Logger.log('Stopping before the next wait, at ' + ym + ' offset ' + offset + '.');
      return;
    }
    Utilities.sleep(siGap_());
  }

  siClearTriggers_();
  props.deleteProperty(SI.MONTH);
  props.deleteProperty(SI.OFFSET);
  const msg = 'COMPLETE — ' + wrote + ' line(s) this run.\nTotal rows: ' +
    (sh.getLastRow() - 1) + '\n\nNext: buildSalesMonthly()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function siQueueNext_(mins) {
  siClearTriggers_();
  ScriptApp.newTrigger('pullSalesItems').timeBased().after(mins * 60 * 1000).create();
}
function siClearTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'pullSalesItems') ScriptApp.deleteTrigger(t);
  });
}

/* ================= 3. monthly rollup ================= */

const ROLL_COLS = ['item_code','month','product_name','category','brand',
  'qty','revenue','cost','profit','margin_pct','discount',
  'w_qty','wo_qty','invoices','customers'];

/**
 * VT-051: read v_sales_monthly_rollup from Supabase, in ROLL_COLS order.
 * Returns null if not configured or unreachable, so the caller falls back.
 */
function siRollupFromSupabase_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) return null;
  const base = url.replace(/\/+$/, '');
  const out = [];
  for (let p = 0; p < 100; p++) {
    const res = UrlFetchApp.fetch(
      base + '/rest/v1/v_sales_monthly_rollup?select=code,month,name,category,' +
      'brand,qty,revenue,cost,profit,margin_pct,discount,qty_w,qty_wo,invoices,' +
      'customers&order=code.asc,month.asc&limit=5000&offset=' + (p * 5000),
      { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
        muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      if (p === 0) throw new Error('HTTP ' + res.getResponseCode());
      break;
    }
    const arr = JSON.parse(res.getContentText());
    if (!arr.length) break;
    arr.forEach(function (r) {
      out.push([r.code, r.month, r.name, r.category, r.brand,
        r.qty, r.revenue, r.cost, r.profit, r.margin_pct, r.discount,
        r.qty_w, r.qty_wo, r.invoices, r.customers]);
    });
    if (arr.length < 5000) break;
  }
  return out;
}

function buildSalesMonthly(force) {
  const ss = txnBook_();

  /* VT-051: the rollup now lives in Supabase as v_sales_monthly_rollup — the
     same 15 columns, computed by an indexed query over all 266,177 lines
     instead of grinding them here (285s and climbing). If Supabase answers,
     copy its rows straight in. The old sheet-grind stays below as the
     fallback for when Supabase is unreachable. */
  try {
    const fromDb = siRollupFromSupabase_();
    if (fromDb && fromDb.length) {
      vtGuardRebuild_(SI.ROLL, fromDb.length, force);
      let rs = vtSheet(SI.ROLL) || ss.insertSheet(SI.ROLL);
      rs.clear();
      rs.getRange(1, 2, rs.getMaxRows(), 1).setNumberFormat('@');  // month text
      rs.getRange(1, 1, 1, ROLL_COLS.length).setValues([ROLL_COLS]);
      rs.setFrozenRows(1);
      rs.getRange(1, 1, 1, ROLL_COLS.length).setFontWeight('bold')
        .setBackground('#CC3018').setFontColor('#FFFFFF');
      const B = 5000;
      for (let i = 0; i < fromDb.length; i += B) {
        const blk = fromDb.slice(i, i + B);
        rs.getRange(2 + i, 1, blk.length, ROLL_COLS.length).setValues(blk);
      }
      const rev = fromDb.reduce(function (t, r) { return t + (Number(r[6])||0); }, 0);
      const msg = 'SALES_MONTHLY BUILT (from Supabase)\n\n' +
        'rows: ' + fromDb.length + '\n' +
        'revenue: Rs ' + Math.round(rev).toLocaleString('en-IN') + '\n\n' +
        'One query instead of grinding 266k rows.';
      Logger.log(msg);
      try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
      try { vtInvalidate(); } catch (e) {}
      return fromDb.length;
    }
  } catch (e) {
    Logger.log('Supabase rollup unavailable (' + e.message +
      '), falling back to the sheet grind.');
  }

  /* ---- fallback: the original in-sheet aggregation ---- */
  let all = null;
  try { all = readSalesAcrossYears(SI.SHEET); } catch (e) { all = null; }
  if (!all || !all.rows.length) {
    const sh = vtSheet(SI.SHEET);
    if (!sh || sh.getLastRow() < 2) throw new Error('No sales lines found.');
    const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const H0 = {};
    hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H0[k] = i; });
    all = { H: H0, rows: sh.getRange(2, 1, sh.getLastRow() - 1,
      sh.getLastColumn()).getValues(), tabs: 1 };
  }
  const H = all.H;

  const agg = {};
  all.rows.forEach(function (r) {
    const code = String(r[H.itemCode] || '').trim();
    if (!code) return;
    const month = siMonthOf_(r[H.salesDate]);
    if (!month) return;
    const canon = code.replace(/\/+$/, '');
    const isWO = code.slice(-1) === '/';
    const k = canon + '|' + month;
    if (!agg[k]) agg[k] = { code: canon, month: month,
      name: String(r[H.productName] || '').replace(/\s*\/$/, ''),
      cat: r[H.categoryName] || '', brand: r[H.brandName] || '',
      qty: 0, rev: 0, cost: 0, profit: 0, disc: 0,
      wq: 0, woq: 0, inv: {}, cust: {} };
    const a = agg[k];
    const q = siNum_(r[H.qty]);
    a.qty += q;
    a.rev += siNum_(r[H.netAmount]);
    a.cost += siNum_(r[H.landingCost]);
    a.profit += siNum_(r[H.profit]);
    a.disc += siNum_(r[H.discount]);
    if (isWO) a.woq += q; else a.wq += q;
    const sno = String(r[H.salesNo] || '');
    if (sno) a.inv[sno] = 1;
    const cn = String(r[H.customerName] || '').trim();
    if (cn) a.cust[cn] = 1;
  });

  const r2 = x => Math.round(x * 100) / 100;
  const out = Object.keys(agg).map(k => {
    const a = agg[k];
    return [a.code, a.month, a.name, a.cat, a.brand,
      r2(a.qty), r2(a.rev), r2(a.cost), r2(a.profit),
      a.rev > 0 ? Math.round(a.profit / a.rev * 10000) / 100 : '',
      r2(a.disc), r2(a.wq), r2(a.woq),
      Object.keys(a.inv).length, Object.keys(a.cust).length];
  }).sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : (x[0] < y[0] ? -1 : 1)));

  try { vtGuardRebuild_(SI.ROLL, out.length, force); } catch (e) { throw e; }
  let rs = vtSheet(SI.ROLL);
  if (!rs) rs = ss.insertSheet(SI.ROLL);
  rs.clear();
  /* month must stay text, or '2025-04' becomes a date and the bug returns */
  rs.getRange(1, 2, rs.getMaxRows(), 1).setNumberFormat('@');
  rs.getRange(1, 1, 1, ROLL_COLS.length).setValues([ROLL_COLS]);
  rs.setFrozenRows(1);
  rs.getRange(1, 1, 1, ROLL_COLS.length).setFontWeight('bold')
    .setBackground('#CC3018').setFontColor('#FFFFFF');
  const B = 5000;
  for (let i = 0; i < out.length; i += B) {
    const blk = out.slice(i, i + B);
    rs.getRange(2 + i, 1, blk.length, ROLL_COLS.length).setValues(blk);
  }

  const prods = {}; out.forEach(r => prods[r[0]] = 1);
  const rev = out.reduce((s, r) => s + r[6], 0);
  const pro = out.reduce((s, r) => s + r[8], 0);
  const mset = {}; out.forEach(r => mset[r[1]] = 1);
  const mlist = Object.keys(mset).sort();
  const badMonths = mlist.filter(m => !/^\d{4}-\d{2}$/.test(m));
  const msg = 'SALES_MONTHLY BUILT\n\n' +
    'rows: ' + out.length + '   products: ' + Object.keys(prods).length + '\n' +
    'months: ' + mlist.length + '   ' +
    (mlist.length ? mlist[0] + ' .. ' + mlist[mlist.length - 1] : '') + '\n' +
    'revenue: Rs ' + Math.round(rev).toLocaleString('en-IN') + '\n' +
    'profit:  Rs ' + Math.round(pro).toLocaleString('en-IN') +
    (rev ? '   (' + (pro / rev * 100).toFixed(1) + '%)' : '') +
    (badMonths.length ?
      '\n\n⚠ ' + badMonths.length + ' month key(s) are not yyyy-MM: ' +
      badMonths.slice(0, 4).join(', ') + '\nThe date column was coerced — tell me.' :
      '\n\nMonth keys look correct.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= 4. purge old raw lines ================= */

/**
 * Drops raw lines before the cutoff. Run ONLY after buildSalesMonthly(),
 * which keeps the analysis for those months. Rolling raw window, full history
 * in the rollup.
 */
function purgeOldSalesItems(beforeYm) {
  if (!beforeYm) throw new Error("Pass a cutoff, e.g. purgeOldSalesItems('2026-04')");
  const ss = txnBook_();
  const roll = vtSheet(SI.ROLL);
  if (!roll || roll.getLastRow() < 2) {
    throw new Error('Build Sales_Monthly first — otherwise the history is lost.');
  }

  const sh = vtSheet(SI.SHEET);
  if (!sh || sh.getLastRow() < 2) throw new Error('Sales_Items is empty.');
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  const n = sh.getLastRow() - 1, w = sh.getLastColumn();
  const v = sh.getRange(2, 1, n, w).getValues();

  /* which months are we about to drop? */
  const dropMonths = {};
  v.forEach(function (r) {
    const m = siMonthOf_(r[H.salesDate]);
    if (m && m < beforeYm) dropMonths[m] = (dropMonths[m] || 0) + 1;
  });
  const dropList = Object.keys(dropMonths).sort();
  if (!dropList.length) {
    const msg = 'Nothing to purge — no rows before ' + beforeYm + '.';
    Logger.log(msg);
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
    return 0;
  }

  /* SAFETY: the rollup must already cover every month being dropped, or the
     demand history disappears with the raw rows. Verified, not assumed. */
  const rh = roll.getRange(1, 1, 1, roll.getLastColumn()).getValues()[0];
  const RH = {};
  rh.forEach(function (h, i) { const k = String(h).trim(); if (k) RH[k] = i; });
  const have = {};
  roll.getRange(2, RH.month + 1, roll.getLastRow() - 1, 1).getValues()
    .forEach(function (r) {
      const m = (r[0] instanceof Date)
        ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), 'yyyy-MM')
        : String(r[0] || '').slice(0, 7);
      if (m) have[m] = 1;
    });
  const gaps = dropList.filter(function (m) { return !have[m]; });
  if (gaps.length) {
    throw new Error('REFUSING TO PURGE.\n\nSales_Monthly has no rows for: ' +
      gaps.join(', ') + '\n\nRun buildSalesMonthly() first, then try again.');
  }

  const keep = v.filter(function (r) {
    return siMonthOf_(r[H.salesDate]) >= beforeYm;
  });
  const dropped = n - keep.length;

  sh.getRange(2, 1, n, w).clearContent();
  const B = 5000;
  for (let i = 0; i < keep.length; i += B) {
    const blk = keep.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, w).setValues(blk);
  }
  /* shrink the sheet itself, or the empty rows still count toward the limit */
  const want = keep.length + 50;
  if (sh.getMaxRows() > want + 1) sh.deleteRows(want + 1, sh.getMaxRows() - want);

  const msg = 'PURGED ' + dropped.toLocaleString() + ' raw line(s) before ' + beforeYm + '\n\n' +
    'months dropped: ' + dropList.join(', ') + '\n' +
    'kept: ' + keep.length.toLocaleString() + ' rows\n' +
    'freed roughly ' + (dropped * w).toLocaleString() + ' cells\n\n' +
    'Sales_Monthly still holds every one of those months, so demand,\n' +
    'ABC, XYZ and reorder are unaffected. Only raw line drill-down\n' +
    'for those months is gone.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return dropped;
}

/* convenience: keep the current financial year only */
function purgeToCurrentFY() {
  const d = new Date();
  const fy = (d.getMonth() + 1) >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  return purgeOldSalesItems(fy + '-04');
}

function siStatus() {
  const p = PropertiesService.getScriptProperties();
  let rows = 0, roll = 0;
  try {
    const ss = txnBook_();
    const a = vtSheet(SI.SHEET), b = vtSheet(SI.ROLL);
    rows = a ? Math.max(0, a.getLastRow() - 1) : 0;
    roll = b ? Math.max(0, b.getLastRow() - 1) : 0;
  } catch (e) {}
  const auto = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pullSalesItems').length;
  const msg = 'Sales items\n\nraw rows: ' + rows + '\nrollup rows: ' + roll +
    '\nmonth: ' + (p.getProperty(SI.MONTH) || '(not started)') +
    '\noffset: ' + (p.getProperty(SI.OFFSET) || '0') +
    '\npace: ' + siGap_() + 'ms  (clean run: ' +
    (PropertiesService.getScriptProperties().getProperty(SI.OKC) || '0') + ')' +
    '\nauto-continue: ' + (auto ? 'scheduled' : 'no');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function siCancel() {
  siClearTriggers_();
  try { SpreadsheetApp.getUi().alert('Auto-continue cancelled. Position kept.'); } catch (e) {}
}
function siReset() {
  const p = PropertiesService.getScriptProperties();
  p.deleteProperty(SI.MONTH); p.deleteProperty(SI.OFFSET);
  p.deleteProperty(SI.GAP); p.deleteProperty(SI.OKC);
  siClearTriggers_();
  try { SpreadsheetApp.getUi().alert('Reset — next pull starts at ' + SI.START); } catch (e) {}
}

function onOpenSalesItems() {
  SpreadsheetApp.getUi()
    .createMenu('📦 Sales Items')
    .addItem('1. Probe (lines per month)', 'siProbe')
    .addItem('2. Pull line items', 'pullSalesItems')
    .addItem('3. Build monthly rollup', 'buildSalesMonthly')
    .addSeparator()
    .addItem('Status', 'siStatus')
    .addItem('Cancel auto-continue', 'siCancel')
    .addItem('Reset', 'siReset')
    .addToUi();
}