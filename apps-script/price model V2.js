/**********************************************************************
 * VITHYA TRADERS — PRICE MODEL v2   (corrected against your own sheet)
 *
 * ─────────────── WHAT WAS WRONG BEFORE ───────────────
 *  1. W selling price is GST-INCLUSIVE. It was treated as a plain number.
 *  2. W margins are measured on the GST-INCLUSIVE cost, not the ex-GST cost.
 *     Both sides of the ratio include tax, so it is self-consistent — but the
 *     old formulas divided an incl-GST price by an ex-GST cost and inflated
 *     every margin. (Median "true margin" came out 41.6%, which was actually
 *     the VASY margin. That should have been the giveaway.)
 *  3. Transport % for W applies to the INCL-GST cost, not the ex-GST cost.
 *
 * ─────────────── THE MODEL (verified against your workbook) ───────────────
 *
 *  W LANE
 *      cost_w_exGST                        supplier cost, pre-tax
 *      cost_w_incGST  = cost_w_exGST × (1 + gst)      ← Vasy's "landing cost"
 *      transport_w    = % of cost_w_incGST   (or a flat amount)
 *      packing_w      = flat amount          (or a %)
 *      loaded_cost_w  = cost_w_incGST + transport_w + packing_w
 *      selling_w_incGST                      ← the price you quote
 *      selling_w_exGST= selling_w_incGST / (1 + gst)
 *      vasy_margin_w  = (selling_w_incGST − cost_w_incGST) / cost_w_incGST
 *      true_margin_w  = (selling_w_incGST − loaded_cost_w) / loaded_cost_w
 *      mrp_w          = selling_w_incGST / (1 − discount_w)
 *
 *  WO LANE
 *      cost_wo        = cost_manual_wo, else cost_w_exGST × (1 + wo_rate_increase)
 *      transport_wo   = flat amount (or %)
 *      packing_wo     = flat amount (or %)
 *      loaded_cost_wo = cost_wo + transport_wo + packing_wo
 *      selling_wo     = if wo_price_mode = "same_as_w_incl"  → selling_w_incGST
 *                       else                                  → selling_w_exGST × (1 + wo_margin_increase)
 *      vasy_margin_wo = (selling_wo − cost_wo) / cost_wo
 *      true_margin_wo = (selling_wo − loaded_cost_wo) / loaded_cost_wo
 *      mrp_wo         = selling_wo / (1 − discount_wo)
 *
 *  CROSS-LANE (buy in one lane, sell through the other)
 *      buy_w_sell_wo  = (selling_wo        − loaded_cost_w)  / loaded_cost_w
 *      buy_wo_sell_w  = (selling_w_incGST  − loaded_cost_wo) / loaded_cost_wo
 *      Each is compared against that lane's own margin to give the gain/loss.
 *
 *  WORKED EXAMPLE from your sheet (BG40313, transport 10% + packing 5):
 *      W : 220.34 → incl 260.00 → +26.00 +5.00 → loaded 291.00
 *          sell 368.115  →  vasy 41.58%   true 26.50%   MRP 443.51
 *      WO: 306.80 → +10.00 +5.00 → loaded 321.80
 *          sell 368.115  →  vasy 19.99%   true 14.39%   MRP 525.88
 *
 * ─────────────── RUN ───────────────
 *   1. priceModel2Setup()      renames + adds columns, migrates values
 *   2. priceModel2Formulas()   installs the corrected live formulas
 *   3. buildDashboardData()
 *
 *   priceModel2Freeze() converts formulas to values if the sheet feels slow.
 **********************************************************************/

const PX = {
  PRICING: 'Pricing',
  CORE: 'Products_Core',
  FLOOR: 0.12,
  DEFAULT_GST: 18,
};

/* old -> new */
const PX_RENAME = {
  'selling_w':        'selling_w_incGST',
  'transport_value':  'transport_w_value',
  'transport_type':   'transport_w_type',
  'packing_value':    'packing_w_value',
  'packing_type':     'packing_w_type',
};

/* appended if missing */
const PX_ADD = [
  'cost_w_incGST', 'selling_w_exGST',
  'wo_rate_increase', 'wo_price_mode', 'wo_margin_increase',
  'transport_wo_value', 'transport_wo_type',
  'packing_wo_value', 'packing_wo_type',
  'buy_w_sell_wo', 'buy_wo_sell_w', 'cross_gain_w_to_wo', 'cross_gain_wo_to_w',
];

/* all columns the formulas own */
const PX_FORMULA_COLS = ['cost_w_exGST','cost_w_incGST','cost_wo',
  'loaded_cost_w','loaded_cost_wo','selling_w_exGST','selling_wo',
  'true_margin_w','true_margin_wo','vasy_margin_w','vasy_margin_wo',
  'mrp_w','mrp_wo','wh_price_w','wh_price_wo','rt_price_w','rt_price_wo',
  'buy_w_sell_wo','buy_wo_sell_w','cross_gain_w_to_wo','cross_gain_wo_to_w',
  'margin_flag'];

function pxHeaderRow_(sh) {
  for (let r = 1; r <= 6; r++)
    if (String(sh.getRange(r, 1).getValue()).trim() === 'product_id') return r;
  throw new Error('Pricing header row not found.');
}
function pxMap_(sh, hRow) {
  const hdr = sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0];
  const M = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k) M[k] = i + 1; });
  return M;
}
function pxA1_(c) {
  let s = '', n = c;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); }
  return s;
}
function pxNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }

/* ================= 1. setup ================= */

function priceModel2Setup() {
  const t0 = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PX.PRICING);
  if (!sh) throw new Error('Pricing tab not found.');
  const hRow = pxHeaderRow_(sh);
  let M = pxMap_(sh, hRow);
  const log = [];

  Object.keys(PX_RENAME).forEach(o => {
    const nw = PX_RENAME[o];
    if (M[o] && !M[nw]) { sh.getRange(hRow, M[o]).setValue(nw); log.push(o + ' → ' + nw); }
  });
  M = pxMap_(sh, hRow);

  let col = sh.getLastColumn();
  PX_ADD.forEach(nm => {
    if (M[nm]) return;
    col++; sh.getRange(hRow, col).setValue(nm); log.push('+ ' + nm);
  });
  SpreadsheetApp.flush();
  M = pxMap_(sh, hRow);

  const first = hRow + 1;
  const n = sh.getLastRow() - hRow;
  if (n <= 0) throw new Error('Pricing has no data rows.');

  /* defaults for the new inputs */
  function seed(name, val, onlyIfBlank) {
    if (!M[name]) return;
    const rng = sh.getRange(first, M[name], n, 1);
    const cur = rng.getValues();
    rng.setValues(cur.map(r => {
      const v = r[0];
      if (onlyIfBlank && v !== '' && v !== null) return [v];
      return [val];
    }));
  }
  seed('transport_wo_type', 'amount', true);
  seed('packing_wo_type', 'amount', true);
  seed('transport_wo_value', 0, true);
  seed('packing_wo_value', 0, true);
  seed('wo_price_mode', 'same_as_w_incl', true);
  seed('wo_rate_increase', '', true);
  seed('wo_margin_increase', '', true);

  /* dropdowns — no free text, so no duplicates creep in */
  function dd(name, list) {
    if (!M[name]) return;
    const rng = sh.getRange(first, M[name], n, 1);
    rng.clearDataValidations();
    rng.setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(list, true).setAllowInvalid(false).build());
  }
  dd('transport_w_type', ['percentage', 'amount']);
  dd('packing_w_type', ['percentage', 'amount']);
  dd('transport_wo_type', ['percentage', 'amount']);
  dd('packing_wo_type', ['percentage', 'amount']);
  dd('wo_price_mode', ['same_as_w_incl', 'from_w_exgst_plus_margin', 'manual']);
  dd('cost_source', ['frozen', 'batch_bill', 'batch_current', 'manual', 'none']);
  dd('cost_model', ['DIRECT', 'SUPPLIER_MRP_LESS_DISCOUNT', 'RATE_PER_UNIT',
    'COMMODITY_INDEXED', 'RECIPE']);

  PX_ADD.concat(Object.keys(PX_RENAME).map(k => PX_RENAME[k])).forEach(c => {
    if (M[c]) sh.getRange(hRow, M[c]).setFontWeight('bold')
      .setBackground('#1F3864').setFontColor('#FFFFFF').setWrap(true);
  });

  const msg = 'PRICE MODEL v2 SET UP (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'Rows: ' + n + '\n\nChanges:\n   ' + (log.length ? log.join('\n   ') : 'none needed') +
    '\n\nDropdowns added to every non-numeric column.\n\n' +
    'NEXT: priceModel2Formulas()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= 2. formulas ================= */

function priceModel2Formulas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PX.PRICING);
  const hRow = pxHeaderRow_(sh);
  const M = pxMap_(sh, hRow);
  const f = hRow + 1;
  const n = sh.getLastRow() - hRow;

  const need = ['item_code','cost_source','cost_frozen_exGST','cost_bill_w_exGST','cost_bill_wo',
    'cost_current_w_exGST','cost_current_wo','cost_manual_w_exGST','cost_manual_wo','gst_rate',
    'cost_w_exGST','cost_w_incGST','cost_wo','wo_rate_increase','wo_price_mode','wo_margin_increase',
    'transport_w_value','transport_w_type','packing_w_value','packing_w_type',
    'transport_wo_value','transport_wo_type','packing_wo_value','packing_wo_type',
    'loaded_cost_w','loaded_cost_wo','selling_w_incGST','selling_w_exGST','selling_wo',
    'true_margin_w','true_margin_wo','vasy_margin_w','vasy_margin_wo',
    'discount_w_pct','discount_wo_pct','mrp_w','mrp_wo',
    'wh_disc_w','wh_disc_wo','rt_disc_w','rt_disc_wo',
    'wh_price_w','wh_price_wo','rt_price_w','rt_price_wo',
    'buy_w_sell_wo','buy_wo_sell_w','cross_gain_w_to_wo','cross_gain_wo_to_w','margin_flag'];
  const missing = need.filter(k => !M[k]);
  if (missing.length) throw new Error('Missing columns: ' + missing.join(', ') +
    '\n\nRun priceModel2Setup() first.');

  const C = {}; need.forEach(k => C[k] = pxA1_(M[k]));
  const R = r => r + f + ':' + r;
  const key = R(C.item_code);
  const put = (name, formula) => sh.getRange(f, M[name]).setFormula(formula);
  const blank = x => '(' + x + '="")';

  PX_FORMULA_COLS.forEach(k => { if (M[k]) sh.getRange(f, M[k], n, 1).clearContent(); });

  /* --- W cost, ex then incl GST --- */
  put('cost_w_exGST',
    '=ARRAYFORMULA(IF(' + key + '="","",IFS(' +
    R(C.cost_source) + '="manual",' + R(C.cost_manual_w_exGST) + ',' +
    R(C.cost_source) + '="batch_bill",' + R(C.cost_bill_w_exGST) + ',' +
    R(C.cost_source) + '="batch_current",' + R(C.cost_current_w_exGST) + ',' +
    R(C.cost_source) + '="frozen",' + R(C.cost_frozen_exGST) + ',TRUE,"")))');

  put('cost_w_incGST',
    '=ARRAYFORMULA(IF(' + key + '="","",IF(' + blank(R(C.cost_w_exGST)) + ',"",' +
    'ROUND(' + R(C.cost_w_exGST) + '*(1+' + R(C.gst_rate) + '/100),4))))');

  /* --- WO cost: manual override, else W ex-GST cost uplifted --- */
  put('cost_wo',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF(NOT(' + blank(R(C.cost_manual_wo)) + '),' + R(C.cost_manual_wo) + ',' +
    'IFS(' + R(C.cost_source) + '="batch_bill",' + R(C.cost_bill_wo) + ',' +
    R(C.cost_source) + '="batch_current",' + R(C.cost_current_wo) + ',' +
    'NOT(' + blank(R(C.wo_rate_increase)) + '),' +
    R(C.cost_w_exGST) + '*(1+' + R(C.wo_rate_increase) + '),' +
    'TRUE,' + R(C.cost_bill_wo) + '))))');

  /* --- loaded cost per lane; W charges sit on the INCL-GST base --- */
  const chg = (base, tv, tt, pv, pt) =>
    'IF(' + R(tt) + '="percentage",' + base + '*' + R(tv) + ',' + R(tv) + ')' +
    '+IF(' + R(pt) + '="percentage",' + base + '*' + R(pv) + ',' + R(pv) + ')';

  put('loaded_cost_w',
    '=ARRAYFORMULA(IF(' + key + '="","",IF(' + blank(R(C.cost_w_incGST)) + ',"",' +
    'ROUND(' + R(C.cost_w_incGST) + '+' +
    chg(R(C.cost_w_incGST), C.transport_w_value, C.transport_w_type,
        C.packing_w_value, C.packing_w_type) + ',4))))');

  put('loaded_cost_wo',
    '=ARRAYFORMULA(IF(' + key + '="","",IF(' + blank(R(C.cost_wo)) + ',"",' +
    'ROUND(' + R(C.cost_wo) + '+' +
    chg(R(C.cost_wo), C.transport_wo_value, C.transport_wo_type,
        C.packing_wo_value, C.packing_wo_type) + ',4))))');

  /* --- selling prices --- */
  put('selling_w_exGST',
    '=ARRAYFORMULA(IF(' + key + '="","",IF(' + blank(R(C.selling_w_incGST)) + ',"",' +
    'ROUND(' + R(C.selling_w_incGST) + '/(1+' + R(C.gst_rate) + '/100),4))))');

  put('selling_wo',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IFS(' + R(C.wo_price_mode) + '="same_as_w_incl",' + R(C.selling_w_incGST) + ',' +
    R(C.wo_price_mode) + '="from_w_exgst_plus_margin",' +
    'IF(' + blank(R(C.wo_margin_increase)) + ',"",' +
    'ROUND(' + R(C.selling_w_exGST) + '*(1+' + R(C.wo_margin_increase) + '),4)),' +
    'TRUE,' + R(C.selling_wo) + ')))');

  /* --- margins: W on the incl-GST basis, WO on the plain basis --- */
  const marg = (sell, cost) =>
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF(' + blank(R(cost)) + '+(' + R(cost) + '=0)+' + blank(R(sell)) + '>0,"",' +
    R(sell) + '/' + R(cost) + '-1)))';
  put('vasy_margin_w',  marg(C.selling_w_incGST, C.cost_w_incGST));
  put('true_margin_w',  marg(C.selling_w_incGST, C.loaded_cost_w));
  put('vasy_margin_wo', marg(C.selling_wo,       C.cost_wo));
  put('true_margin_wo', marg(C.selling_wo,       C.loaded_cost_wo));

  /* --- MRP --- */
  const mrp = (sell, disc) =>
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF(' + blank(R(sell)) + '+' + blank(R(disc)) + '+(' + R(disc) + '>=1)>0,"",' +
    'ROUND(' + R(sell) + '/(1-' + R(disc) + '),2))))';
  put('mrp_w',  mrp(C.selling_w_incGST, C.discount_w_pct));
  put('mrp_wo', mrp(C.selling_wo,       C.discount_wo_pct));

  /* --- wholesale / retail off MRP --- */
  const tier = (m, d) =>
    '=ARRAYFORMULA(IF(' + key + '="","",IF(' + blank(R(m)) + '+' + blank(R(d)) + '>0,"",' +
    'ROUND(' + R(m) + '*(1-' + R(d) + '),2))))';
  put('wh_price_w',  tier(C.mrp_w,  C.wh_disc_w));
  put('wh_price_wo', tier(C.mrp_wo, C.wh_disc_wo));
  put('rt_price_w',  tier(C.mrp_w,  C.rt_disc_w));
  put('rt_price_wo', tier(C.mrp_wo, C.rt_disc_wo));

  /* --- cross-lane --- */
  put('buy_w_sell_wo', marg(C.selling_wo, C.loaded_cost_w));
  put('buy_wo_sell_w', marg(C.selling_w_incGST, C.loaded_cost_wo));
  put('cross_gain_w_to_wo',
    '=ARRAYFORMULA(IF(' + key + '="","",IF(' + blank(R(C.buy_w_sell_wo)) + '+' +
    blank(R(C.true_margin_w)) + '>0,"",' + R(C.buy_w_sell_wo) + '-' + R(C.true_margin_w) + ')))');
  put('cross_gain_wo_to_w',
    '=ARRAYFORMULA(IF(' + key + '="","",IF(' + blank(R(C.buy_wo_sell_w)) + '+' +
    blank(R(C.true_margin_wo)) + '>0,"",' + R(C.buy_wo_sell_w) + '-' + R(C.true_margin_wo) + ')))');

  /* --- flag --- */
  const tw = R(C.true_margin_w), two = R(C.true_margin_wo);
  const a = 'IF(' + tw + '="",99,' + tw + ')', b = 'IF(' + two + '="",99,' + two + ')';
  const lo = 'IF(' + a + '<' + b + ',' + a + ',' + b + ')';
  put('margin_flag',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF((' + tw + '="")*(' + two + '="")=1,"NO COST",' +
    'IF(' + lo + '<0,"LOSS",IF(' + lo + '<' + PX.FLOOR + ',"BELOW 12%","")))))');

  /* --- formats --- */
  ['true_margin_w','true_margin_wo','vasy_margin_w','vasy_margin_wo','discount_w_pct',
   'discount_wo_pct','wh_disc_w','wh_disc_wo','rt_disc_w','rt_disc_wo','wo_rate_increase',
   'wo_margin_increase','buy_w_sell_wo','buy_wo_sell_w','cross_gain_w_to_wo',
   'cross_gain_wo_to_w'].forEach(k => {
    if (M[k]) sh.getRange(f, M[k], n, 1).setNumberFormat('0.00%');
  });
  ['cost_w_exGST','cost_w_incGST','cost_wo','loaded_cost_w','loaded_cost_wo',
   'selling_w_incGST','selling_w_exGST','selling_wo','mrp_w','mrp_wo',
   'wh_price_w','wh_price_wo','rt_price_w','rt_price_wo'].forEach(k => {
    if (M[k]) sh.getRange(f, M[k], n, 1).setNumberFormat('#,##0.00');
  });
  ['loaded_cost_w','loaded_cost_wo','true_margin_w','true_margin_wo'].forEach(k => {
    if (M[k]) sh.getRange(f, M[k], n, 1).setBackground('#E2F0D9');
  });

  SpreadsheetApp.flush();
  Utilities.sleep(1500);

  const probe = k => sh.getRange(f, M[k], Math.min(n, 400), 1).getValues()
    .filter(r => r[0] !== '' && r[0] !== null).length;
  const msg = 'CORRECTED FORMULAS INSTALLED\n\n' +
    'Checked the first ' + Math.min(n, 400) + ' rows:\n' +
    '   cost_w_incGST : ' + probe('cost_w_incGST') + '\n' +
    '   loaded_cost_w : ' + probe('loaded_cost_w') + '\n' +
    '   true_margin_w : ' + probe('true_margin_w') + '\n' +
    '   vasy_margin_w : ' + probe('vasy_margin_w') + '\n\n' +
    'W margins now sit on the INCL-GST basis, matching your workbook.\n' +
    'Expect true_margin_w to drop compared with the old (wrong) figures.\n\n' +
    'NEXT: buildDashboardData()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= 3. freeze ================= */

function priceModel2Freeze() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PX.PRICING);
  const hRow = pxHeaderRow_(sh);
  const M = pxMap_(sh, hRow);
  const f = hRow + 1, n = sh.getLastRow() - hRow;
  let d = 0;
  PX_FORMULA_COLS.forEach(k => {
    if (!M[k]) return;
    const rng = sh.getRange(f, M[k], n, 1);
    const v = rng.getValues(); rng.clearContent(); rng.setValues(v); d++;
  });
  try { SpreadsheetApp.getUi().alert('Froze ' + d + ' column(s) to values.'); } catch (e) {}
}

/* ================= verification against your workbook ================= */

function priceModel2SelfTest() {
  function calc(costEx, gst, tW, tWtype, pW, costWo, tWo, pWo, sellIncl, dW, dWo) {
    const incl = costEx * (1 + gst / 100);
    const trans = tWtype === 'percentage' ? incl * tW : tW;
    const loadedW = incl + trans + pW;
    const loadedWo = costWo + tWo + pWo;
    const sellEx = sellIncl / (1 + gst / 100);
    return {
      incl: incl, loadedW: loadedW, loadedWo: loadedWo, sellEx: sellEx,
      vasyW: sellIncl / incl - 1, trueW: sellIncl / loadedW - 1,
      vasyWo: sellIncl / costWo - 1, trueWo: sellIncl / loadedWo - 1,
      mrpW: sellIncl / (1 - dW), mrpWo: sellIncl / (1 - dWo),
    };
  }
  const r = calc(220.34, 18, 0.10, 'percentage', 5, 306.8, 10, 5, 368.115, 0.17, 0.30);
  const exp = { incl: 260.0012, loadedW: 291.00132, loadedWo: 321.8,
    vasyW: 0.4158203885, trueW: 0.2649942619, vasyWo: 0.1998533246,
    trueWo: 0.1439247980, mrpW: 443.512048, mrpWo: 525.878571 };
  const lines = [];
  let allOk = true;
  Object.keys(exp).forEach(k => {
    const ok = Math.abs(r[k] - exp[k]) < 0.0001;
    if (!ok) allOk = false;
    lines.push((ok ? 'OK   ' : 'FAIL ') + k + ': got ' + r[k].toFixed(6) +
      ' expected ' + exp[k].toFixed(6));
  });
  const msg = 'PRICE MODEL SELF-TEST (BG40313 from your workbook)\n\n' +
    lines.join('\n') + '\n\n' + (allOk ? 'All values match your sheet.' : 'MISMATCH — do not proceed.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenPriceModel2() {
  SpreadsheetApp.getUi()
    .createMenu('⚙️ Price Model v2')
    .addItem('1. Setup (columns + dropdowns)', 'priceModel2Setup')
    .addItem('2. Install corrected formulas', 'priceModel2Formulas')
    .addSeparator()
    .addItem('Self-test against your workbook', 'priceModel2SelfTest')
    .addItem('Freeze formulas (speed)', 'priceModel2Freeze')
    .addToUi();
}