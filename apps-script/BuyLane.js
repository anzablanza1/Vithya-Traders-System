/**********************************************************************
 * VITHYA TRADERS — BUY LANE
 *
 * THE GAP THIS CLOSES
 *   Some products are bought ONLY on GST bills but sold through both lanes.
 *   Others are bought only non-GST and sold through both. Until now the WO
 *   margin was always measured against a WO cost — which, for a W-only
 *   purchase, is a cost that never existed. The margin was fiction.
 *
 * WHAT IT ADDS
 *   buy_lane        W | WO | BOTH   (dropdown, default BOTH)
 *   eff_cost_w      the cost basis a W sale is actually measured against
 *   eff_cost_wo     the cost basis a WO sale is actually measured against
 *
 *   buy_lane = W     → BOTH sales measured against loaded_cost_w
 *   buy_lane = WO    → BOTH sales measured against loaded_cost_wo
 *   buy_lane = BOTH  → each lane against its own loaded cost (as before)
 *
 *   true_margin_w  = selling_w_incGST / eff_cost_w  − 1
 *   true_margin_wo = selling_wo       / eff_cost_wo − 1
 *
 * SEEDING
 *   buy_lane is guessed once from purchase history in Batch_Cost:
 *     bought in both lanes  → BOTH
 *     only W rates seen     → W
 *     only WO rates seen    → WO
 *     no history            → BOTH
 *   Guessed values are yours to correct; re-running never overwrites a value
 *   you have set by hand (it only fills blanks) unless you pass force=true.
 *
 * RUN
 *   1. buyLaneSetup()        add column + dropdown + seed from history
 *   2. buyLaneFormulas()     rewire the margin formulas
 *   3. buildDashboardData()
 **********************************************************************/

const BL = {
  PRICING: 'Pricing',
  BATCH: 'Batch_Cost',
  FLOOR: 0.12,
};

function blHeaderRow_(sh) {
  for (let r = 1; r <= 6; r++)
    if (String(sh.getRange(r, 1).getValue()).trim() === 'product_id') return r;
  throw new Error('Pricing header row not found.');
}
function blMap_(sh, hRow) {
  const hdr = sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0];
  const M = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k) M[k] = i + 1; });
  return M;
}
function blA1_(c) {
  let s = '', n = c;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - m) / 26); }
  return s;
}
function blNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }

/* ---------- 1. setup ---------- */

function buyLaneSetup(force) {
  const t0 = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(BL.PRICING);
  if (!sh) throw new Error('Pricing tab not found.');
  const hRow = blHeaderRow_(sh);
  let M = blMap_(sh, hRow);

  ['buy_lane', 'eff_cost_w', 'eff_cost_wo'].forEach(nm => {
    if (M[nm]) return;
    const c = sh.getLastColumn() + 1;
    sh.getRange(hRow, c).setValue(nm).setFontWeight('bold')
      .setBackground('#1F3864').setFontColor('#FFFFFF').setWrap(true);
    SpreadsheetApp.flush();
    M = blMap_(sh, hRow);
  });

  const first = hRow + 1;
  const n = sh.getLastRow() - hRow;
  if (n <= 0) throw new Error('Pricing has no data rows.');

  /* what does purchase history say? */
  const hist = {};
  const bs = ss.getSheetByName(BL.BATCH);
  if (bs && bs.getLastRow() > 1) {
    const v = bs.getDataRange().getValues();
    const H = {}; v[0].forEach((h, i) => H[String(h).trim()] = i);
    for (let i = 1; i < v.length; i++) {
      const c = String(v[i][H.canonical_code] || '').trim();
      if (!c) continue;
      const w = blNum_(v[i][H.w_last_rate]);
      const wo = blNum_(v[i][H.wo_last_rate]);
      const hasW = w !== '' && w > 0, hasWO = wo !== '' && wo > 0;
      hist[c] = (hasW && hasWO) ? 'BOTH' : (hasW ? 'W' : (hasWO ? 'WO' : ''));
    }
  }

  const codes = sh.getRange(first, M.item_code, n, 1).getValues();
  const cur = sh.getRange(first, M.buy_lane, n, 1).getValues();
  const out = [];
  const tally = { W: 0, WO: 0, BOTH: 0, kept: 0 };
  codes.forEach((r, i) => {
    const existing = String(cur[i][0] || '').trim();
    if (existing && !force) { out.push([existing]); tally.kept++; return; }
    const g = hist[String(r[0] || '').trim()] || 'BOTH';
    out.push([g]); tally[g] = (tally[g] || 0) + 1;
  });
  sh.getRange(first, M.buy_lane, n, 1).setValues(out);

  const rng = sh.getRange(first, M.buy_lane, n, 1);
  rng.clearDataValidations();
  rng.setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['W', 'WO', 'BOTH'], true).setAllowInvalid(false).build());

  /* colour so the exceptions stand out */
  const keep = sh.getConditionalFormatRules().filter(r => {
    const rr = r.getRanges();
    return !(rr.length === 1 && rr[0].getColumn() === M.buy_lane);
  });
  const mk = (t, bg, fc) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(t).setBackground(bg).setFontColor(fc).setBold(true)
    .setRanges([rng]).build();
  keep.push(mk('W', '#EAF1F9', '#1D5FA8'));
  keep.push(mk('WO', '#FBEEEC', '#B3372C'));
  keep.push(mk('BOTH', '#EEF3F5', '#3D5563'));
  sh.setConditionalFormatRules(keep);

  const msg = 'BUY LANE ADDED (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'Seeded from purchase history:\n' +
    '   bought W only   : ' + tally.W + '\n' +
    '   bought WO only  : ' + tally.WO + '\n' +
    '   bought both     : ' + tally.BOTH + '\n' +
    (tally.kept ? '   left as you set: ' + tally.kept + '\n' : '') +
    '\nThese are guesses from what was actually purchased. Correct any that\n' +
    'are wrong — re-running will not overwrite your edits.\n\n' +
    'NEXT: buyLaneFormulas()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function buyLaneReseed() { buyLaneSetup(true); }

/* ---------- 2. formulas ---------- */

function buyLaneFormulas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(BL.PRICING);
  const hRow = blHeaderRow_(sh);
  const M = blMap_(sh, hRow);
  const f = hRow + 1;
  const n = sh.getLastRow() - hRow;

  const need = ['item_code', 'buy_lane', 'eff_cost_w', 'eff_cost_wo',
    'loaded_cost_w', 'loaded_cost_wo', 'selling_w_incGST', 'selling_wo',
    'true_margin_w', 'true_margin_wo', 'margin_flag'];
  const miss = need.filter(k => !M[k]);
  if (miss.length) throw new Error('Missing columns: ' + miss.join(', ') +
    '\nRun buyLaneSetup() and priceModel2Setup() first.');

  const C = {}; need.forEach(k => C[k] = blA1_(M[k]));
  const R = r => r + f + ':' + r;
  const key = R(C.item_code);
  const put = (k, fo) => sh.getRange(f, M[k]).setFormula(fo);

  ['eff_cost_w', 'eff_cost_wo', 'true_margin_w', 'true_margin_wo', 'margin_flag']
    .forEach(k => sh.getRange(f, M[k], n, 1).clearContent());

  /* the cost basis each sale is really measured against */
  put('eff_cost_w',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF(' + R(C.buy_lane) + '="WO",' + R(C.loaded_cost_wo) + ',' + R(C.loaded_cost_w) + ')))');
  put('eff_cost_wo',
    '=ARRAYFORMULA(IF(' + key + '="","",' +
    'IF(' + R(C.buy_lane) + '="W",' + R(C.loaded_cost_w) + ',' + R(C.loaded_cost_wo) + ')))');

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
    'IF(' + lo + '<0,"LOSS",IF(' + lo + '<' + BL.FLOOR + ',"BELOW 12%","")))))');

  ['eff_cost_w', 'eff_cost_wo'].forEach(k =>
    sh.getRange(f, M[k], n, 1).setNumberFormat('#,##0.00').setBackground('#E2F0D9'));

  SpreadsheetApp.flush();
  Utilities.sleep(1200);

  const probe = k => sh.getRange(f, M[k], Math.min(n, 400), 1).getValues()
    .filter(r => r[0] !== '' && r[0] !== null).length;
  const msg = 'BUY-LANE FORMULAS INSTALLED\n\n' +
    'First ' + Math.min(n, 400) + ' rows:\n' +
    '   eff_cost_w    : ' + probe('eff_cost_w') + '\n' +
    '   eff_cost_wo   : ' + probe('eff_cost_wo') + '\n' +
    '   true_margin_w : ' + probe('true_margin_w') + '\n\n' +
    'Margins are now measured against the lane the goods were actually bought in.\n\n' +
    'NEXT: buildDashboardData()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenBuyLane() {
  SpreadsheetApp.getUi()
    .createMenu('🔀 Buy Lane')
    .addItem('1. Add + seed buy_lane', 'buyLaneSetup')
    .addItem('2. Install formulas', 'buyLaneFormulas')
    .addSeparator()
    .addItem('Re-seed from history (overwrites)', 'buyLaneReseed')
    .addToUi();
}