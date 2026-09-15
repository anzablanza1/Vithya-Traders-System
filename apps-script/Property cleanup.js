/**********************************************************************
 * VITHYA TRADERS — SCRIPT PROPERTY CLEANUP
 *
 * WHY THIS IS NEEDED
 *   Script Properties cap at ~500KB in total. Three of my earlier scripts
 *   stored COLLECTIONS there instead of in sheets:
 *
 *     AUTO_CC_ORDER_0..18   13,548 productIds, sliced      ~152KB  (live)
 *     CE_Q_*                cost-enrichment queue           ~56KB  (abandoned)
 *     PBQ_*                 Phase B queue                   ~24KB  (finished)
 *
 *   Together they filled the quota, which is why snapshotStock() failed.
 *
 * THE RULE GOING FORWARD
 *   Properties are for a handful of small values — cursors, tokens, ids.
 *   Anything per-SKU or per-row belongs in a sheet.
 *
 * RUN
 *   auditProperties()      see every property and its size. Safe, read only.
 *   cleanDeadProperties()  delete the abandoned queues (CE_Q_*, PBQ_*)
 *   cleanCostOrderCache()  delete AUTO_CC_ORDER_* — it rebuilds itself on the
 *                          next sweep, so this only costs one extra rebuild
 **********************************************************************/

const PC = {
  DEAD_PREFIXES: ['CE_Q_', 'PBQ_', 'CE_CURSOR', 'CE_RUNNING', 'CE_QUEUE_KEY',
    'PB_QUEUE', 'PB_CURSOR', 'PB_RUNNING', 'PB_CHUNK'],
  ORDER_PREFIX: 'AUTO_CC_ORDER',
  BIG: 2000,
};

function auditProperties() {
  const p = PropertiesService.getScriptProperties();
  const all = p.getProperties();
  const keys = Object.keys(all).sort();
  let total = 0;
  const rows = keys.map(k => {
    const len = String(all[k]).length;
    total += len + k.length;
    return { k: k, len: len };
  });
  rows.sort((a, b) => b.len - a.len);

  const lines = rows.slice(0, 25).map(r =>
    '   ' + (r.len > PC.BIG ? '⚠ ' : '  ') + r.k + '  —  ' +
    (r.len > 1000 ? (r.len / 1024).toFixed(1) + ' KB' : r.len + ' B'));

  /* group by prefix so the culprits are obvious */
  const groups = {};
  rows.forEach(r => {
    const g = r.k.replace(/_\d+$/, '').replace(/_[0-9]{10,}.*$/, '_*');
    groups[g] = (groups[g] || 0) + r.len;
  });
  const gl = Object.keys(groups).sort((a, b) => groups[b] - groups[a])
    .slice(0, 10)
    .map(g => '   ' + g + '  —  ' + (groups[g] / 1024).toFixed(1) + ' KB');

  const msg = 'SCRIPT PROPERTIES\n\n' +
    'count: ' + keys.length + '\n' +
    'total: ' + (total / 1024).toFixed(1) + ' KB of ~500 KB\n\n' +
    '── by group ──\n' + gl.join('\n') +
    '\n\n── largest keys ──\n' + lines.join('\n') +
    '\n\nAnything marked ⚠ is a collection that should live in a sheet.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return total;
}

function cleanDeadProperties() {
  const p = PropertiesService.getScriptProperties();
  const all = p.getProperties();
  const kill = Object.keys(all).filter(k =>
    PC.DEAD_PREFIXES.some(pre => k.indexOf(pre) === 0));
  if (!kill.length) {
    try { SpreadsheetApp.getUi().alert('Nothing dead to remove.'); } catch (e) {}
    return 0;
  }
  let freed = 0;
  kill.forEach(k => { freed += String(all[k]).length; p.deleteProperty(k); });
  const msg = 'Removed ' + kill.length + ' abandoned propert(ies).\n' +
    'Freed ' + (freed / 1024).toFixed(1) + ' KB.\n\n' +
    'These were queues from the cost-enrichment and Phase B scripts,\n' +
    'both of which have finished. Nothing in use was touched.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return kill.length;
}

/**
 * AUTO_CC_ORDER_* holds the product-id sweep order for refreshCostCurrent.
 * It is regenerated automatically whenever the cursor is at 0, so deleting it
 * costs one rebuild and nothing else.
 */
function cleanCostOrderCache() {
  const p = PropertiesService.getScriptProperties();
  const all = p.getProperties();
  const kill = Object.keys(all).filter(k => k.indexOf(PC.ORDER_PREFIX) === 0);
  if (!kill.length) {
    try { SpreadsheetApp.getUi().alert('No cost-order cache to clear.'); } catch (e) {}
    return 0;
  }
  let freed = 0;
  kill.forEach(k => { freed += String(all[k]).length; p.deleteProperty(k); });
  /* reset the cursor so the next sweep rebuilds the order cleanly */
  p.setProperty('AUTO_CC_CURSOR', '0');
  const msg = 'Removed ' + kill.length + ' cost-order slice(s).\n' +
    'Freed ' + (freed / 1024).toFixed(1) + ' KB.\n\n' +
    'The sweep order rebuilds itself on the next nightly run.\n' +
    'The cursor was reset to 0, so the sweep restarts from the most\n' +
    'recently changed products — which is the useful end anyway.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return kill.length;
}

function cleanAllProperties() {
  const a = cleanDeadProperties();
  const b = cleanCostOrderCache();
  auditProperties();
  try { SpreadsheetApp.getUi().alert('Cleanup done: ' + a + ' dead, ' + b +
    ' cache slices.\n\nSee the log for the new totals.'); } catch (e) {}
}

function onOpenPropClean() {
  SpreadsheetApp.getUi()
    .createMenu('🧹 Properties')
    .addItem('Audit (safe)', 'auditProperties')
    .addItem('Remove abandoned queues', 'cleanDeadProperties')
    .addItem('Clear cost-order cache', 'cleanCostOrderCache')
    .addItem('Do both', 'cleanAllProperties')
    .addToUi();
}