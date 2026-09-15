/**********************************************************************
 * VITHYA TRADERS — BUY LANE FIX
 *
 * ─────────────── THE BUG ───────────────
 *   buyLaneFormulas() made eff_cost_w follow buy_lane unconditionally:
 *        buy_lane = "WO"  ->  a W sale was measured against the WO cost
 *
 *   Checked against your data: 1,444 products had their W margin overridden,
 *   and in ALL 1,444 cases BOTH lane costs exist. So the override was never
 *   justified — it replaced a real W cost with a WO cost.
 *
 *   Worked example, BG40313 (V4 3 SEG BEARING 01-4313):
 *        cost_w_incGST  260.00      selling_w_incGST 368.155
 *        correct W margin = 368.155/260.00 - 1 = 41.60%   <- your workbook
 *        buy_lane was seeded "WO", so eff_cost_w became 306.80
 *        and the sheet showed 19.998%  — the WO margin, mislabelled.
 *
 *   Root cause: buy_lane was seeded from Batch_Cost (purchase register),
 *   but the costs actually in use come from cost_source (batch_current /
 *   frozen), which carries BOTH lanes. The two never agreed.
 *
 * ─────────────── THE FIX ───────────────
 *   eff_cost is the lane's OWN loaded cost, and falls back to the other lane
 *   ONLY when the lane's own cost is genuinely missing:
 *
 *      eff_cost_w  = loaded_cost_w   if present, else loaded_cost_wo
 *      eff_cost_wo = loaded_cost_wo  if present, else loaded_cost_w
 *
 *   buy_lane is kept as an INFORMATIONAL field (where you actually buy) and
 *   is re-seeded to BOTH wherever both costs exist, so it stops misleading.
 *   It no longer silently rewrites a margin.
 *
 * ─────────────── EFFECT ───────────────
 *   true_margin_w returns to meaning "margin on the W cost".
 *   Flag counts move from BELOW 12% 2,061 / LOSS 63
 *                     to BELOW 12% 2,392 / LOSS 67
 *   The increase is real: the override had been flattering ~1,400 products.
 *
 * RUN
 *   1. buyLaneFix()            corrects formulas + re-seeds buy_lane
 *   2. buildDashboardData()    (with the patched DataBuilder — see note below)
 *
 * NOTE Dash_Data currently has 54 columns and is MISSING buy_lane,
 *      eff_cost_w and eff_cost_wo. Paste the latest DataBuilder_v2.gs
 *      before rebuilding, or those stay blank in the dashboard.
 **********************************************************************/

const BLF = { PRICING: 'Pricing', FLOOR: 0.12 };

function blfHeaderRow_(sh) {
  for (let r = 1; r <= 8; r++)
    if (String(sh.getRange(r, 1).getValue()).trim() === 'product_id') return r;
  throw new Error('Pricing header row not found.');
}
function blfMap_(sh, hRow) {
  const hdr = sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0];
  const M = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k) M[k] = i + 1; });
  return M;
}
function blfA1_(c) {
  let s = '', n = c;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); }
  return s;
}
function blfNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }

function buyLaneFix() {
  const t0 = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(BLF.PRICING);
  if (!sh) throw new Error('Pricing tab not found.');
  const hRow = blfHeaderRow_(sh);
  const M = blfMap_(sh, hRow);
  const f = hRow + 1;
  const n = sh.getLastRow() - hRow;

  const need = ['item_code', 'buy_lane', 'eff_cost_w', 'eff_cost_wo',
    'loaded_cost_w', 'loaded_cost_wo', 'selling_w_incGST', 'selling_wo',
    'true_margin_w', 'true_margin_wo', 'margin_flag'];
  const miss = need.filter(k => !M[k]);
  if (miss.length) throw new Error('Missing columns: ' + miss.join(', '));

  const C = {}; need.forEach(k => C[k] = blfA1_(M[k]));
  const R = r => r + f + ':' + r;
  const key = R(C.item_code);
  const put = (k, fo) => sh.getRange(f, M[k]).setFormula(fo);

  ['eff_cost_w', 'eff_cost_wo', 'true_margin_w', 'true_margin_wo', 'margin_flag']
    .forEach(k => sh.getRange(f, M[k], n, 1).clearContent());

  /* own lane first; fall back only when the lane's own cost is missing */
  put('eff_cost_w',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF(' + R(C.loaded_cost_w) + '<>"",' + R(C.loaded_cost_w) + ',' + R(C.loaded_cost_wo) + ')))');
  put('eff_cost_wo',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF(' + R(C.loaded_cost_wo) + '<>"",' + R(C.loaded_cost_wo) + ',' + R(C.loaded_cost_w) + ')))');

  const marg = (sell, cost) =>
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF((' + R(cost) + '="")+(' + R(cost) + '=0)+(' + R(sell) + '="")>0,"",' +
    R(sell) + '/' + R(cost) + '-1)))';
  put('true_margin_w', marg(C.selling_w_incGST, C.eff_cost_w));
  put('true_margin_wo', marg(C.selling_wo, C.eff_cost_wo));

  const tw = R(C.true_margin_w), two = R(C.true_margin_wo);
  const a = 'IF(' + tw + '="",99,' + tw + ')', b = 'IF(' + two + '="",99,' + two + ')';
  const lo = 'IF(' + a + '<' + b + ',' + a + ',' + b + ')';
  put('margin_flag',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF((' + tw + '="")*(' + two + '="")=1,"NO COST",' +
    'IF(' + lo + '<0,"LOSS",IF(' + lo + '<' + BLF.FLOOR + ',"BELOW 12%","")))))');

  SpreadsheetApp.flush();
  Utilities.sleep(2500);

  /* re-seed buy_lane from the costs actually in use, so it stops misleading */
  const lw = sh.getRange(f, M.loaded_cost_w, n, 1).getValues();
  const lwo = sh.getRange(f, M.loaded_cost_wo, n, 1).getValues();
  const bl = [];
  const tally = { W: 0, WO: 0, BOTH: 0 };
  for (let i = 0; i < n; i++) {
    const hasW = blfNum_(lw[i][0]) !== '' && blfNum_(lw[i][0]) > 0;
    const hasWO = blfNum_(lwo[i][0]) !== '' && blfNum_(lwo[i][0]) > 0;
    const v = (hasW && hasWO) ? 'BOTH' : (hasW ? 'W' : (hasWO ? 'WO' : 'BOTH'));
    bl.push([v]); tally[v]++;
  }
  sh.getRange(f, M.buy_lane, n, 1).setValues(bl);

  /* verification on the sample product */
  let sample = '';
  const codes = sh.getRange(f, M.item_code, n, 1).getValues();
  for (let i = 0; i < n; i++) {
    if (String(codes[i][0]).trim() === 'BG40313') {
      const row = f + i;
      const g = k => sh.getRange(row, M[k]).getValue();
      sample = '\nBG40313 check:\n' +
        '   loaded_cost_w  ' + g('loaded_cost_w') + '\n' +
        '   eff_cost_w     ' + g('eff_cost_w') + '\n' +
        '   selling_w      ' + g('selling_w_incGST') + '\n' +
        '   true_margin_w  ' + (Number(g('true_margin_w')) * 100).toFixed(2) + '%' +
        '   (should be ~41.6%)\n';
      break;
    }
  }

  const msg = 'BUY LANE FIXED (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'eff_cost now uses each lane\'s OWN cost, falling back only when that\n' +
    'lane has no cost at all.\n\n' +
    'buy_lane re-seeded from the costs actually in use:\n' +
    '   BOTH: ' + tally.BOTH + '\n   W: ' + tally.W + '\n   WO: ' + tally.WO +
    sample +
    '\nExpect more BELOW 12% flags than before — the override had been\n' +
    'flattering about 1,400 products.\n\n' +
    'NEXT: paste the latest DataBuilder_v2.gs, then buildDashboardData()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* quick health check you can run any time */
function pricingHealthCheck() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BLF.PRICING);
  const hRow = blfHeaderRow_(sh);
  const M = blfMap_(sh, hRow);
  const f = hRow + 1, n = sh.getLastRow() - hRow;
  const cols = ['cost_w_exGST', 'cost_w_incGST', 'loaded_cost_w', 'eff_cost_w',
    'selling_w_incGST', 'true_margin_w', 'vasy_margin_w', 'mrp_w',
    'cost_wo', 'loaded_cost_wo', 'selling_wo', 'true_margin_wo', 'mrp_wo'];
  const lines = [];
  cols.forEach(k => {
    if (!M[k]) { lines.push('   ' + k + ': COLUMN MISSING'); return; }
    const v = sh.getRange(f, M[k], n, 1).getValues();
    const filled = v.filter(r => r[0] !== '' && r[0] !== null).length;
    lines.push('   ' + k + ': ' + filled + ' / ' + n +
      ' (' + (filled / n * 100).toFixed(1) + '%)');
  });
  const msg = 'PRICING HEALTH\n\nRows: ' + n + '\n\n' + lines.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenBuyLaneFix() {
  SpreadsheetApp.getUi()
    .createMenu('🩺 Fix')
    .addItem('Fix buy lane / eff cost', 'buyLaneFix')
    .addItem('Pricing health check', 'pricingHealthCheck')
    .addToUi();
}