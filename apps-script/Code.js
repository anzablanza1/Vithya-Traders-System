/**********************************************************************
 * VITHYA TRADERS — Cost Enrichment  [SELF-CONTAINED v2]
 *
 * Pulls purchasePrice + landingCost per lane from
 *   GET /api/v1/product/details   (comma-separated productIds)
 *
 * This version has its OWN API helper (ceGet_ / ceBase_ / ceToken_ /
 * ceBranch_) so it does NOT depend on VasyApiPull.gs. It uses distinct
 * names, so it is safe to keep both files in the same project.
 *
 * REQUIRES these Script Properties (Project Settings -> Script Properties):
 *      VASY_BASE_URL   = https://api.vasyerp.com
 *      VASY_API_TOKEN  = <your token>
 *      VASY_BRANCH_ID  = 21024
 *      VASY_DETAILS_CHUNK = (set after running testChunkSize)
 *
 * REQUIRES the ERP_Snapshot tab to be populated (from fullPull).
 *
 * ORDER OF OPERATIONS
 *   0. cancelCostEnrichment()   <- if a previous run left triggers behind
 *   1. testChunkSize()          <- find max productIds per call
 *   2. startCostEnrichment()    <- auto-continues until done
 *      enrichmentStatus()       <- check progress any time
 *   3. buildCostReview()        <- W vs WO vs master, with variance flags
 **********************************************************************/

const CE = {
  SNAPSHOT_SHEET: 'ERP_Snapshot',
  OUT_SHEET: 'Cost_Enrich',
  REVIEW_SHEET: 'Cost_Review',
  PRICING_SHEET: 'Pricing',

  BASE_PROP: 'VASY_BASE_URL',
  TOKEN_PROP: 'VASY_API_TOKEN',
  BRANCH_PROP: 'VASY_BRANCH_ID',

  CHUNK_PROP: 'VASY_DETAILS_CHUNK',
  CHUNK_DEFAULT: 10,

  CURSOR_PROP: 'CE_CURSOR',
  QUEUE_PROP: 'CE_QUEUE_KEY',
  RUNNING_PROP: 'CE_RUNNING',

  MAX_RUN_MS: 270000,   // 4.5 min, under the 6 min Apps Script cap
  SLEEP_MS: 13000,      // under 5 requests / 60 seconds
  MAX_RETRIES: 3,
  TRIGGER_FN: 'runCostEnrichment',
};

/* ============ self-contained API layer ============ */

function ceProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing Script Property: ' + key +
                          '. Set it in Project Settings -> Script Properties.');
  return String(v).trim();
}
function ceBase_()   { return ceProp_(CE.BASE_PROP).replace(/\/+$/, ''); }
function ceToken_()  { return ceProp_(CE.TOKEN_PROP); }
function ceBranch_() { return ceProp_(CE.BRANCH_PROP); }

function ceGet_(path, queryObj) {
  let url = ceBase_() + path;
  if (queryObj) {
    const qs = Object.keys(queryObj)
      .filter(k => queryObj[k] !== undefined && queryObj[k] !== null && queryObj[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(queryObj[k]))
      .join('&');
    if (qs) url += '?' + qs;
  }
  const opts = {
    method: 'get',
    headers: { 'api-token': ceToken_() },
    muteHttpExceptions: true,
  };
  for (let attempt = 1; attempt <= CE.MAX_RETRIES; attempt++) {
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
      Logger.log('429 rate limited — waiting 60s (retry ' + attempt + '/' + CE.MAX_RETRIES + ')');
      Utilities.sleep(60000);
      continue;
    }
    if (code === 401 || code === 403) {
      throw new Error(code + ' Unauthorized. Check VASY_API_TOKEN and that ' +
                      'VASY_BASE_URL is https://api.vasyerp.com :: ' + body.slice(0, 200));
    }
    throw new Error('HTTP ' + code + ' at ' + url + ' :: ' + body.slice(0, 250));
  }
  throw new Error('Failed after ' + CE.MAX_RETRIES + ' retries: ' + url);
}

/* ============ connectivity check ============ */

function ceTestConnection() {
  Logger.log('Base URL: ' + ceBase_());
  Logger.log('Branch  : ' + ceBranch_());
  const json = ceGet_('/api/v1/master/tax');
  Logger.log('OK — ' + json.message + ' (' + (json.response || []).length + ' tax entries)');
  try { SpreadsheetApp.getUi().alert('Connection OK: ' + json.message); } catch (e) {}
}

/* ============ core call ============ */

function fetchDetails_(idArray) {
  const json = ceGet_('/api/v1/product/details', {
    productIds: idArray.join(','),
    branchId: ceBranch_(),
  });
  return json.response || [];
}

function laneOf_(code) { return String(code || '').trim().slice(-1) === '/' ? 'WO' : 'W'; }
function numOrBlank_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function stripHtml_(s) {
  if (!s) return '';
  return String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
                  .replace(/\s+/g, ' ').trim().slice(0, 900);
}

function flattenDetails_(products) {
  const rows = [];
  (products || []).forEach(p => {
    const variants = p.productVariantDetails || [];
    if (!variants.length) {
      rows.push([p.productId, p.itemCode || '', laneOf_(p.itemCode), p.productName || '',
                 '', '', '', '', '', '', '', '', '', '', '',
                 p.shortDescription || '', stripHtml_(p.description), '']);
      return;
    }
    variants.forEach(v => {
      rows.push([
        p.productId,
        v.itemCode || p.itemCode || '',
        laneOf_(v.itemCode || p.itemCode),
        p.productName || '',
        v.productVariantId || '',
        v.variantName || '',
        numOrBlank_(v.purchasePrice),
        numOrBlank_(v.landingCost),
        numOrBlank_(v.mrp),
        numOrBlank_(v.sellingPrice),
        numOrBlank_(v.margin),
        v.marginType || '',
        numOrBlank_(v.discount),
        v.discountType || '',
        numOrBlank_(v.qty),
        p.shortDescription || '',
        stripHtml_(p.description),
        v.batchUpdatedDate || '',
      ]);
    });
  });
  return rows;
}

/* ============ chunk probe ============ */

function testChunkSize() {
  const ids = collectProductIds_().slice(0, 500);
  if (!ids.length) throw new Error('No productIds in ' + CE.SNAPSHOT_SHEET);
  const sizes = [25, 50, 100, 200, 500];
  let best = 0;
  Logger.log('Probing /product/details chunk limit...');
  for (let i = 0; i < sizes.length; i++) {
    const n = sizes[i];
    if (ids.length < n) { Logger.log('  skip ' + n + ' (only ' + ids.length + ' ids)'); continue; }
    try {
      const got = fetchDetails_(ids.slice(0, n));
      const returned = got.length;
      Logger.log((returned >= n ? 'OK  ' : 'PART') + '  requested ' + n +
                 ' -> returned ' + returned + (returned < n ? '  ** TRUNCATED **' : ''));
      if (returned >= n) best = n;
    } catch (e) {
      Logger.log('FAIL  requested ' + n + ' -> ' + e.message);
      break;
    }
    Utilities.sleep(CE.SLEEP_MS);
  }
  Logger.log('---');
  Logger.log('Largest clean chunk: ' + (best || 25));
  Logger.log('Set Script Property ' + CE.CHUNK_PROP + ' = ' + (best || 25));
  try {
    SpreadsheetApp.getUi().alert('Largest clean chunk size: ' + (best || 25) +
      '\n\nSet Script Property ' + CE.CHUNK_PROP + ' to this, then run startCostEnrichment().');
  } catch (e) {}
  return best;
}

/* ============ queue ============ */

function collectProductIds_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CE.SNAPSHOT_SHEET);
  if (!sh) throw new Error('Sheet not found: ' + CE.SNAPSHOT_SHEET + '. Run fullPull first.');
  const last = sh.getLastRow();
  if (last < 2) throw new Error(CE.SNAPSHOT_SHEET + ' is empty. Run fullPull first.');
  const vals = sh.getRange(2, 1, last - 1, 1).getValues();
  const ids = [], seen = {};
  vals.forEach(r => {
    const v = r[0];
    if (v === '' || v === null || v === undefined) return;
    const k = String(v).trim();
    if (!k || seen[k]) return;
    seen[k] = true;
    ids.push(k);
  });
  return ids;
}

function loadQueue_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(CE.QUEUE_PROP);
  if (!raw) throw new Error('No queue. Run startCostEnrichment() first.');
  const meta = JSON.parse(raw);
  let ids = [];
  meta.parts.forEach(pk => {
    const s = props.getProperty(pk);
    if (s) ids = ids.concat(JSON.parse(s));
  });
  return ids;
}

/* ============ start / run / stop ============ */

function startCostEnrichment() {
  const props = PropertiesService.getScriptProperties();
  clearContinueTriggers_();

  const ids = collectProductIds_();
  if (!ids.length) throw new Error('No productIds to process.');

  getEnrichSheet_(true);   // reset output

  // clear any previous queue parts
  const oldRaw = props.getProperty(CE.QUEUE_PROP);
  if (oldRaw) {
    try { JSON.parse(oldRaw).parts.forEach(pk => props.deleteProperty(pk)); } catch (e) {}
  }

  const key = 'CE_Q_' + Date.now();
  const parts = [];
  const PER = 2000;
  for (let i = 0; i < ids.length; i += PER) {
    const pk = key + '_' + parts.length;
    props.setProperty(pk, JSON.stringify(ids.slice(i, i + PER)));
    parts.push(pk);
  }
  props.setProperty(CE.QUEUE_PROP, JSON.stringify({ key: key, parts: parts, total: ids.length }));
  props.setProperty(CE.CURSOR_PROP, '0');
  props.setProperty(CE.RUNNING_PROP, 'yes');

  Logger.log('Queued ' + ids.length + ' productIds in ' + parts.length + ' part(s).');
  runCostEnrichment();
}

function runCostEnrichment() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(CE.RUNNING_PROP) !== 'yes') {
    Logger.log('Not running (cancelled or finished).');
    clearContinueTriggers_();
    return;
  }

  const started = Date.now();
  const ids = loadQueue_();
  let cursor = parseInt(props.getProperty(CE.CURSOR_PROP) || '0', 10);
  let chunk = parseInt(props.getProperty(CE.CHUNK_PROP) || CE.CHUNK_DEFAULT, 10) || CE.CHUNK_DEFAULT;

  const sh = getEnrichSheet_(false);
  let wrote = 0, calls = 0, failed = false;

  while (cursor < ids.length) {
    if (Date.now() - started > CE.MAX_RUN_MS) {
      Logger.log('Time budget reached. Pausing at ' + cursor + '/' + ids.length);
      break;
    }
    const slice = ids.slice(cursor, cursor + chunk);
    let rows;
    try {
      rows = flattenDetails_(fetchDetails_(slice));
    } catch (e) {
      Logger.log('Chunk failed at cursor ' + cursor + ': ' + e.message);
      if (chunk > 25) {
        chunk = Math.max(25, Math.floor(chunk / 2));
        props.setProperty(CE.CHUNK_PROP, String(chunk));
        Logger.log('Reduced chunk size to ' + chunk + '; will retry this slice.');
      } else {
        failed = true;
      }
      break;
    }
    if (rows.length) {
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, ENRICH_COLS.length).setValues(rows);
      wrote += rows.length;
    }
    cursor += slice.length;
    calls++;
    props.setProperty(CE.CURSOR_PROP, String(cursor));
    if (cursor < ids.length) Utilities.sleep(CE.SLEEP_MS);
  }

  Logger.log('Run: ' + calls + ' call(s), ' + wrote + ' row(s). Cursor ' + cursor + '/' + ids.length);

  clearContinueTriggers_();
  if (failed) {
    props.setProperty(CE.RUNNING_PROP, 'no');
    Logger.log('STOPPED — repeated failure at minimum chunk size. Fix the error, then restart.');
    return;
  }
  if (cursor < ids.length) {
    ScriptApp.newTrigger(CE.TRIGGER_FN).timeBased().after(60 * 1000).create();
    Logger.log('Continuation scheduled in ~1 minute.');
  } else {
    props.setProperty(CE.RUNNING_PROP, 'no');
    Logger.log('COST ENRICHMENT COMPLETE — ' + cursor + ' productIds.');
    try { SpreadsheetApp.getUi().alert('Cost enrichment complete: ' + cursor +
      ' productIds.\n\nNow run buildCostReview().'); } catch (e) {}
  }
}

function cancelCostEnrichment() {
  PropertiesService.getScriptProperties().setProperty(CE.RUNNING_PROP, 'no');
  clearContinueTriggers_();
  Logger.log('Cancelled and triggers removed.');
  try { SpreadsheetApp.getUi().alert('Cost enrichment cancelled; triggers removed.'); } catch (e) {}
}

function clearContinueTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === CE.TRIGGER_FN) ScriptApp.deleteTrigger(t);
  });
}

function enrichmentStatus() {
  const props = PropertiesService.getScriptProperties();
  const cursor = parseInt(props.getProperty(CE.CURSOR_PROP) || '0', 10);
  let total = 0;
  try { total = JSON.parse(props.getProperty(CE.QUEUE_PROP) || '{}').total || 0; } catch (e) {}
  const running = props.getProperty(CE.RUNNING_PROP) === 'yes';
  const chunk = props.getProperty(CE.CHUNK_PROP) || CE.CHUNK_DEFAULT;
  const pct = total ? (cursor / total * 100).toFixed(1) : '0';
  const msg = 'Cost enrichment\n\nProcessed: ' + cursor + ' / ' + total + '  (' + pct + '%)' +
              '\nChunk size: ' + chunk + '\nStatus: ' + (running ? 'RUNNING' : 'stopped');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ============ output sheet ============ */

const ENRICH_COLS = ['productId','itemCode','lane','productName','variantId','variantName',
  'purchasePrice','landingCost','mrp','sellingPrice','margin','marginType',
  'discount','discountType','qty','shortDescription','description','batchUpdatedDate'];

function getEnrichSheet_(reset) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CE.OUT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CE.OUT_SHEET);
    sh.getRange(1, 1, 1, ENRICH_COLS.length).setValues([ENRICH_COLS]);
    sh.setFrozenRows(1);
  } else if (reset) {
    sh.clear();
    sh.getRange(1, 1, 1, ENRICH_COLS.length).setValues([ENRICH_COLS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ============ review builder ============ */

const REVIEW_COLS = ['canonical_code','description',
  'pp_w','lc_w','pp_wo','lc_wo',
  'lane_variance_pct','variance_flag',
  'master_cost','delta_vs_master_pct','master_flag',
  'sell_w_erp','sell_wo_erp','qty_w','qty_wo','batch_updated_w','batch_updated_wo'];

function numOr_(v) {
  const n = Number(v);
  return (v === '' || v === null || v === undefined || !isFinite(n)) ? null : n;
}
function numOrEmpty_(v) { const n = Number(v); return isFinite(n) ? n : ''; }

function buildCostReview() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(CE.OUT_SHEET);
  if (!src || src.getLastRow() < 2) throw new Error('No data in ' + CE.OUT_SHEET);

  const data = src.getRange(2, 1, src.getLastRow() - 1, ENRICH_COLS.length).getValues();
  const byCode = {};
  data.forEach(r => {
    const code = String(r[1] || '').trim();
    if (!code) return;
    const canon = code.replace(/\/+$/, '');
    const lane = String(r[2] || '');
    if (!byCode[canon]) byCode[canon] = { desc: '', W: null, WO: null };
    if (!byCode[canon].desc) byCode[canon].desc = String(r[3] || '').replace(/\/+\s*$/, '').trim();
    byCode[canon][lane] = { pp: r[6], lc: r[7], sell: r[9], qty: r[14], bu: r[17] };
  });

  const master = {};
  const pg = ss.getSheetByName(CE.PRICING_SHEET);
  if (pg && pg.getLastRow() > 1) {
    const pv = pg.getRange(2, 2, pg.getLastRow() - 1, 3).getValues();  // cols B,C,D
    pv.forEach(r => {
      const c = String(r[0] || '').trim();
      if (c) master[c] = Number(r[2]);
    });
  }

  const out = [];
  Object.keys(byCode).sort().forEach(canon => {
    const o = byCode[canon];
    const w = o.W || {}, wo = o.WO || {};
    const ppw = numOr_(w.pp), ppwo = numOr_(wo.pp);
    const lcw = numOr_(w.lc), lcwo = numOr_(wo.lc);
    const base = ppw !== null ? ppw : ppwo;

    let lanePct = '', laneFlag = '';
    if (ppw !== null && ppwo !== null && ppw > 0) {
      lanePct = (ppwo - ppw) / ppw * 100;
      const a = Math.abs(lanePct);
      laneFlag = a < 1 ? '' : (a < 10 ? 'CHECK' : 'MISMATCH');
    } else if (ppw === null || ppwo === null) {
      laneFlag = 'ONE_LANE_ONLY';
    }

    const mc = master[canon];
    let dPct = '', mFlag = '';
    if (base !== null && mc !== undefined && isFinite(mc) && mc > 0) {
      dPct = (base - mc) / mc * 100;
      const a = Math.abs(dPct);
      mFlag = a < 1 ? '' : (a < 10 ? 'MOVED' : 'BIG_MOVE');
    } else if (mc === undefined || !isFinite(mc) || mc === 0) {
      mFlag = 'NO_MASTER_COST';
    }

    out.push([canon, o.desc,
      ppw === null ? '' : ppw, lcw === null ? '' : lcw,
      ppwo === null ? '' : ppwo, lcwo === null ? '' : lcwo,
      lanePct === '' ? '' : Math.round(lanePct * 100) / 100, laneFlag,
      (mc === undefined ? '' : mc),
      dPct === '' ? '' : Math.round(dPct * 100) / 100, mFlag,
      numOrEmpty_(w.sell), numOrEmpty_(wo.sell),
      numOrEmpty_(w.qty), numOrEmpty_(wo.qty),
      w.bu || '', wo.bu || '']);
  });

  let sh = ss.getSheetByName(CE.REVIEW_SHEET);
  if (!sh) sh = ss.insertSheet(CE.REVIEW_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, REVIEW_COLS.length).setValues([REVIEW_COLS]);
  sh.setFrozenRows(1);
  if (out.length) sh.getRange(2, 1, out.length, REVIEW_COLS.length).setValues(out);

  let mism = 0, oneLane = 0, bigMove = 0, noMaster = 0;
  out.forEach(r => {
    if (r[7] === 'MISMATCH') mism++;
    if (r[7] === 'ONE_LANE_ONLY') oneLane++;
    if (r[10] === 'BIG_MOVE') bigMove++;
    if (r[10] === 'NO_MASTER_COST') noMaster++;
  });
  const msg = 'Cost_Review built: ' + out.length + ' canonical products.\n\n' +
    'W vs WO cost MISMATCH (>10%): ' + mism + '\n' +
    'Only one lane has cost: ' + oneLane + '\n' +
    'BIG_MOVE vs master (>10%): ' + bigMove + '\n' +
    'No master cost yet: ' + noMaster + '\n\n' +
    'Nothing in Pricing was modified. Review before changing prices.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function probeChunkHonest() {
  const ids = collectProductIds_().slice(0, 400);
  [50, 100, 200, 400].forEach(n => {
    if (ids.length < n) return;
    try {
      const got = fetchDetails_(ids.slice(0, n));
      Logger.log('requested ' + n + ' -> HTTP OK, ' + got.length +
                 ' products returned (' + (n - got.length) + ' skipped)');
    } catch (e) {
      Logger.log('requested ' + n + ' -> CALL FAILED: ' + e.message);
    }
    Utilities.sleep(15000);
  });
}

function diagnoseDetails() {
  const ids = collectProductIds_();
  Logger.log('Total ids available: ' + ids.length);

  // A. single id
  try {
    const r = fetchDetails_([ids[0]]);
    Logger.log('A. 1 id  (' + ids[0] + ') -> OK, ' + r.length + ' product(s)');
  } catch (e) {
    Logger.log('A. 1 id  (' + ids[0] + ') -> FAILED: ' + e.message);
  }
  Utilities.sleep(13000);

  // B. a different single id, in case id #1 is the bad one
  try {
    const r = fetchDetails_([ids[500]]);
    Logger.log('B. 1 id  (' + ids[500] + ') -> OK, ' + r.length + ' product(s)');
  } catch (e) {
    Logger.log('B. 1 id  (' + ids[500] + ') -> FAILED: ' + e.message);
  }
  Utilities.sleep(13000);

  // C. climb the sizes
  [2, 5, 10, 25].forEach(n => {
    try {
      const r = fetchDetails_(ids.slice(0, n));
      Logger.log('C. ' + n + ' ids -> OK, ' + r.length + ' product(s) returned');
    } catch (e) {
      Logger.log('C. ' + n + ' ids -> FAILED: ' + e.message);
    }
    Utilities.sleep(13000);
  });
}

function probeLimits() {
  const ids = collectProductIds_();

  // PART 1 — exact chunk ceiling between 10 and 25
  Logger.log('--- chunk ceiling ---');
  let best = 10;
  [12, 15, 18, 20, 22].forEach(n => {
    try {
      const r = fetchDetails_(ids.slice(0, n));
      Logger.log(n + ' ids -> OK (' + r.length + ' returned)');
      if (r.length >= n) best = n;
    } catch (e) {
      Logger.log(n + ' ids -> FAILED');
    }
    Utilities.sleep(13000);
  });
  Logger.log('Ceiling found: ' + best);

  // PART 2 — how fast can we call, at that size?
  Logger.log('--- cadence at chunk ' + best + ' ---');
  [8000, 5000, 3000, 2000].forEach(gap => {
    let ok = 0, rate = 0;
    for (let i = 0; i < 6; i++) {
      try {
        fetchDetails_(ids.slice(i * best, (i + 1) * best));
        ok++;
      } catch (e) {
        if (e.message.indexOf('429') >= 0) { rate++; break; }
      }
      Utilities.sleep(gap);
    }
    Logger.log('gap ' + gap + 'ms -> ' + ok + '/6 ok' + (rate ? '  ** 429 hit **' : '  clean'));
    Utilities.sleep(60000);   // cool off between cadence tests
  });
}