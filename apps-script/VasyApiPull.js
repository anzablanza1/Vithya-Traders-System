/**********************************************************************
 * VITHYA TRADERS — Vasy Product Pull   [v3 · coexists with CostEnrichment]
 *
 * Keeps ERP_Snapshot in sync with Vasy so that any change in the ERP
 * shows up here. Uses:
 *      GET /api/v1/product/products-inventory   (up to 1000 per page)
 *
 * Base URL : https://api.vasyerp.com          (confirmed by Vasy support)
 * Header   : api-token                         (confirmed by Vasy support)
 *
 * SAFE TO KEEP ALONGSIDE VasyCostEnrichment_v2.gs — no shared function
 * names. This file owns the onOpen menu for BOTH scripts.
 *
 * REQUIRED Script Properties:
 *      VASY_BASE_URL   = https://api.vasyerp.com
 *      VASY_API_TOKEN  = <your token>
 *      VASY_BRANCH_ID  = 21024
 *
 * TYPICAL USE
 *   fullPull()          — first time, or a full rebuild of ERP_Snapshot
 *   incrementalPull()   — daily; fetches only what changed since last sync
 *   installDailyTrigger() — schedules incrementalPull at 6 AM every day
 **********************************************************************/

const VP = {
  BASE_PROP: 'VASY_BASE_URL',
  TOKEN_PROP: 'VASY_API_TOKEN',
  BRANCH_PROP: 'VASY_BRANCH_ID',

  SNAPSHOT_SHEET: 'ERP_Snapshot',
  META_SHEET: 'Sync_Meta',

  PAGE_SIZE: 1000,
  SLEEP_MS: 13000,     // stay under 5 requests / 60 seconds
  MAX_RETRIES: 3,
  MAX_RUN_MS: 270000,  // 4.5 min, under the 6 min Apps Script cap
};

/* ================= API layer ================= */

function vpProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing Script Property: ' + key +
                          '. Set it in Project Settings -> Script Properties.');
  return String(v).trim();
}
function vpBase_()   { return vpProp_(VP.BASE_PROP).replace(/\/+$/, ''); }
function vpToken_()  { return vpProp_(VP.TOKEN_PROP); }
function vpBranch_() { return vpProp_(VP.BRANCH_PROP); }

function vpGet_(path, queryObj) {
  let url = vpBase_() + path;
  if (queryObj) {
    const qs = Object.keys(queryObj)
      .filter(k => queryObj[k] !== undefined && queryObj[k] !== null && queryObj[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(queryObj[k]))
      .join('&');
    if (qs) url += '?' + qs;
  }
  const opts = {
    method: 'get',
    headers: { 'api-token': vpToken_() },
    muteHttpExceptions: true,
  };
  for (let attempt = 1; attempt <= VP.MAX_RETRIES; attempt++) {
    const resp = UrlFetchApp.fetch(url, opts);
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    if (code === 200) {
      let json;
      try { json = JSON.parse(body); }
      catch (e) { throw new Error('Non-JSON reply from ' + url + ' :: ' + body.slice(0, 200)); }
      if (json.status === false) throw new Error('API status=false: ' + (json.message || ''));
      return json;
    }
    if (code === 429) {
      Logger.log('429 rate limited — waiting 60s (retry ' + attempt + '/' + VP.MAX_RETRIES + ')');
      Utilities.sleep(60000);
      continue;
    }
    if (code === 401 || code === 403) {
      throw new Error(code + ' Unauthorized. Check VASY_API_TOKEN and that ' +
                      'VASY_BASE_URL is https://api.vasyerp.com :: ' + body.slice(0, 200));
    }
    throw new Error('HTTP ' + code + ' at ' + url + ' :: ' + body.slice(0, 250));
  }
  throw new Error('Failed after ' + VP.MAX_RETRIES + ' retries: ' + url);
}

/* ================= checks ================= */

function vpTestConnection() {
  Logger.log('Base URL: ' + vpBase_());
  Logger.log('Branch  : ' + vpBranch_());
  const json = vpGet_('/api/v1/master/tax');
  const n = (json.response || []).length;
  Logger.log('OK — ' + json.message + ' (' + n + ' tax entries)');
  try { SpreadsheetApp.getUi().alert('Connection OK: ' + json.message +
    '\nTax entries: ' + n); } catch (e) {}
}

function discoverBranches() {
  const json = vpGet_('/api/v1/branch');
  const branches = json.response || [];
  Logger.log('=== BRANCHES ===');
  branches.forEach(b => Logger.log('branchId=' + b.branchId + '   ' + b.branchName));
  Logger.log('Configured VASY_BRANCH_ID = ' + vpBranch_());
  try {
    const msg = branches.map(b => b.branchId + '  —  ' + b.branchName).join('\n');
    SpreadsheetApp.getUi().alert('Branches:\n\n' + msg + '\n\nConfigured: ' + vpBranch_());
  } catch (e) {}
  return branches;
}

/* ================= page fetch ================= */

function vpFetchPage_(offset, fromDate, toDate) {
  const q = {
    branchId: vpBranch_(),
    limit: VP.PAGE_SIZE,
    offset: offset,
  };
  if (fromDate) {
    q.fromDate = fromDate;
    // the API rejects fromDate without toDate
    q.toDate = toDate || Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  }
  const json = vpGet_('/api/v1/product/products-inventory', q);
  return json.response || { totalCount: 0, items: [] };
}
/* ================= snapshot columns ================= */

const SNAPSHOT_COLUMNS = [
  'productId', 'itemCode', 'productName',
  'taxName', 'taxRate', 'mrp', 'sellingPrice',
  'discount', 'discountType', 'hsnCode',
  'productType', 'brand', 'category', 'department', 'measurement',
  'qty', 'active', 'activeOnline',
  'updatedDate', 'createdDate', 'batchUpdatedDate', 'lastModifiedBy',
];

function vpRow_(it) {
  return SNAPSHOT_COLUMNS.map(c => (it[c] !== undefined && it[c] !== null) ? it[c] : '');
}

/* ================= FULL PULL ================= */

function fullPull() {
  const started = new Date();
  const t0 = Date.now();
  const first = vpFetchPage_(0);
  const total = Number(first.totalCount || 0);
  Logger.log('Total products in ERP: ' + total);

  let all = (first.items || []).slice();
  let offset = VP.PAGE_SIZE;

  while (offset < total) {
    if (Date.now() - t0 > VP.MAX_RUN_MS) {
      Logger.log('Time budget reached at ' + all.length + '/' + total +
                 '. Writing what we have; re-run fullPull to redo, or use incrementalPull.');
      break;
    }
    Utilities.sleep(VP.SLEEP_MS);
    const page = vpFetchPage_(offset);
    const items = page.items || [];
    if (!items.length) break;
    all = all.concat(items);
    Logger.log('offset ' + offset + '  (' + all.length + '/' + total + ')');
    offset += VP.PAGE_SIZE;
  }

  vpWrite_(all, true);
  vpStamp_(started, all.length, 'FULL');
  const msg = 'Full pull complete: ' + all.length + ' products in ' + VP.SNAPSHOT_SHEET + '.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return all.length;
}

/* ================= INCREMENTAL PULL =================
 * This is the one that makes ERP changes show up here.
 * Uses fromDate = the last successful sync time.
 */

function incrementalPull() {
  const started = new Date();
  const t0 = Date.now();
  const last = vpLastSyncIso_();
  const fromDate = last || '2020-01-01T00:00:00Z';
  Logger.log('Incremental pull since ' + fromDate);

  const first = vpFetchPage_(0, fromDate);
  const total = Number(first.totalCount || 0);
  let changed = (first.items || []).slice();
  let offset = VP.PAGE_SIZE;

  while (offset < total) {
    if (Date.now() - t0 > VP.MAX_RUN_MS) {
      Logger.log('Time budget reached at ' + changed.length + '/' + total + '.');
      break;
    }
    Utilities.sleep(VP.SLEEP_MS);
    const page = vpFetchPage_(offset, fromDate);
    const items = page.items || [];
    if (!items.length) break;
    changed = changed.concat(items);
    offset += VP.PAGE_SIZE;
  }

  if (changed.length) vpUpsert_(changed);
  vpStamp_(started, changed.length, 'INCREMENTAL');

  const msg = 'Incremental pull: ' + changed.length + ' changed product(s) updated.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return changed.length;
}

/* ================= sheet writers ================= */

function vpSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(VP.SNAPSHOT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(VP.SNAPSHOT_SHEET);
    sh.getRange(1, 1, 1, SNAPSHOT_COLUMNS.length).setValues([SNAPSHOT_COLUMNS]);
    sh.setFrozenRows(1);
    return sh;
  }
  if (sh.getRange(1, 1).getValue() !== SNAPSHOT_COLUMNS[0]) {
    sh.clear();
    sh.getRange(1, 1, 1, SNAPSHOT_COLUMNS.length).setValues([SNAPSHOT_COLUMNS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function vpWrite_(items, replaceAll) {
  const sh = vpSheet_();
  if (replaceAll && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, SNAPSHOT_COLUMNS.length).clearContent();
  }
  if (!items.length) return;
  const rows = items.map(vpRow_);
  sh.getRange(2, 1, rows.length, SNAPSHOT_COLUMNS.length).setValues(rows);
}

function vpUpsert_(items) {
  const sh = vpSheet_();
  const last = sh.getLastRow();
  const idx = {};
  if (last > 1) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) idx[String(ids[i][0])] = i + 2;
  }
  const appends = [];
  items.forEach(it => {
    const row = vpRow_(it);
    const at = idx[String(it.productId)];
    if (at) sh.getRange(at, 1, 1, SNAPSHOT_COLUMNS.length).setValues([row]);
    else appends.push(row);
  });
  if (appends.length) {
    sh.getRange(sh.getLastRow() + 1, 1, appends.length, SNAPSHOT_COLUMNS.length)
      .setValues(appends);
  }
  Logger.log('Updated ' + (items.length - appends.length) + ', added ' + appends.length + '.');
}

/* ================= sync metadata ================= */

function vpMeta_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(VP.META_SHEET);
  if (!sh) {
    sh = ss.insertSheet(VP.META_SHEET);
    sh.getRange(1, 1, 1, 4)
      .setValues([['last_sync_started', 'last_sync_iso_utc', 'rows', 'mode']]);
  }
  return sh;
}

function vpStamp_(startedDate, rows, mode) {
  const sh = vpMeta_();
  const iso = Utilities.formatDate(startedDate, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  sh.appendRow([startedDate, iso, rows, mode]);
}

function vpLastSyncIso_() {
  const sh = vpMeta_();
  const last = sh.getLastRow();
  if (last < 2) return null;
  return sh.getRange(last, 2).getValue();
}

/* ================= scheduling ================= */

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'incrementalPull') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('incrementalPull').timeBased().everyDays(1).atHour(6).create();
  Logger.log('Daily 6 AM incrementalPull scheduled.');
  try { SpreadsheetApp.getUi().alert('Daily 6 AM sync scheduled.'); } catch (e) {}
}

function removeDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'incrementalPull') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Daily trigger removed.');
  try { SpreadsheetApp.getUi().alert('Daily sync trigger removed.'); } catch (e) {}
}

function listTriggers() {
  const ts = ScriptApp.getProjectTriggers();
  if (!ts.length) { Logger.log('No triggers.'); }
  ts.forEach(t => Logger.log(t.getHandlerFunction() + '  |  ' + t.getEventType()));
  try {
    SpreadsheetApp.getUi().alert('Triggers:\n\n' +
      (ts.length ? ts.map(t => t.getHandlerFunction()).join('\n') : 'none'));
  } catch (e) {}
}

/* ================= unified menu (covers both scripts) ================= */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔌 Vasy')
    .addItem('Test connection', 'vpTestConnection')
    .addItem('Show my branches', 'discoverBranches')
    .addSeparator()
    .addItem('Full pull (rebuild snapshot)', 'fullPull')
    .addItem('Incremental pull (changed only)', 'incrementalPull')
    .addSeparator()
    .addItem('Schedule daily 6 AM sync', 'installDailyTrigger')
    .addItem('Remove daily sync', 'removeDailyTrigger')
    .addItem('List triggers', 'listTriggers')
    .addSeparator()
    .addItem('💰 Cost: test chunk size', 'testChunkSize')
    .addItem('💰 Cost: start enrichment', 'startCostEnrichment')
    .addItem('💰 Cost: status', 'enrichmentStatus')
    .addItem('💰 Cost: cancel', 'cancelCostEnrichment')
    .addItem('💰 Cost: build review', 'buildCostReview')
    .addToUi();
}