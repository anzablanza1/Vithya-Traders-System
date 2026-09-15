/**********************************************************************
 * VITHYA TRADERS — Purchase Register SIZING PROBE
 *
 * Read-only. Makes ~7 API calls. Changes nothing.
 * Answers: how many purchase lines exist, how they spread over time,
 * and what the fields actually look like for YOUR data.
 *
 * Paste as a NEW script file, save, run  probePurchaseRegister()
 * then send me the Execution log.
 *
 * Uses POST /api/v1/report/purchase-item-register
 * Self-contained: does not depend on any other file.
 **********************************************************************/

const PR_PROBE = {
  BASE_PROP: 'VASY_BASE_URL',
  TOKEN_PROP: 'VASY_API_TOKEN',
  BRANCH_PROP: 'VASY_BRANCH_ID',
  SLEEP_MS: 13000,          // 5 requests / 60 seconds
};

function prProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

/* POST helper — the register is POST, unlike the product endpoints */
function prPost_(path, bodyObj) {
  const url = prProp_(PR_PROBE.BASE_PROP).replace(/\/+$/, '') + path;
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'api-token': prProp_(PR_PROBE.TOKEN_PROP) },
    payload: JSON.stringify(bodyObj),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  const body = resp.getContentText();
  if (code !== 200) {
    throw new Error('HTTP ' + code + ' :: ' + body.slice(0, 300));
  }
  const json = JSON.parse(body);
  if (json.status === false) throw new Error('status=false :: ' + (json.message || ''));
  return json.response || {};
}

function prCount_(fromIso, toIso) {
  const r = prPost_('/api/v1/report/purchase-item-register', {
    dateFrom: fromIso,
    dateTo: toIso,
    branchList: '',
    categoryIds: '', brandIds: '', subBrandIds: '', subCategoryIds: '',
    productIds: '', productType: '', departmentIds: '', contactId: '',
    createdByIds: '', shippingFromDate: '', shippingToDate: '',
    dueFromDate: '', dueToDate: '',
    limit: 1,
    offset: 0,
  });
  return { total: Number(r.totalCount || 0), items: r.items || [] };
}

function probePurchaseRegister() {
  Logger.log('=== PURCHASE REGISTER SIZING ===');

  // 1. total, all time
  const all = prCount_('2015-01-01T00:00:00Z', '2026-12-31T23:59:59Z');
  Logger.log('TOTAL purchase lines (all time): ' + all.total);
  Utilities.sleep(PR_PROBE.SLEEP_MS);

  // 2. year by year, to see where the data actually lives
  const years = [2021, 2022, 2023, 2024, 2025, 2026];
  const counts = {};
  for (let i = 0; i < years.length; i++) {
    const y = years[i];
    try {
      const c = prCount_(y + '-01-01T00:00:00Z', y + '-12-31T23:59:59Z');
      counts[y] = c.total;
      Logger.log('  ' + y + ' : ' + c.total + ' lines');
    } catch (e) {
      Logger.log('  ' + y + ' : FAILED ' + e.message);
    }
    if (i < years.length - 1) Utilities.sleep(PR_PROBE.SLEEP_MS);
  }

  // 3. sample row — confirms field names for YOUR data
  Logger.log('');
  Logger.log('=== SAMPLE ROW (most recent) ===');
  if (all.items && all.items.length) {
    const s = all.items[0];
    Object.keys(s).forEach(k => Logger.log('   ' + k + ' = ' + s[k]));
  } else {
    Logger.log('   (no items returned in the count call)');
  }

  // 4. planning maths
  Logger.log('');
  Logger.log('=== PLAN ===');
  const calls500 = Math.ceil(all.total / 500);
  const mins = Math.round(calls500 * 13 / 60);
  Logger.log('At 500 rows/call: ' + calls500 + ' calls  ≈ ' + mins + ' minutes of API time');
  Logger.log('Workspace allows 30 min per execution, 6 h/day of triggers.');

  try {
    SpreadsheetApp.getUi().alert(
      'Purchase register\n\nTotal lines: ' + all.total +
      '\nCalls at 500/page: ' + calls500 +
      '\nEstimated time: ~' + mins + ' min\n\nSee the Execution log for the year breakdown and sample row.');
  } catch (e) {}

  return all.total;
}