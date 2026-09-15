/**********************************************************************
 * VITHYA TRADERS — FORMULA FIX
 *
 * THE BUG
 *   installFormulas() used OR(), AND() and MIN() inside ARRAYFORMULA.
 *   Those functions AGGREGATE — they collapse the whole column into one
 *   value instead of evaluating row by row. So
 *        OR(cost="", cost=0, sell="")
 *   was evaluated ONCE across all 6,973 rows, found at least one blank,
 *   returned TRUE, and every row fell through to "".
 *
 *   Result: costs computed fine (they use IFS / nested IF, which ARE
 *   element-wise) but true_margin, vasy_margin, mrp, the wholesale and
 *   retail tiers, the lane comparison and margin_flag were all blank,
 *   and every row read "NO COST".
 *
 * THE FIX — element-wise equivalents
 *        OR(a,b)   ->  (a)+(b)>0        booleans add as 1/0
 *        AND(a,b)  ->  (a)*(b)=1
 *        MIN(a,b)  ->  IF(a<b,a,b)
 *
 * This script reinstalls ONLY the affected columns. Nothing else is touched:
 * your costs, charges, cost_source choices and manual entries stay as they are.
 *
 * RUN:  reinstallFormulas()
 * THEN: buildDashboardData()
 **********************************************************************/

const FX = {
  PRICING: 'Pricing',
  MARGIN_FLOOR: 0.12,
};

const FX_COLS = ['true_margin_w','true_margin_wo','vasy_margin_w','vasy_margin_wo',
  'mrp_w','mrp_wo','wh_price_w','wh_price_wo','rt_price_w','rt_price_wo',
  'w_as_wo_net','w_as_wo_margin','lane_margin_gap','margin_flag'];

function fxHeaderRow_(sh) {
  for (let r = 1; r <= 6; r++) {
    if (String(sh.getRange(r, 1).getValue()).trim() === 'product_id') return r;
  }
  throw new Error('Pricing header row not found.');
}
function fxMap_(sh, hRow) {
  const hdr = sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0];
  const M = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k) M[k] = i + 1; });
  return M;
}
function fxA1_(col) {
  let s = '', n = col;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); }
  return s;
}

function reinstallFormulas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(FX.PRICING);
  if (!sh) throw new Error('Pricing tab not found.');
  const hRow = fxHeaderRow_(sh);
  const M = fxMap_(sh, hRow);
  const f = hRow + 1;
  const n = sh.getLastRow() - hRow;

  const need = ['item_code','loaded_cost_w','loaded_cost_wo','cost_w_exGST','cost_wo',
    'selling_w','selling_wo','discount_w_pct','discount_wo_pct','gst_rate',
    'wh_disc_w','wh_disc_wo','rt_disc_w','rt_disc_wo'].concat(FX_COLS);
  const missing = need.filter(k => !M[k]);
  if (missing.length) throw new Error('Missing columns: ' + missing.join(', '));

  const C = {};
  need.forEach(k => C[k] = fxA1_(M[k]));
  const R = r => r + f + ':' + r;
  const key = R(C.item_code);
  const put = (name, formula) => sh.getRange(f, M[name]).setFormula(formula);

  // clear first so the ArrayFormula can expand
  FX_COLS.forEach(k => sh.getRange(f, M[k], n, 1).clearContent());

  /* ---- margins : (a)+(b)>0 instead of OR(a,b) ---- */
  const margin = (sell, cost) =>
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF((' + R(cost) + '="")+(' + R(cost) + '=0)+(' + R(sell) + '="")>0,"",' +
    R(sell) + '/' + R(cost) + '-1)))';
  put('true_margin_w',  margin(C.selling_w,  C.loaded_cost_w));
  put('true_margin_wo', margin(C.selling_wo, C.loaded_cost_wo));
  put('vasy_margin_w',  margin(C.selling_w,  C.cost_w_exGST));
  put('vasy_margin_wo', margin(C.selling_wo, C.cost_wo));

  /* ---- MRP ---- */
  const mrp = (sell, disc) =>
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF((' + R(sell) + '="")+(' + R(disc) + '="")+(' + R(disc) + '>=1)>0,"",' +
    'ROUND(' + R(sell) + '/(1-' + R(disc) + '),2))))';
  put('mrp_w',  mrp(C.selling_w,  C.discount_w_pct));
  put('mrp_wo', mrp(C.selling_wo, C.discount_wo_pct));

  /* ---- wholesale / retail : discounts off MRP ---- */
  const tier = (m, d) =>
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF((' + R(m) + '="")+(' + R(d) + '="")>0,"",' +
    'ROUND(' + R(m) + '*(1-' + R(d) + '),2))))';
  put('wh_price_w',  tier(C.mrp_w,  C.wh_disc_w));
  put('wh_price_wo', tier(C.mrp_wo, C.wh_disc_wo));
  put('rt_price_w',  tier(C.mrp_w,  C.rt_disc_w));
  put('rt_price_wo', tier(C.mrp_wo, C.rt_disc_wo));

  /* ---- lane comparison ---- */
  put('w_as_wo_net',
    '=ARRAYFORMULA(IF(' + key + '="","",IF(' + R(C.selling_wo) + '="","",' +
    'ROUND(' + R(C.selling_wo) + '/(1+' + R(C.gst_rate) + '/100),3))))');

  put('w_as_wo_margin',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF((' + R(C.w_as_wo_net) + '="")+(' + R(C.loaded_cost_w) + '="")+(' +
    R(C.loaded_cost_w) + '=0)>0,"",' +
    R(C.w_as_wo_net) + '/' + R(C.loaded_cost_w) + '-1)))');

  put('lane_margin_gap',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF((' + R(C.true_margin_w) + '="")+(' + R(C.w_as_wo_margin) + '="")>0,"",' +
    R(C.true_margin_w) + '-' + R(C.w_as_wo_margin) + ')))');

  /* ---- margin flag : AND -> multiply, MIN -> nested IF ---- */
  const tw = R(C.true_margin_w), two = R(C.true_margin_wo);
  const twSafe = 'IF(' + tw + '="",99,' + tw + ')';
  const twoSafe = 'IF(' + two + '="",99,' + two + ')';
  const lo = 'IF(' + twSafe + '<' + twoSafe + ',' + twSafe + ',' + twoSafe + ')';
  put('margin_flag',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF((' + tw + '="")*(' + two + '="")=1,"NO COST",' +
    'IF(' + lo + '<0,"LOSS",' +
    'IF(' + lo + '<' + FX.MARGIN_FLOOR + ',"BELOW ' + (FX.MARGIN_FLOOR * 100) + '%","")))))');

  /* ---- formats ---- */
  ['true_margin_w','true_margin_wo','vasy_margin_w','vasy_margin_wo',
   'w_as_wo_margin','lane_margin_gap'].forEach(k =>
    sh.getRange(f, M[k], n, 1).setNumberFormat('0.00%'));
  ['mrp_w','mrp_wo','wh_price_w','wh_price_wo','rt_price_w','rt_price_wo',
   'w_as_wo_net'].forEach(k =>
    sh.getRange(f, M[k], n, 1).setNumberFormat('#,##0.00'));
  ['true_margin_w','true_margin_wo'].forEach(k =>
    sh.getRange(f, M[k], n, 1).setBackground('#E2F0D9'));

  SpreadsheetApp.flush();
  Utilities.sleep(2000);

  /* ---- verify it actually worked ---- */
  const check = k => {
    const v = sh.getRange(f, M[k], Math.min(n, 500), 1).getValues();
    return v.filter(r => r[0] !== '' && r[0] !== null).length;
  };
  const tmw = check('true_margin_w');
  const mw = check('mrp_w');
  const flagVals = sh.getRange(f, M['margin_flag'], Math.min(n, 500), 1).getValues();
  const noCost = flagVals.filter(r => String(r[0]) === 'NO COST').length;

  const msg = 'FORMULAS REINSTALLED (element-wise fix)\n\n' +
    'Checked the first ' + Math.min(n, 500) + ' rows:\n' +
    '  true_margin_w filled : ' + tmw + '\n' +
    '  mrp_w filled         : ' + mw + '\n' +
    '  still "NO COST"      : ' + noCost + '\n\n' +
    (tmw > 0 ? 'Working — margins are computing.' :
      'STILL EMPTY — send me this message and I will dig further.') +
    '\n\nNEXT: buildDashboardData()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenFormulaFix() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 Fix')
    .addItem('Reinstall formulas (element-wise)', 'reinstallFormulas')
    .addToUi();
}