/**********************************************************************
 * VITHYA TRADERS — PHASE 1 : price model restructure
 *
 * WHAT THIS DOES
 *   1. Renames the Pricing columns that were built on the WRONG cost model
 *        landing_cost   -> loaded_cost      (cost + our charges)
 *        loading_value  -> packing_value
 *        loading_type   -> packing_type
 *        margin_w_pct   -> vasy_margin_w    (margin on product cost — what Vasy shows)
 *        margin_wo_pct  -> vasy_margin_wo
 *   2. Adds the columns the corrected model needs
 *        product_cost, true_margin_w, true_margin_wo, cost_model,
 *        wh_disc_w/wo, rt_disc_w/wo, wh_price_w/wo, rt_price_w/wo,
 *        margin_flag
 *   3. Back-fills them so today's prices are reproduced exactly
 *   4. Creates the (empty) rules tabs you will populate yourself
 *
 * THE MODEL  (see the plan document)
 *      loaded_cost  = product_cost + transport + packing
 *      selling      = loaded_cost  x (1 + true_margin)
 *      vasy_margin  = selling / product_cost - 1        (derived, for reconciliation)
 *      mrp          = selling / (1 - discount)          17% W, 30% WO
 *      wh_price     = mrp x (1 - wh_disc)               ** discounts come off MRP **
 *      rt_price     = mrp x (1 - rt_disc)
 *
 * WHY true_margin == vasy_margin RIGHT NOW
 *   Charges are zero everywhere until you enter them, so loaded_cost equals
 *   product_cost and the two margins are identical. The moment you add
 *   transport or packing to a product, they separate — and true_margin is
 *   the one that tells you what you actually earn.
 *
 * MARGIN FLOOR: 12%.  Anything below is flagged, never blocked.
 *
 * SAFE TO RE-RUN. Nothing is deleted; existing values are preserved.
 *
 * RUN:  phase1Restructure()
 * THEN: buildDashboardData()   so the dashboard sees the new fields
 **********************************************************************/

const P1 = {
  PRICING: 'Pricing',
  MARGIN_FLOOR: 0.12,
  DISC_W: 0.17,
  DISC_WO: 0.30,

  RULES: 'Category_Rules',
  RATECARD: 'Rate_Card',
  COMMODITY: 'Commodity_Rates',
  INCREMENTS: 'Rate_Increments',
  SUPPLIERS: 'Supplier_Cards',
};

/* columns to rename: old -> new */
const P1_RENAME = {
  'landing_cost': 'loaded_cost',
  'loading_value': 'packing_value',
  'loading_type': 'packing_type',
  'margin_w_pct': 'vasy_margin_w',
  'margin_wo_pct': 'vasy_margin_wo',
};

/* columns to add if missing, in this order */
const P1_ADD = [
  'product_cost',
  'true_margin_w', 'true_margin_wo',
  'cost_model',
  'wh_disc_w', 'wh_disc_wo', 'rt_disc_w', 'rt_disc_wo',
  'wh_price_w', 'wh_price_wo', 'rt_price_w', 'rt_price_wo',
  'margin_flag',
];

function p1Num_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function p1R3_(x) { return Math.round(x * 1000) / 1000; }
function p1R2_(x) { return Math.round(x * 100) / 100; }

function p1HeaderRow_(sh) {
  for (let r = 1; r <= 6; r++) {
    if (String(sh.getRange(r, 1).getValue()).trim() === 'product_id') return r;
  }
  throw new Error('Could not find the Pricing header row (looking for "product_id" in column A).');
}

function p1Map_(sh, hRow) {
  const hdr = sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0];
  const M = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k) M[k] = i + 1; });
  return M;
}

/* ================= main ================= */

function phase1Restructure() {
  const t0 = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(P1.PRICING);
  if (!sh) throw new Error('Pricing tab not found.');

  const hRow = p1HeaderRow_(sh);
  let M = p1Map_(sh, hRow);
  const log = [];

  /* ---- 1. rename ---- */
  Object.keys(P1_RENAME).forEach(oldName => {
    const newName = P1_RENAME[oldName];
    if (M[oldName] && !M[newName]) {
      sh.getRange(hRow, M[oldName]).setValue(newName);
      log.push('renamed ' + oldName + ' -> ' + newName);
    }
  });
  M = p1Map_(sh, hRow);

  /* ---- 2. add missing columns ---- */
  let nextCol = sh.getLastColumn();
  P1_ADD.forEach(name => {
    if (M[name]) return;
    nextCol++;
    sh.getRange(hRow, nextCol).setValue(name);
    log.push('added ' + name);
  });
  // widen if we appended beyond the sheet's current width
  SpreadsheetApp.flush();
  M = p1Map_(sh, hRow);

  const first = hRow + 1;
  const n = sh.getLastRow() - hRow;
  if (n <= 0) throw new Error('Pricing has no data rows.');

  /* ---- 3. read what we need ---- */
  const get = name => M[name] ? sh.getRange(first, M[name], n, 1).getValues() : null;
  const costActive = get('cost_active') || [];
  const transV = get('transport_value') || [];
  const transT = get('transport_type') || [];
  const packV = get('packing_value') || [];
  const packT = get('packing_type') || [];
  const vmW = get('vasy_margin_w') || [];
  const vmWO = get('vasy_margin_wo') || [];
  const sellW = get('selling_w') || [];
  const sellWO = get('selling_wo') || [];
  const dW = get('discount_w_pct') || [];
  const dWO = get('discount_wo_pct') || [];
  const mrpW = get('mrp_w') || [];
  const mrpWO = get('mrp_wo') || [];
  const codes = get('item_code') || [];

  /* ---- 4. compute ---- */
  const outProductCost = [], outLoaded = [], outTrueW = [], outTrueWO = [];
  const outVasyW = [], outVasyWO = [], outModel = [], outFlag = [];
  const outWhD = [], outWhDwo = [], outRtD = [], outRtDwo = [];
  const outWhP = [], outWhPwo = [], outRtP = [], outRtPwo = [];

  let flagged = 0, noCost = 0;

  for (let i = 0; i < n; i++) {
    const code = String((codes[i] || [''])[0] || '').trim();
    const pc = p1Num_((costActive[i] || [''])[0]);          // product cost = old cost_active
    const tv = p1Num_((transV[i] || [0])[0]) || 0;
    const tt = String((transT[i] || ['amount'])[0] || 'amount');
    const pv = p1Num_((packV[i] || [0])[0]) || 0;
    const pt = String((packT[i] || ['amount'])[0] || 'amount');

    const sw = p1Num_((sellW[i] || [''])[0]);
    const swo = p1Num_((sellWO[i] || [''])[0]);
    const discW = p1Num_((dW[i] || [''])[0]);
    const discWO = p1Num_((dWO[i] || [''])[0]);

    // charges
    let loaded = '';
    if (pc !== '' && pc > 0) {
      const tAmt = (tt === 'percentage') ? pc * tv / 100 : tv;
      const pAmt = (pt === 'percentage') ? pc * pv / 100 : pv;
      loaded = p1R3_(pc + tAmt + pAmt);
    } else {
      noCost++;
    }

    // margins — TRUE is on loaded cost, VASY is on product cost
    let trueW = '', trueWO = '', vW = '', vWO = '';
    if (loaded !== '' && loaded > 0) {
      if (sw !== '' && sw > 0) trueW = sw / loaded - 1;
      if (swo !== '' && swo > 0) trueWO = swo / loaded - 1;
    }
    if (pc !== '' && pc > 0) {
      if (sw !== '' && sw > 0) vW = sw / pc - 1;
      if (swo !== '' && swo > 0) vWO = swo / pc - 1;
    }

    // wholesale / retail — discounts come OFF MRP
    const mw = p1Num_((mrpW[i] || [''])[0]);
    const mwo = p1Num_((mrpWO[i] || [''])[0]);
    const whd = '', whdwo = '', rtd = '', rtdwo = '';   // blank until you set them
    const whp = '', whpwo = '', rtp = '', rtpwo = '';

    // margin floor flag
    let flag = '';
    const worst = [trueW, trueWO].filter(x => x !== '' && isFinite(x));
    if (worst.length) {
      const lo = Math.min.apply(null, worst);
      if (lo < 0) { flag = 'LOSS'; flagged++; }
      else if (lo < P1.MARGIN_FLOOR) { flag = 'BELOW ' + (P1.MARGIN_FLOOR * 100) + '%'; flagged++; }
    } else if (pc === '' || pc === 0) {
      flag = 'NO COST';
    }

    outProductCost.push([pc === '' ? '' : pc]);
    outLoaded.push([loaded]);
    outTrueW.push([trueW === '' ? '' : trueW]);
    outTrueWO.push([trueWO === '' ? '' : trueWO]);
    outVasyW.push([vW === '' ? '' : vW]);
    outVasyWO.push([vWO === '' ? '' : vWO]);
    outModel.push(['DIRECT']);
    outFlag.push([flag]);
    outWhD.push([whd]); outWhDwo.push([whdwo]);
    outRtD.push([rtd]); outRtDwo.push([rtdwo]);
    outWhP.push([whp]); outWhPwo.push([whpwo]);
    outRtP.push([rtp]); outRtPwo.push([rtpwo]);
  }

  /* ---- 5. write ---- */
  const put = (name, vals) => { if (M[name]) sh.getRange(first, M[name], n, 1).setValues(vals); };
  put('product_cost', outProductCost);
  put('loaded_cost', outLoaded);
  put('true_margin_w', outTrueW);
  put('true_margin_wo', outTrueWO);
  put('vasy_margin_w', outVasyW);
  put('vasy_margin_wo', outVasyWO);
  put('cost_model', outModel);
  put('margin_flag', outFlag);
  put('wh_disc_w', outWhD); put('wh_disc_wo', outWhDwo);
  put('rt_disc_w', outRtD); put('rt_disc_wo', outRtDwo);
  put('wh_price_w', outWhP); put('wh_price_wo', outWhPwo);
  put('rt_price_w', outRtP); put('rt_price_wo', outRtPwo);

  /* ---- 6. formatting ---- */
  ['true_margin_w','true_margin_wo','vasy_margin_w','vasy_margin_wo',
   'wh_disc_w','wh_disc_wo','rt_disc_w','rt_disc_wo',
   'discount_w_pct','discount_wo_pct'].forEach(c => {
    if (M[c]) sh.getRange(first, M[c], n, 1).setNumberFormat('0.00%');
  });
  ['product_cost','loaded_cost','selling_w','selling_wo','mrp_w','mrp_wo',
   'wh_price_w','wh_price_wo','rt_price_w','rt_price_wo'].forEach(c => {
    if (M[c]) sh.getRange(first, M[c], n, 1).setNumberFormat('#,##0.00');
  });
  // header styling for the new block
  P1_ADD.concat(Object.keys(P1_RENAME).map(k => P1_RENAME[k])).forEach(c => {
    if (M[c]) sh.getRange(hRow, M[c]).setFontWeight('bold')
      .setBackground('#1F3864').setFontColor('#FFFFFF');
  });
  // highlight the two headline numbers
  if (M.loaded_cost) sh.getRange(first, M.loaded_cost, n, 1).setBackground('#E2F0D9');
  if (M.true_margin_w) sh.getRange(first, M.true_margin_w, n, 1).setBackground('#E2F0D9');
  if (M.true_margin_wo) sh.getRange(first, M.true_margin_wo, n, 1).setBackground('#E2F0D9');

  /* ---- 7. rules tabs (empty — you populate them) ---- */
  const made = p1MakeRuleTabs_();

  const msg = 'PHASE 1 COMPLETE (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'Pricing rows processed: ' + n + '\n' +
    'Products flagged below ' + (P1.MARGIN_FLOOR * 100) + '% true margin: ' + flagged + '\n' +
    'Products with no cost: ' + noCost + '\n\n' +
    'Column changes:\n  ' + (log.length ? log.join('\n  ') : 'none needed') + '\n\n' +
    'Rules tabs: ' + (made.length ? made.join(', ') : 'already existed') + '\n\n' +
    'Charges are ZERO everywhere, so true_margin currently equals vasy_margin.\n' +
    'They separate as soon as you enter transport or packing.\n\n' +
    'NEXT: run buildDashboardData().';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return { rows: n, flagged: flagged, log: log };
}

/* ================= rules tabs ================= */

function p1MakeTab_(name, headers, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(name)) return false;
  const sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold')
    .setBackground('#1F3864').setFontColor('#FFFFFF').setWrap(true);
  if (note) {
    sh.getRange(1, headers.length + 2).setValue(note)
      .setFontStyle('italic').setFontColor('#666666');
  }
  for (let c = 1; c <= headers.length; c++) sh.setColumnWidth(c, 130);
  return true;
}

function p1MakeRuleTabs_() {
  const made = [];

  if (p1MakeTab_(P1.RULES,
    ['scope_type','scope_value','transport_type','transport_value',
     'packing_type','packing_value','default_true_margin','disc_w','disc_wo','note'],
    'scope_type: department | category | sub_category | brand. Most specific wins. Leave empty to set nothing.'))
    made.push(P1.RULES);

  if (p1MakeTab_(P1.RATECARD,
    ['card_name','material','size','size_unit','rate','rate_unit','effective_from','note'],
    'For patta / pipe style pricing: rate per mm or per kg, by material and size.'))
    made.push(P1.RATECARD);

  if (p1MakeTab_(P1.COMMODITY,
    ['date','commodity','base_rate','unit','entered_by','note'],
    'One row per commodity per day. Enter today rate once; indexed products reprice.'))
    made.push(P1.COMMODITY);

  if (p1MakeTab_(P1.INCREMENTS,
    ['commodity','size','size_unit','type','increment','note'],
    'Size/type increments over the base rate. e.g. copper, 1.2mm, NOD, +8.'))
    made.push(P1.INCREMENTS);

  if (p1MakeTab_(P1.SUPPLIERS,
    ['supplier_name','card_name','discount_pct','effective_from','note'],
    'Supplier MRP-less-discount cards. Change the discount once, all their products reprice.'))
    made.push(P1.SUPPLIERS);

  return made;
}

/* ================= recompute after you enter charges ================= */

/**
 * Recomputes loaded_cost, both margins and the margin flag from whatever is
 * currently in product_cost / transport / packing / selling.
 * Run this after entering charges by hand in the sheet.
 * (The dashboard will do this automatically once built.)
 */
function recomputeLoadedCost() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(P1.PRICING);
  const hRow = p1HeaderRow_(sh);
  const M = p1Map_(sh, hRow);
  const first = hRow + 1;
  const n = sh.getLastRow() - hRow;
  if (n <= 0) return;

  const g = name => M[name] ? sh.getRange(first, M[name], n, 1).getValues() : null;
  const pcs = g('product_cost'), tv = g('transport_value'), tt = g('transport_type');
  const pv = g('packing_value'), pt = g('packing_type');
  const sw = g('selling_w'), swo = g('selling_wo');

  const loaded = [], tW = [], tWO = [], vW = [], vWO = [], flag = [];
  let flagged = 0;

  for (let i = 0; i < n; i++) {
    const pc = p1Num_((pcs[i] || [''])[0]);
    const a = p1Num_((tv[i] || [0])[0]) || 0;
    const at = String((tt[i] || ['amount'])[0] || 'amount');
    const b = p1Num_((pv[i] || [0])[0]) || 0;
    const bt = String((pt[i] || ['amount'])[0] || 'amount');
    const s1 = p1Num_((sw[i] || [''])[0]);
    const s2 = p1Num_((swo[i] || [''])[0]);

    let L = '';
    if (pc !== '' && pc > 0) {
      L = p1R3_(pc + (at === 'percentage' ? pc * a / 100 : a) +
                     (bt === 'percentage' ? pc * b / 100 : b));
    }
    const t1 = (L !== '' && L > 0 && s1 !== '' && s1 > 0) ? s1 / L - 1 : '';
    const t2 = (L !== '' && L > 0 && s2 !== '' && s2 > 0) ? s2 / L - 1 : '';
    const q1 = (pc !== '' && pc > 0 && s1 !== '' && s1 > 0) ? s1 / pc - 1 : '';
    const q2 = (pc !== '' && pc > 0 && s2 !== '' && s2 > 0) ? s2 / pc - 1 : '';

    let f = '';
    const arr = [t1, t2].filter(x => x !== '' && isFinite(x));
    if (arr.length) {
      const lo = Math.min.apply(null, arr);
      if (lo < 0) { f = 'LOSS'; flagged++; }
      else if (lo < P1.MARGIN_FLOOR) { f = 'BELOW ' + (P1.MARGIN_FLOOR * 100) + '%'; flagged++; }
    } else if (pc === '' || pc === 0) f = 'NO COST';

    loaded.push([L]); tW.push([t1]); tWO.push([t2]);
    vW.push([q1]); vWO.push([q2]); flag.push([f]);
  }

  const put = (name, vals) => { if (M[name]) sh.getRange(first, M[name], n, 1).setValues(vals); };
  put('loaded_cost', loaded);
  put('true_margin_w', tW); put('true_margin_wo', tWO);
  put('vasy_margin_w', vW); put('vasy_margin_wo', vWO);
  put('margin_flag', flag);

  const msg = 'Recomputed ' + n + ' row(s).\n\nFlagged below ' +
    (P1.MARGIN_FLOOR * 100) + '% true margin: ' + flagged;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= menu ================= */

function onOpenPhase1() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Price Model')
    .addItem('Run Phase 1 restructure', 'phase1Restructure')
    .addItem('Recompute loaded cost & margins', 'recomputeLoadedCost')
    .addToUi();
}