/**********************************************************************
 * VITHYA TRADERS — PHASE B : Current batch cost / selling / MRP
 *
 * Pulls the LIVE batch pricing per product from
 *      GET /api/v1/product/details   (comma-separated productIds)
 * and folds it into the Pricing tab columns:
 *      I  cost_current_w
 *      J  cost_current_wo
 * plus a raw Cost_Current tab holding selling/mrp/margin per lane so you
 * can compare product-level vs batch-level (the "edited after billing" check).
 *
 * WHY only some products
 *   /product/details returns "pricing from latest batch, else the variant
 *   price". For products with NO purchase history that fallback == master,
 *   so there is nothing new to learn. This targets the ~3,137 products that
 *   DO have purchase history (from Batch_Cost). Each has a W and a WO
 *   productId, so ~6,000 ids at 10/call.
 *
 * SPEED  10 ids/call, 13s apart -> ~2-2.5 hours of API time, run UNATTENDED.
 *        It auto-continues every minute until done (Workspace: 6h/day budget).
 *
 * RUN
 *   0. countPhaseBTargets()   see how many ids and the time estimate
 *   1. startPhaseB()          begins; auto-continues; close the tab if you like
 *      phaseBStatus()         progress any time
 *      cancelPhaseB()         stop + remove triggers
 *   2. foldCostCurrent()      writes results into Pricing I / J  (run when done)
 **********************************************************************/

const PB = {
  BASE_PROP: 'VASY_BASE_URL',
  TOKEN_PROP: 'VASY_API_TOKEN',
  BRANCH_PROP: 'VASY_BRANCH_ID',

  SNAP: 'ERP_Snapshot',
  BATCH: 'Batch_Cost',
  PRICING: 'Pricing',
  OUT: 'Cost_Current',

  CHUNK_PROP: 'PB_CHUNK',
  CHUNK_DEFAULT: 10,          // proven ceiling (12 fails)
  SLEEP_MS: 13000,            // 5 req / 60s
  COOLOFF_429: 30000,
  BACKOFF: [60000, 120000, 180000],
  MAX_RUN_MS: 270000,         // 4.5 min per execution (safe for gmail too)

  QUEUE_PROP: 'PB_QUEUE',
  CURSOR_PROP: 'PB_CURSOR',
  RUNNING_PROP: 'PB_RUNNING',
  TRIGGER_FN: 'runPhaseB',
};

/* ================= API ================= */

function pbProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

/* returns response object, or {__rateLimited:true} */
function pbGet_(path, q) {
  let url = pbProp_(PB.BASE_PROP).replace(/\/+$/, '') + path;
  const qs = Object.keys(q).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
  if (qs) url += '?' + qs;
  const opts = { method: 'get', headers: { 'api-token': pbProp_(PB.TOKEN_PROP) }, muteHttpExceptions: true };

  let hit429 = false;
  for (let attempt = 0; attempt <= PB.BACKOFF.length; attempt++) {
    const resp = UrlFetchApp.fetch(url, opts);
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    if (code === 200) {
      const json = JSON.parse(body);
      if (json.status === false) throw new Error('status=false :: ' + (json.message || ''));
      if (hit429) Utilities.sleep(PB.COOLOFF_429);
      return json.response || [];
    }
    if (code === 429) {
      hit429 = true;
      if (attempt === PB.BACKOFF.length) return { __rateLimited: true };
      Logger.log('   429 backoff ' + (PB.BACKOFF[attempt] / 1000) + 's');
      Utilities.sleep(PB.BACKOFF[attempt]);
      continue;
    }
    if (code === 401 || code === 403) throw new Error(code + ' Unauthorized. Check token.');
    throw new Error('HTTP ' + code + ' :: ' + body.slice(0, 200));
  }
  return { __rateLimited: true };
}

function pbFetch_(idArray) {
  return pbGet_('/api/v1/product/details', {
    productIds: idArray.join(','),
    branchId: pbProp_(PB.BRANCH_PROP),
  });
}

/* ================= helpers ================= */

function pbNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function pbCanon_(c) { return String(c || '').trim().replace(/\/+$/, ''); }
function pbLane_(c) { return String(c || '').trim().slice(-1) === '/' ? 'WO' : 'W'; }
function pbHtml_(s) {
  return s ? String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 500) : '';
}

/* ================= choose target productIds ================= */

function pbTargetIds_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // canonical codes that have purchase history
  const bsh = ss.getSheetByName(PB.BATCH);
  const wanted = {};
  if (bsh && bsh.getLastRow() > 1) {
    const bv = bsh.getDataRange().getValues();
    const bh = {}; bv[0].forEach((h, i) => bh[String(h).trim()] = i);
    const cc = bh['canonical_code'];
    for (let i = 1; i < bv.length; i++) {
      const c = String(bv[i][cc] || '').trim();
      if (c) wanted[c] = true;
    }
  }
  // fallback: if no Batch_Cost, target everything with stock
  const snap = ss.getSheetByName(PB.SNAP);
  if (!snap || snap.getLastRow() < 2) throw new Error('Need ERP_Snapshot.');
  const sv = snap.getDataRange().getValues();
  const sh = {}; sv[0].forEach((h, i) => sh[String(h).trim()] = i);
  const noHistory = Object.keys(wanted).length === 0;

  const ids = [];
  for (let i = 1; i < sv.length; i++) {
    const code = String(sv[i][sh.itemCode] || '').trim();
    const pid = sv[i][sh.productId];
    if (!code || pid === '' || pid === null) continue;
    const canon = pbCanon_(code);
    const qty = Number(sv[i][sh.qty]) || 0;
    if (wanted[canon] || (noHistory && qty !== 0)) ids.push(String(pid).trim());
  }
  // de-dupe
  const seen = {}, out = [];
  ids.forEach(x => { if (!seen[x]) { seen[x] = true; out.push(x); } });
  return out;
}

function countPhaseBTargets() {
  const ids = pbTargetIds_();
  const chunk = parseInt(pbProp_orDefault_(PB.CHUNK_PROP, PB.CHUNK_DEFAULT), 10);
  const calls = Math.ceil(ids.length / chunk);
  const mins = Math.round(calls * PB.SLEEP_MS / 1000 / 60);
  const msg = 'Phase B targets\n\nproductIds to pull: ' + ids.length +
              '\nchunk size: ' + chunk +
              '\ncalls: ' + calls +
              '\nestimated time: ~' + mins + ' min (unattended, auto-continues)';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return ids.length;
}

function pbProp_orDefault_(k, d) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  const n = parseInt(v || '', 10);
  return (isFinite(n) && n > 0) ? n : d;
}

/* ================= output sheet ================= */

const PBC = ['productId','itemCode','lane','productName','variantId','variantName',
  'purchasePrice','landingCost','mrp','sellingPrice','margin','marginType',
  'discount','discountType','qty','batchUpdatedDate','shortDescription'];

function pbSheet_(reset) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PB.OUT);
  if (!sh) {
    sh = ss.insertSheet(PB.OUT);
    sh.getRange(1, 1, 1, PBC.length).setValues([PBC]); sh.setFrozenRows(1);
  } else if (reset) {
    sh.clear();
    sh.getRange(1, 1, 1, PBC.length).setValues([PBC]); sh.setFrozenRows(1);
  }
  return sh;
}

function pbFlatten_(products) {
  const rows = [];
  (products || []).forEach(p => {
    const vs = p.productVariantDetails || [];
    if (!vs.length) {
      rows.push([p.productId, p.itemCode || '', pbLane_(p.itemCode), p.productName || '',
        '', '', '', '', '', '', '', '', '', '', '', '', pbHtml_(p.shortDescription)]);
      return;
    }
    vs.forEach(v => {
      rows.push([p.productId, v.itemCode || p.itemCode || '', pbLane_(v.itemCode || p.itemCode),
        p.productName || '', v.productVariantId || '', v.variantName || '',
        pbNum_(v.purchasePrice), pbNum_(v.landingCost), pbNum_(v.mrp), pbNum_(v.sellingPrice),
        pbNum_(v.margin), v.marginType || '', pbNum_(v.discount), v.discountType || '',
        pbNum_(v.qty), v.batchUpdatedDate || '', pbHtml_(p.shortDescription)]);
    });
  });
  return rows;
}

/* ================= start / run / stop ================= */

function startPhaseB() {
  const props = PropertiesService.getScriptProperties();
  pbClearTriggers_();
  const ids = pbTargetIds_();
  if (!ids.length) throw new Error('No target productIds found.');
  pbSheet_(true);

  // clear old queue parts
  const old = props.getProperty(PB.QUEUE_PROP);
  if (old) { try { JSON.parse(old).parts.forEach(pk => props.deleteProperty(pk)); } catch (e) {} }

  const key = 'PBQ_' + Date.now(), parts = [], PER = 2000;
  for (let i = 0; i < ids.length; i += PER) {
    const pk = key + '_' + parts.length;
    props.setProperty(pk, JSON.stringify(ids.slice(i, i + PER)));
    parts.push(pk);
  }
  props.setProperty(PB.QUEUE_PROP, JSON.stringify({ parts: parts, total: ids.length }));
  props.setProperty(PB.CURSOR_PROP, '0');
  props.setProperty(PB.RUNNING_PROP, 'yes');
  Logger.log('Queued ' + ids.length + ' productIds.');
  runPhaseB();
}

function pbLoadQueue_() {
  const props = PropertiesService.getScriptProperties();
  const meta = JSON.parse(props.getProperty(PB.QUEUE_PROP) || '{}');
  let ids = [];
  (meta.parts || []).forEach(pk => { const s = props.getProperty(pk); if (s) ids = ids.concat(JSON.parse(s)); });
  return ids;
}

function runPhaseB() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(PB.RUNNING_PROP) !== 'yes') { pbClearTriggers_(); return; }
  const t0 = Date.now();
  const ids = pbLoadQueue_();
  let cursor = parseInt(props.getProperty(PB.CURSOR_PROP) || '0', 10);
  let chunk = pbProp_orDefault_(PB.CHUNK_PROP, PB.CHUNK_DEFAULT);
  const sh = pbSheet_(false);
  let wrote = 0;

  while (cursor < ids.length) {
    if (Date.now() - t0 > PB.MAX_RUN_MS) { Logger.log('Pause at ' + cursor + '/' + ids.length); break; }
    const slice = ids.slice(cursor, cursor + chunk);
    const res = pbFetch_(slice);
    if (res && res.__rateLimited) { Logger.log('Rate limited; pausing at ' + cursor); break; }
    const rows = pbFlatten_(res);
    if (rows.length) { sh.getRange(sh.getLastRow() + 1, 1, rows.length, PBC.length).setValues(rows); wrote += rows.length; }
    cursor += slice.length;
    props.setProperty(PB.CURSOR_PROP, String(cursor));
    if (cursor < ids.length) Utilities.sleep(PB.SLEEP_MS);
  }

  pbClearTriggers_();
  if (cursor < ids.length) {
    ScriptApp.newTrigger(PB.TRIGGER_FN).timeBased().after(60000).create();
    Logger.log('Wrote ' + wrote + ' this run. Continue scheduled. ' + cursor + '/' + ids.length);
  } else {
    props.setProperty(PB.RUNNING_PROP, 'no');
    Logger.log('PHASE B COMPLETE — ' + cursor + ' ids. Now run foldCostCurrent().');
    try { SpreadsheetApp.getUi().alert('Phase B complete: ' + cursor +
      ' productIds pulled.\n\nNow run foldCostCurrent().'); } catch (e) {}
  }
}

function cancelPhaseB() {
  PropertiesService.getScriptProperties().setProperty(PB.RUNNING_PROP, 'no');
  pbClearTriggers_();
  Logger.log('Cancelled.');
  try { SpreadsheetApp.getUi().alert('Phase B cancelled; triggers removed.'); } catch (e) {}
}

function pbClearTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === PB.TRIGGER_FN) ScriptApp.deleteTrigger(t);
  });
}

function phaseBStatus() {
  const props = PropertiesService.getScriptProperties();
  const cursor = parseInt(props.getProperty(PB.CURSOR_PROP) || '0', 10);
  let total = 0;
  try { total = JSON.parse(props.getProperty(PB.QUEUE_PROP) || '{}').total || 0; } catch (e) {}
  const running = props.getProperty(PB.RUNNING_PROP) === 'yes';
  const pct = total ? (cursor / total * 100).toFixed(1) : '0';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = ss.getSheetByName(PB.OUT);
  const rows = out ? Math.max(0, out.getLastRow() - 1) : 0;
  const msg = 'Phase B\n\nprocessed ids: ' + cursor + ' / ' + total + '  (' + pct + '%)' +
              '\nrows written: ' + rows + '\nstatus: ' + (running ? 'RUNNING' : 'stopped');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= FOLD into Pricing I / J ================= */

/* find header row of Pricing (row 1, or row 3 after makePricingReadable) */
function pbPricingHeader_(sh) {
  for (let r = 1; r <= 5; r++) {
    if (String(sh.getRange(r, 1).getValue()).trim() === 'product_id') return r;
  }
  throw new Error('Could not find Pricing header row.');
}

function foldCostCurrent() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(PB.OUT);
  if (!src || src.getLastRow() < 2) throw new Error('No data in ' + PB.OUT + '. Run Phase B first.');

  // build canonical -> {w, wo} current purchase price
  const cv = src.getDataRange().getValues();
  const ch = {}; cv[0].forEach((h, i) => ch[String(h).trim()] = i);
  const cur = {};
  for (let i = 1; i < cv.length; i++) {
    const code = String(cv[i][ch.itemCode] || '').trim();
    if (!code) continue;
    const canon = pbCanon_(code);
    const lane = pbLane_(code);
    if (!cur[canon]) cur[canon] = { w: '', wo: '', wsell: '', wosell: '', wmrp: '', womrp: '', wdate: '', wodate: '' };
    const pp = cv[i][ch.purchasePrice];
    if (lane === 'W') { cur[canon].w = pp; cur[canon].wsell = cv[i][ch.sellingPrice]; cur[canon].wmrp = cv[i][ch.mrp]; cur[canon].wdate = cv[i][ch.batchUpdatedDate]; }
    else { cur[canon].wo = pp; cur[canon].wosell = cv[i][ch.sellingPrice]; cur[canon].womrp = cv[i][ch.mrp]; cur[canon].wodate = cv[i][ch.batchUpdatedDate]; }
  }

  const pg = ss.getSheetByName(PB.PRICING);
  if (!pg) throw new Error('Pricing tab not found.');
  const hRow = pbPricingHeader_(pg);
  const first = hRow + 1;
  const n = pg.getLastRow() - hRow;
  if (n <= 0) throw new Error('No data rows in Pricing.');

  const codes = pg.getRange(first, 2, n, 1).getValues();   // col B item_code
  const IJ = [];
  let filled = 0;
  codes.forEach(row => {
    const c = String(row[0] || '').trim();
    const rec = cur[c];
    if (rec && (rec.w !== '' || rec.wo !== '')) {
      IJ.push([rec.w === undefined ? '' : rec.w, rec.wo === undefined ? '' : rec.wo]);
      filled++;
    } else {
      IJ.push(['', '']);
    }
  });
  pg.getRange(first, 9, n, 2).setValues(IJ);   // I=9 cost_current_w, J=10 cost_current_wo

  const msg = 'Folded current batch cost into Pricing.\n\n' +
    'Rows filled (cost_current): ' + filled + '\n\n' +
    'To USE it: set cost_source = batch_current on the rows you trust.\n' +
    'The raw ' + PB.OUT + ' tab keeps selling/mrp/date per lane so you can\n' +
    'spot batches edited after billing.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= divergence: register vs current ================= */

function buildBatchDivergence() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cur = ss.getSheetByName(PB.OUT);
  const pg = ss.getSheetByName(PB.PRICING);
  if (!cur || cur.getLastRow() < 2) throw new Error('Run Phase B + foldCostCurrent first.');
  const hRow = pbPricingHeader_(pg);
  const first = hRow + 1;
  const n = pg.getLastRow() - hRow;

  // pricing: B code, F cost_bill_w(6), G cost_bill_wo(7), I cost_current_w(9), J cost_current_wo(10)
  const pv = pg.getRange(first, 1, n, 10).getValues();
  const out = [['canonical_code', 'bill_w', 'current_w', 'w_gap_pct',
    'bill_wo', 'current_wo', 'wo_gap_pct', 'flag']];
  let edited = 0;
  pv.forEach(r => {
    const code = String(r[1] || '').trim();
    if (!code) return;
    const bw = Number(r[5]), cw = Number(r[8]);
    const bwo = Number(r[6]), cwo = Number(r[9]);
    const gw = (isFinite(bw) && bw > 0 && isFinite(cw)) ? (cw - bw) / bw * 100 : '';
    const gwo = (isFinite(bwo) && bwo > 0 && isFinite(cwo)) ? (cwo - bwo) / bwo * 100 : '';
    const big = (gw !== '' && Math.abs(gw) > 1) || (gwo !== '' && Math.abs(gwo) > 1);
    if (big) {
      edited++;
      out.push([code, isFinite(bw) ? bw : '', isFinite(cw) ? cw : '',
        gw === '' ? '' : Math.round(gw * 100) / 100,
        isFinite(bwo) ? bwo : '', isFinite(cwo) ? cwo : '',
        gwo === '' ? '' : Math.round(gwo * 100) / 100,
        'BATCH EDITED AFTER BILLING?']);
    }
  });
  let sh = ss.getSheetByName('Batch_Divergence');
  if (!sh) sh = ss.insertSheet('Batch_Divergence');
  sh.clear();
  sh.getRange(1, 1, out.length, 8).setValues(out);
  sh.setFrozenRows(1);
  const msg = 'Batch_Divergence built — ' + edited + ' product(s) where the current batch\n' +
    'cost differs from the bill cost by >1%.\n\nThese are batches likely edited after billing.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}