/**********************************************************************
 * VITHYA TRADERS — Automation
 *
 * GOAL: never click anything. The data refreshes itself overnight.
 *
 * NIGHTLY SCHEDULE (Asia/Kolkata)
 *   01:00  refreshErpSnapshot     incremental product pull from Vasy
 *   02:00  refreshPurchaseRegister  new purchase bills since last run
 *   03:00  rebuildBatchCost       rollup of the register (no API)
 *   04:00  refreshCostCurrent     resumable /product/details sweep
 *   05:30  rebuildDashData        read model + cache clear
 *
 * WHY STAGGERED: each job gets an hour to itself, so the 5-request/60s
 * API limit is never contended and one slow job cannot block another.
 *
 * COST_CURRENT IS THE SLOW ONE
 *   /product/details accepts only 10 productIds per call, so a full sweep
 *   of ~6,000 ids takes ~2.2 hours. refreshCostCurrent() works through the
 *   list a slice at a time and REMEMBERS ITS PLACE, so each nightly run
 *   continues where the last stopped and the whole catalogue is covered
 *   every few nights, unattended. Products that changed recently are done
 *   FIRST, so the numbers you actually look at are the freshest.
 *
 * INSTALL
 *   1. Paste as a new script file.
 *   2. Run installAllTriggers()  — once.
 *   3. Run showAutomationStatus() any time to see what ran and when.
 *
 * REQUIRES the existing files: VasyApiPull (incrementalPull),
 * PurchaseRegister (pullPurchaseRegister, buildBatchCost),
 * PhaseB (Cost_Current logic), DataBuilder (buildDashboardData).
 **********************************************************************/

const AUTO = {
  LOG: 'Automation_Log',
  CC_CURSOR: 'AUTO_CC_CURSOR',
  CC_SLICE_MS: 900000,        // 15 min of Cost_Current work per night
  CC_CHUNK: 10,               // proven ceiling for /product/details
  CC_SLEEP: 13000,            // 5 req / 60s
  SNAP: 'ERP_Snapshot',
  CURRENT: 'Cost_Current',
};

/* ---------- logging ---------- */

function autoLog_(job, status, detail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(AUTO.LOG);
  if (!sh) {
    sh = ss.insertSheet(AUTO.LOG);
    sh.getRange(1, 1, 1, 4).setValues([['when', 'job', 'status', 'detail']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold')
      .setBackground('#1F3864').setFontColor('#FFFFFF');
  }
  sh.appendRow([Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'), job, status, String(detail || '').slice(0, 400)]);
  // keep the log from growing forever
  if (sh.getLastRow() > 800) sh.deleteRows(2, 300);
}

function autoRun_(job, fn) {
  const t0 = Date.now();
  try {
    const res = fn();
    autoLog_(job, 'ok', (res === undefined ? '' : res) +
      '  (' + Math.round((Date.now() - t0) / 1000) + 's)');
  } catch (e) {
    autoLog_(job, 'FAILED', e.message);
  }
}

/* ---------- 1. ERP snapshot ---------- */

function refreshErpSnapshot() {
  autoRun_('ERP_Snapshot', function () {
    /* incrementalPull() filters on the product record's updatedDate, which
       moves when a product is EDITED — not when it sells. It reported 0, 12,
       5, 0 changes across four days on ~500 sales lines a day, because the
       products genuinely had not been edited. Their stock had moved.

       Stock now comes from LiveStock.gs, which pulls the whole list hourly
       and does not filter at all. This still refreshes the product master
       (names, categories, prices), which incremental IS right for. */
    const n = incrementalPull();
    return n + ' product(s) edited  (stock comes from Stock_Live)';
  });
}

/* ---------- 2. purchase register ---------- */

function refreshPurchaseRegister() {
  autoRun_('Purchase_Register', function () {
    const n = pullPurchaseRegister(); // from PurchaseRegister_v2.gs (resumable)
    return 'cursor at ' + n;
  });
}

/* ---------- 3. batch cost rollup (no API) ---------- */

function rebuildBatchCost() {
  autoRun_('Batch_Cost', function () {
    buildBatchCost();                 // from PurchaseRegister_v2.gs
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Batch_Cost');
    return (sh ? sh.getLastRow() - 1 : 0) + ' product(s)';
  });
}

/* ---------- 4. Cost_Current — resumable nightly sweep ---------- */

/* order productIds so recently-changed products refresh first */
function autoCcOrder_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(AUTO.SNAP);
  if (!sh || sh.getLastRow() < 2) throw new Error('ERP_Snapshot is empty.');
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach((h, i) => H[String(h).trim()] = i);
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  const list = [];
  vals.forEach(r => {
    const pid = r[H.productId];
    if (pid === '' || pid === null) return;
    const upd = String(r[H.updatedDate] || r[H.batchUpdatedDate] || '');
    list.push([String(pid).trim(), upd]);
  });
  list.sort((a, b) => (a[1] < b[1] ? 1 : (a[1] > b[1] ? -1 : 0)));  // newest first
  return list.map(x => x[0]);
}

function refreshCostCurrent() {
  autoRun_('Cost_Current', function () {
    const props = PropertiesService.getScriptProperties();
    let cursor = parseInt(props.getProperty(AUTO.CC_CURSOR) || '0', 10);

    /* The sweep order used to live in Script Properties as 19 sliced values
       (~152KB) which filled the 500KB quota and broke other scripts.
       It now lives in a sheet. Properties hold only the cursor. */
    let order = autoCcOrderRead_();
    if (!order.length || cursor === 0) {
      order = autoCcOrder_();
      autoCcOrderWrite_(order);
      cursor = 0;
    }

    const sh = autoCcSheet_();
    const t0 = Date.now();
    let done = 0, wrote = 0;

    while (cursor < order.length && Date.now() - t0 < AUTO.CC_SLICE_MS) {
      const slice = order.slice(cursor, cursor + AUTO.CC_CHUNK);
      let rows;
      try {
        rows = autoCcFetch_(slice);
      } catch (e) {
        autoLog_('Cost_Current', 'pause', 'stopped at ' + cursor + ': ' + e.message);
        break;
      }
      if (rows && rows.length) { autoCcUpsert_(sh, rows); wrote += rows.length; }
      cursor += slice.length;
      done += slice.length;
      props.setProperty(AUTO.CC_CURSOR, String(cursor));
      if (cursor < order.length) Utilities.sleep(AUTO.CC_SLEEP);
    }

    if (cursor >= order.length) {
      props.setProperty(AUTO.CC_CURSOR, '0');
      return 'FULL SWEEP COMPLETE (' + order.length + ' ids); restarting next run';
    }
    return done + ' id(s) this run, ' + wrote + ' row(s); at ' + cursor + '/' + order.length;
  });
}

/* the sweep order, kept in a sheet */
function autoCcOrderSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('CC_Sweep_Order');
  if (!sh) {
    sh = ss.insertSheet('CC_Sweep_Order');
    sh.getRange(1, 1).setValue('productId')
      .setFontWeight('bold').setBackground('#6C6C60').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}
function autoCcOrderRead_() {
  const sh = autoCcOrderSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 1).getValues()
    .map(r => String(r[0] || '').trim()).filter(Boolean);
}
function autoCcOrderWrite_(order) {
  const sh = autoCcOrderSheet_();
  sh.clear();
  sh.getRange(1, 1).setValue('productId')
    .setFontWeight('bold').setBackground('#6C6C60').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  const rows = order.map(x => [x]);
  const B = 5000;
  for (let i = 0; i < rows.length; i += B) {
    const blk = rows.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, 1).setValues(blk);
  }
}

const AUTO_CC_COLS = ['productId','itemCode','lane','productName','variantId','variantName',
  'purchasePrice','landingCost','mrp','sellingPrice','margin','marginType',
  'discount','discountType','qty','batchUpdatedDate','shortDescription'];

function autoCcSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(AUTO.CURRENT);
  if (!sh) {
    sh = ss.insertSheet(AUTO.CURRENT);
    sh.getRange(1, 1, 1, AUTO_CC_COLS.length).setValues([AUTO_CC_COLS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function autoCcFetch_(ids) {
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty('VASY_BASE_URL') || '').replace(/\/+$/, '');
  const token = String(props.getProperty('VASY_API_TOKEN') || '');
  const branch = String(props.getProperty('VASY_BRANCH_ID') || '');
  if (!base || !token || !branch) throw new Error('Vasy script properties missing.');

  const url = base + '/api/v1/product/details?productIds=' +
    encodeURIComponent(ids.join(',')) + '&branchId=' + encodeURIComponent(branch);
  const resp = UrlFetchApp.fetch(url, {
    method: 'get', headers: { 'api-token': token }, muteHttpExceptions: true });
  const code = resp.getResponseCode();
  if (code === 429) { Utilities.sleep(60000); throw new Error('rate limited'); }
  if (code !== 200) throw new Error('HTTP ' + code);
  const json = JSON.parse(resp.getContentText());
  if (json.status === false) throw new Error(json.message || 'status false');

  const out = [];
  (json.response || []).forEach(p => {
    const vs = p.productVariantDetails || [];
    const nm = num => { const n = Number(num); return isFinite(n) ? n : ''; };
    const lane = c => String(c || '').trim().slice(-1) === '/' ? 'WO' : 'W';
    if (!vs.length) {
      out.push([p.productId, p.itemCode || '', lane(p.itemCode), p.productName || '',
        '', '', '', '', '', '', '', '', '', '', '', '', '']);
      return;
    }
    vs.forEach(v => out.push([p.productId, v.itemCode || p.itemCode || '',
      lane(v.itemCode || p.itemCode), p.productName || '',
      v.productVariantId || '', v.variantName || '',
      nm(v.purchasePrice), nm(v.landingCost), nm(v.mrp), nm(v.sellingPrice),
      nm(v.margin), v.marginType || '', nm(v.discount), v.discountType || '',
      nm(v.qty), String(v.batchUpdatedDate || ''), '']));
  });
  return out;
}

/* update existing itemCode rows, append new ones */
function autoCcUpsert_(sh, rows) {
  const last = sh.getLastRow();
  const idx = {};
  if (last > 1) {
    const codes = sh.getRange(2, 2, last - 1, 1).getValues();
    for (let i = 0; i < codes.length; i++) {
      const k = String(codes[i][0] || '').trim();
      if (k) idx[k] = i + 2;
    }
  }
  const appends = [];
  rows.forEach(r => {
    const k = String(r[1] || '').trim();
    const at = k ? idx[k] : null;
    if (at) sh.getRange(at, 1, 1, AUTO_CC_COLS.length).setValues([r]);
    else appends.push(r);
  });
  if (appends.length) {
    sh.getRange(sh.getLastRow() + 1, 1, appends.length, AUTO_CC_COLS.length).setValues(appends);
  }
}

/* ---------- 5. rebuild the read model ---------- */

function rebuildDashData() {
  autoRun_('Dash_Data', function () {
    const n = buildDashboardData();   // from DataBuilder.gs — also clears the cache
    return n + ' product(s)';
  });
}

/* ---------- triggers ---------- */

function installAllTriggers() {
  const jobs = [
    ['refreshErpSnapshot', 1],
    ['refreshPurchaseRegister', 2],
    ['rebuildBatchCost', 3],
    ['refreshCostCurrent', 4],
    ['rebuildDashData', 5],
  ];
  const names = {};
  jobs.forEach(j => names[j[0]] = 1);

  ScriptApp.getProjectTriggers().forEach(t => {
    if (names[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  jobs.forEach(j => {
    ScriptApp.newTrigger(j[0]).timeBased().everyDays(1).atHour(j[1]).create();
  });

  const msg = 'Nightly automation installed:\n\n' +
    '01:00  ERP snapshot\n02:00  Purchase register\n03:00  Batch cost rollup\n' +
    '04:00  Cost current (resumable sweep)\n05:00  Rebuild Dash_Data\n\n' +
    'Nothing to click from now on. Check the Automation_Log tab any morning.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function removeAllTriggers() {
  const names = { refreshErpSnapshot: 1, refreshPurchaseRegister: 1, rebuildBatchCost: 1,
    refreshCostCurrent: 1, rebuildDashData: 1 };
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (names[t.getHandlerFunction()]) { ScriptApp.deleteTrigger(t); n++; }
  });
  try { SpreadsheetApp.getUi().alert('Removed ' + n + ' automation trigger(s).'); } catch (e) {}
}

function showAutomationStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const trig = ScriptApp.getProjectTriggers()
    .map(t => t.getHandlerFunction()).sort().join(', ');
  const props = PropertiesService.getScriptProperties();
  const cc = props.getProperty(AUTO.CC_CURSOR) || '0';
  const sh = ss.getSheetByName(AUTO.LOG);
  let recent = '(no log yet)';
  if (sh && sh.getLastRow() > 1) {
    const n = Math.min(8, sh.getLastRow() - 1);
    recent = sh.getRange(sh.getLastRow() - n + 1, 1, n, 4).getValues()
      .map(r => r[0] + '  ' + r[1] + '  ' + r[2] + '  ' + r[3]).join('\n');
  }
  const msg = 'AUTOMATION\n\nTriggers: ' + (trig || 'none installed') +
    '\nCost_Current cursor: ' + cc +
    '\n\nRecent runs:\n' + recent;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* run everything now, for testing (may take a while) */
function runAllNow() {
  refreshErpSnapshot();
  refreshPurchaseRegister();
  rebuildBatchCost();
  refreshCostCurrent();
  rebuildDashData();
  showAutomationStatus();
}

function onOpenAutomation() {
  SpreadsheetApp.getUi()
    .createMenu('🤖 Automation')
    .addItem('Install nightly triggers', 'installAllTriggers')
    .addItem('Status', 'showAutomationStatus')
    .addItem('Remove triggers', 'removeAllTriggers')
    .addSeparator()
    .addItem('Run everything now', 'runAllNow')
    .addToUi();
}