/**********************************************************************
 * VITHYA TRADERS — VERIFIED PRICING
 *
 * Globals declared here (check before pasting):
 *   VPR, VPR_COLS, VPR_TRUST, VPR_COST_MODES, VPR_SELL_MODES, VPR_CHARGE_TYPES,
 *   setupVerifiedPricing, buildVerifiedRows, exportWorkableFile,
 *   vprNum_, vprRead_, vprSheet_, vprCol_, vprA1_, onOpenVerified
 *
 * ── WHAT THIS IS ──
 *   Pricing holds what VASY says. This holds what YOU stand behind.
 *   They are never merged. The difference between them tells you where Vasy
 *   is wrong, where a supplier price genuinely moved, and where nobody has
 *   checked anything yet — three situations that look identical today.
 *
 * ── TRUST, PER FIELD ──
 *   verified   from a bill, you stand behind it
 *   guessed    an estimate that SHOULD be real — bulk transport split per
 *              unit. A to-do, not a lie.
 *   book       entered for accounting only — the WO cost when you only ever
 *              buy in W. It will never become real, and that is fine.
 *   unverified nobody has looked
 *   stale      verified over 6 months ago, or a new bill has since arrived
 *
 *   A product can be verified overall while its transport is guessed. That
 *   is the point — you know which parts you trust.
 *
 * ── LAYOUT: TWO ROWS PER PRODUCT ──
 *   One row for W, one for WO, attributes as columns, so a cross-lane
 *   comparison reads across a single line instead of hunting two screens.
 *
 * ── THE THREE ERP SOURCES, SHOWN SIDE BY SIDE ──
 *   erp_snapshot · erp_batch · erp_current are carried separately and never
 *   averaged. When they disagree, you need to see WHICH one is wrong.
 *
 * ── RUN ──
 *   setupVerifiedPricing()   create the tab (empty — nothing is seeded)
 *   buildVerifiedRows()      add a row pair for every product
 *   exportWorkableFile()     .xlsx with live formulas, for offline entry
 **********************************************************************/

const VPR = {
  SHEET: 'Verified_Pricing',
  PRICING: 'Pricing',
  CORE: 'Products_Core',
  SNAP: 'ERP_Snapshot',
  BATCH: 'Batch_Cost',
  CURRENT: 'Cost_Current',
  HDR_ROW: 2,          // row 1 carries the group bands
  DEFAULT_WH_W: 0.17,
  DEFAULT_WH_WO: 0.30,
};

const VPR_TRUST = ['verified', 'guessed', 'book', 'unverified', 'stale'];

const VPR_COST_MODES = ['manual', 'same_as_other_lane', 'other_lane_plus_pct',
  'other_lane_plus_amt', 'same_as_batch_rate', 'same_as_batch_landing', 'same_as_current_rate'];

const VPR_SELL_MODES = ['manual', 'target_margin', 'same_as_other_lane',
  'other_lane_plus_pct', 'other_lane_plus_amt', 'mrp_less_discount',
  'same_as_erp_selling'];

const VPR_CHARGE_TYPES = ['amount', 'pct_of_landing'];

/* column order. Groups are banded in row 1 for readability. */
const VPR_COLS = [
  /* identity */
  'item_code', 'lane', 'description', 'category', 'brand', 'gst_rate',
  /* the Vasy sources, never merged. RATE and LANDING are both shown because
     the gap between them is where transport got baked into cost — which is
     the whole reason this rebuild exists. */
  'erp_batch_rate', 'erp_batch_landing', 'erp_batch_date',
  'erp_current_rate', 'erp_current_landing',
  'erp_selling', 'erp_mrp',
  /* inputs — cost */
  'cost_value', 'cost_mode', 'cost_param', 'cost_trust', 'cost_source', 'cost_date',
  /* inputs — charges */
  'transport_value', 'transport_type', 'transport_trust',
  'packing_value', 'packing_type', 'packing_trust',
  /* inputs — selling */
  'selling_value', 'selling_mode', 'selling_param', 'selling_trust',
  /* inputs — discounts */
  'mrp_disc', 'wh_disc', 'rt_disc',
  /* computed */
  'cost_incGST', 'loaded_cost', 'true_margin', 'vasy_margin', 'mrp',
  'wh_price', 'wh_margin', 'rt_price', 'rt_margin', 'margin_per_1pct_disc',
  /* status */
  'row_trust', 'erp_drift_pct', 'notes',
];

const VPR_GROUPS = [
  /* the first band stops at column 2 so the frozen-column boundary does not
     cut through a merged cell — Sheets refuses that outright */
  ['Key', 1, 2], ['Product', 3, 4], ['What Vasy says — rate vs landing', 7, 7],
  ['Cost', 14, 6], ['Transport & packing', 20, 6], ['Selling', 26, 4],
  ['Discounts', 30, 3], ['Computed', 33, 10], ['Status', 43, 3],
];

function vprNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function vprCol_(name) { return VPR_COLS.indexOf(name) + 1; }
function vprA1_(name, row) {
  const c = vprCol_(name);
  if (c < 1) throw new Error('unknown column: ' + name);
  let s = '', n = c;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s + row;
}

function vprRead_(ss, name, key) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return null;
  let hRow = 1;
  for (let r = 1; r <= 8; r++) {
    const v = sh.getRange(r, 1, 1, Math.min(sh.getLastColumn(), 40)).getValues()[0];
    if (v.some(function (x) { return String(x).trim() === key; })) { hRow = r; break; }
  }
  const hdr = sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  const n = sh.getLastRow() - hRow;
  if (n < 1) return { H: H, rows: [] };
  return { sh: sh, H: H,
    rows: sh.getRange(hRow + 1, 1, n, sh.getLastColumn()).getValues() };
}

/* ================= 1. the tab ================= */

function vprSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(VPR.SHEET);
  if (!sh) sh = ss.insertSheet(VPR.SHEET);
  return sh;
}

/* A new sheet is 1000 x 26. This schema needs 43 columns and ~14,000 rows,
   and clear() does not resize — writing past the edge throws
   "coordinates of the range are outside the dimensions of the sheet". */
function vprEnsure_(sh, rows, cols) {
  const haveC = sh.getMaxColumns();
  if (cols > haveC) sh.insertColumnsAfter(haveC, cols - haveC);
  const haveR = sh.getMaxRows();
  if (rows > haveR) sh.insertRowsAfter(haveR, rows - haveR);
}

function setupVerifiedPricing() {
  const sh = vprSheet_();
  sh.clear();
  sh.clearConditionalFormatRules();
  vprEnsure_(sh, VPR.HDR_ROW + 10, VPR_COLS.length);

  /* group band */
  VPR_GROUPS.forEach(function (g) {
    const r = sh.getRange(1, g[1], 1, g[2]);
    r.merge().setValue(g[0]).setHorizontalAlignment('center')
      .setFontWeight('bold').setFontSize(10);
  });
  sh.getRange(1, 1, 1, 6).setBackground('#F2F1EE').setFontColor('#4A4A42');
  sh.getRange(1, 1, 1, 2).setBackground('#E2E0DA');
  sh.getRange(1, 7, 1, 7).setBackground('#E9F0F9').setFontColor('#1D5FA8');
  sh.getRange(1, 14, 1, 19).setBackground('#FFFFFF').setFontColor('#A72410');
  sh.getRange(1, 33, 1, 13).setBackground('#F2F1EE').setFontColor('#6C6C60');

  sh.getRange(VPR.HDR_ROW, 1, 1, VPR_COLS.length).setValues([VPR_COLS])
    .setFontWeight('bold').setBackground('#CC3018').setFontColor('#FFFFFF')
    .setWrap(true).setVerticalAlignment('bottom');
  sh.setFrozenRows(VPR.HDR_ROW);
  sh.setFrozenColumns(2);
  sh.setColumnWidth(1, 110);
  sh.setColumnWidth(3, 250);

  const msg = 'VERIFIED_PRICING CREATED\n\n' +
    VPR_COLS.length + ' columns, two rows per product (W and WO).\n\n' +
    'It is EMPTY on purpose. Nothing is seeded from the purchase register,\n' +
    'because those rates are wrong and seeding them would import the problem\n' +
    'with a "verified" label attached.\n\n' +
    'Next: buildVerifiedRows()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= 2. the row pairs ================= */

function buildVerifiedRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = vprSheet_();
  if (sh.getLastRow() < VPR.HDR_ROW) throw new Error('Run setupVerifiedPricing() first.');

  const core = vprRead_(ss, VPR.CORE, 'product_id');
  if (!core) throw new Error('Products_Core is empty.');
  const pricing = vprRead_(ss, VPR.PRICING, 'product_id');

  /* the three ERP sources, kept apart */
  const snap = {}, batch = {}, cur = {};
  const s = vprRead_(ss, VPR.SNAP, 'itemCode');
  if (s) s.rows.forEach(function (r) {
    const c = String(r[s.H.itemCode] || '').trim();
    /* ERP_Snapshot holds no cost — only price and mrp. Cost comes from
       Batch_Cost and Cost_Current. */
    if (c) snap[c] = { sell: vprNum_(r[s.H.sellingPrice]), mrp: vprNum_(r[s.H.mrp]) };
  });
  const b = vprRead_(ss, VPR.BATCH, 'canonical_code');
  if (b) b.rows.forEach(function (r) {
    const c = String(r[b.H.canonical_code] || '').trim();
    if (!c) return;
    batch[c] = {
      wRate: vprNum_(r[b.H.w_last_rate]), wLand: vprNum_(r[b.H.w_last_landing]),
      wDate: r[b.H.w_last_date] || '',
      woRate: vprNum_(r[b.H.wo_last_rate]), woLand: vprNum_(r[b.H.wo_last_landing]),
      woDate: r[b.H.wo_last_date] || '',
    };
  });
  const cc = vprRead_(ss, VPR.CURRENT, 'itemCode');
  if (cc) cc.rows.forEach(function (r) {
    const c = String(r[cc.H.itemCode] || '').trim();
    if (c) cur[c] = { rate: vprNum_(r[cc.H.purchasePrice]),
      land: vprNum_(r[cc.H.landingCost]) };
  });

  const pr = {};
  if (pricing) pricing.rows.forEach(function (r) {
    const c = String(r[pricing.H.item_code] || '').trim();
    if (c) pr[c] = { gst: vprNum_(r[pricing.H.gst_rate]) };
  });

  const out = [];
  core.rows.forEach(function (r) {
    const canon = String(r[core.H.item_code] || '').trim();
    if (!canon) return;
    const desc = String(r[core.H.description] || '');
    const cat = r[core.H.category] || '';
    const brand = r[core.H.brand] || '';
    const gst = (pr[canon] && pr[canon].gst) || 18;
    const codeW = String(r[core.H.item_code_w] || '').trim();
    const codeWO = String(r[core.H.item_code_wo] || '').trim();

    [['W', codeW], ['WO', codeWO]].forEach(function (pair) {
      const lane = pair[0], code = pair[1];
      const sn = snap[code] || {};
      const bt = batch[canon] || {};
      const row = [];
      VPR_COLS.forEach(function () { row.push(''); });
      row[vprCol_('item_code') - 1] = canon;
      row[vprCol_('lane') - 1] = lane;
      row[vprCol_('description') - 1] = desc;
      row[vprCol_('category') - 1] = cat;
      row[vprCol_('brand') - 1] = brand;
      row[vprCol_('gst_rate') - 1] = lane === 'W' ? gst : 0;
      const cu = (code && cur[code]) || {};
      row[vprCol_('erp_batch_rate') - 1] = (lane === 'W' ? bt.wRate : bt.woRate) || '';
      row[vprCol_('erp_batch_landing') - 1] = (lane === 'W' ? bt.wLand : bt.woLand) || '';
      row[vprCol_('erp_batch_date') - 1] = (lane === 'W' ? bt.wDate : bt.woDate) || '';
      row[vprCol_('erp_current_rate') - 1] = cu.rate || '';
      row[vprCol_('erp_current_landing') - 1] = cu.land || '';
      row[vprCol_('erp_selling') - 1] = sn.sell || '';
      row[vprCol_('erp_mrp') - 1] = sn.mrp || '';
      /* inputs start unverified and EMPTY — nothing is assumed */
      row[vprCol_('cost_mode') - 1] = 'manual';
      row[vprCol_('cost_trust') - 1] = 'unverified';
      row[vprCol_('transport_type') - 1] = 'amount';
      row[vprCol_('transport_trust') - 1] = 'unverified';
      row[vprCol_('packing_type') - 1] = 'amount';
      row[vprCol_('packing_trust') - 1] = 'unverified';
      row[vprCol_('selling_mode') - 1] = 'manual';
      row[vprCol_('selling_trust') - 1] = 'unverified';
      row[vprCol_('mrp_disc') - 1] = lane === 'W' ? VPR.DEFAULT_WH_W : VPR.DEFAULT_WH_WO;
      row[vprCol_('wh_disc') - 1] = lane === 'W' ? VPR.DEFAULT_WH_W : VPR.DEFAULT_WH_WO;
      row[vprCol_('rt_disc') - 1] = 0;
      row[vprCol_('row_trust') - 1] = 'unverified';
      out.push(row);
    });
  });

  const start = VPR.HDR_ROW + 1;
  vprEnsure_(sh, start + out.length + 20, VPR_COLS.length);
  if (sh.getLastRow() >= start) {
    sh.getRange(start, 1, sh.getLastRow() - VPR.HDR_ROW, VPR_COLS.length).clearContent();
  }
  const B = 2000;
  for (let i = 0; i < out.length; i += B) {
    const blk = out.slice(i, i + B);
    sh.getRange(start + i, 1, blk.length, VPR_COLS.length).setValues(blk);
  }
  vprFormulas_(sh, start, out.length);
  vprFormat_(sh, start, out.length);

  const msg = 'BUILT ' + out.length + ' rows (' + (out.length / 2) + ' products x 2 lanes)\n\n' +
    'Every input is EMPTY and every trust is "unverified".\n' +
    'The three Vasy sources are filled in for reference only.\n\n' +
    'Next: exportWorkableFile() to enter them offline.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return out.length;
}

/* ================= 3. the formulas ================= */

function vprFormulas_(sh, start, n) {
  if (!n) return;
  const F = function (name, body) {
    const a = vprA1_(name, start);
    sh.getRange(start, vprCol_(name), n, 1).setFormulaR1C1(body);
  };
  const c = function (name) { return 'RC[' + (vprCol_(name) - vprCol_('cost_incGST')) + ']'; };

  /* each formula is written relative to its own column, so R1C1 offsets are
     computed per target rather than hand-counted */
  function rel(from, to) { return 'RC[' + (vprCol_(to) - vprCol_(from)) + ']'; }

  sh.getRange(start, vprCol_('cost_incGST'), n, 1).setFormulaR1C1(
    '=IF(' + rel('cost_incGST', 'cost_value') + '="","",' +
    rel('cost_incGST', 'cost_value') + '*(1+' +
    rel('cost_incGST', 'gst_rate') + '/100))');

  sh.getRange(start, vprCol_('loaded_cost'), n, 1).setFormulaR1C1(
    '=IF(' + rel('loaded_cost', 'cost_value') + '="","",' +
    rel('loaded_cost', 'cost_incGST') + '+' +
    'IF(' + rel('loaded_cost', 'transport_type') + '="pct_of_landing",' +
      rel('loaded_cost', 'cost_incGST') + '*' + rel('loaded_cost', 'transport_value') + '/100,' +
      'N(' + rel('loaded_cost', 'transport_value') + '))+' +
    'IF(' + rel('loaded_cost', 'packing_type') + '="pct_of_landing",' +
      rel('loaded_cost', 'cost_incGST') + '*' + rel('loaded_cost', 'packing_value') + '/100,' +
      'N(' + rel('loaded_cost', 'packing_value') + ')))');

  sh.getRange(start, vprCol_('true_margin'), n, 1).setFormulaR1C1(
    '=IF(OR(' + rel('true_margin', 'loaded_cost') + '="",' +
    rel('true_margin', 'loaded_cost') + '=0,' +
    rel('true_margin', 'selling_value') + '=""),"",' +
    '(' + rel('true_margin', 'selling_value') + '-' + rel('true_margin', 'loaded_cost') + ')/' +
    rel('true_margin', 'loaded_cost') + ')');

  sh.getRange(start, vprCol_('vasy_margin'), n, 1).setFormulaR1C1(
    '=IF(OR(' + rel('vasy_margin', 'cost_incGST') + '="",' +
    rel('vasy_margin', 'cost_incGST') + '=0,' +
    rel('vasy_margin', 'selling_value') + '=""),"",' +
    '(' + rel('vasy_margin', 'selling_value') + '-' + rel('vasy_margin', 'cost_incGST') + ')/' +
    rel('vasy_margin', 'cost_incGST') + ')');

  sh.getRange(start, vprCol_('mrp'), n, 1).setFormulaR1C1(
    '=IF(OR(' + rel('mrp', 'selling_value') + '="",' +
    rel('mrp', 'mrp_disc') + '>=1),"",' +
    rel('mrp', 'selling_value') + '/(1-' + rel('mrp', 'mrp_disc') + '))');

  sh.getRange(start, vprCol_('wh_price'), n, 1).setFormulaR1C1(
    '=IF(' + rel('wh_price', 'mrp') + '="","",' +
    rel('wh_price', 'mrp') + '*(1-' + rel('wh_price', 'wh_disc') + '))');

  sh.getRange(start, vprCol_('wh_margin'), n, 1).setFormulaR1C1(
    '=IF(OR(' + rel('wh_margin', 'wh_price') + '="",' +
    rel('wh_margin', 'loaded_cost') + '="",' + rel('wh_margin', 'loaded_cost') + '=0),"",' +
    '(' + rel('wh_margin', 'wh_price') + '-' + rel('wh_margin', 'loaded_cost') + ')/' +
    rel('wh_margin', 'loaded_cost') + ')');

  sh.getRange(start, vprCol_('rt_price'), n, 1).setFormulaR1C1(
    '=IF(' + rel('rt_price', 'mrp') + '="","",' +
    rel('rt_price', 'mrp') + '*(1-' + rel('rt_price', 'rt_disc') + '))');

  sh.getRange(start, vprCol_('rt_margin'), n, 1).setFormulaR1C1(
    '=IF(OR(' + rel('rt_margin', 'rt_price') + '="",' +
    rel('rt_margin', 'loaded_cost') + '="",' + rel('rt_margin', 'loaded_cost') + '=0),"",' +
    '(' + rel('rt_margin', 'rt_price') + '-' + rel('rt_margin', 'loaded_cost') + ')/' +
    rel('rt_margin', 'loaded_cost') + ')');

  /* what one more point of discount costs, in margin points.
     dPrice = MRP x 1%, so dMargin = MRP/100 / loaded_cost */
  sh.getRange(start, vprCol_('margin_per_1pct_disc'), n, 1).setFormulaR1C1(
    '=IF(OR(' + rel('margin_per_1pct_disc', 'mrp') + '="",' +
    rel('margin_per_1pct_disc', 'loaded_cost') + '="",' +
    rel('margin_per_1pct_disc', 'loaded_cost') + '=0),"",' +
    rel('margin_per_1pct_disc', 'mrp') + '/100/' +
    rel('margin_per_1pct_disc', 'loaded_cost') + ')');

  /* the row is only as trustworthy as its weakest input */
  sh.getRange(start, vprCol_('row_trust'), n, 1).setFormulaR1C1(
    '=IF(COUNTIF(RC[' + (vprCol_('cost_trust') - vprCol_('row_trust')) + ']:RC[' +
    (vprCol_('selling_trust') - vprCol_('row_trust')) + '],"unverified")>0,"unverified",' +
    'IF(COUNTIF(RC[' + (vprCol_('cost_trust') - vprCol_('row_trust')) + ']:RC[' +
    (vprCol_('selling_trust') - vprCol_('row_trust')) + '],"book")>0,"part book",' +
    'IF(COUNTIF(RC[' + (vprCol_('cost_trust') - vprCol_('row_trust')) + ']:RC[' +
    (vprCol_('selling_trust') - vprCol_('row_trust')) + '],"guessed")>0,"part guessed",' +
    'IF(COUNTIF(RC[' + (vprCol_('cost_trust') - vprCol_('row_trust')) + ']:RC[' +
    (vprCol_('selling_trust') - vprCol_('row_trust')) + '],"stale")>0,"stale","verified"))))');

  /* how far Vasy has drifted from your number */
  sh.getRange(start, vprCol_('erp_drift_pct'), n, 1).setFormulaR1C1(
    '=IF(OR(' + rel('erp_drift_pct', 'cost_value') + '="",' +
    rel('erp_drift_pct', 'cost_value') + '=0,' +
    rel('erp_drift_pct', 'erp_current_rate') + '=""),"",' +
    '(' + rel('erp_drift_pct', 'erp_current_rate') + '-' +
    rel('erp_drift_pct', 'cost_value') + ')/' + rel('erp_drift_pct', 'cost_value') + ')');
}

/* ================= 4. formatting and validation ================= */

function vprFormat_(sh, start, n) {
  if (!n) return;
  const dv = function (col, list) {
    sh.getRange(start, vprCol_(col), n, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(list, true)
        .setAllowInvalid(false).build());
  };
  dv('cost_mode', VPR_COST_MODES);
  dv('selling_mode', VPR_SELL_MODES);
  dv('transport_type', VPR_CHARGE_TYPES);
  dv('packing_type', VPR_CHARGE_TYPES);
  ['cost_trust', 'transport_trust', 'packing_trust', 'selling_trust']
    .forEach(function (c) { dv(c, VPR_TRUST); });

  /* white = you type here; grey = computed; blue = what Vasy says */
  sh.getRange(start, 7, n, 7).setBackground('#F4F8FD');
  sh.getRange(start, 14, n, 19).setBackground('#FFFFFF');
  sh.getRange(start, 33, n, 13).setBackground('#F7F6F3');

  sh.getRange(start, vprCol_('true_margin'), n, 1).setNumberFormat('0.0%');
  sh.getRange(start, vprCol_('vasy_margin'), n, 1).setNumberFormat('0.0%');
  sh.getRange(start, vprCol_('wh_margin'), n, 1).setNumberFormat('0.0%');
  sh.getRange(start, vprCol_('rt_margin'), n, 1).setNumberFormat('0.0%');
  sh.getRange(start, vprCol_('erp_drift_pct'), n, 1).setNumberFormat('0.0%');
  sh.getRange(start, vprCol_('margin_per_1pct_disc'), n, 1).setNumberFormat('0.00%');
  ['mrp_disc', 'wh_disc', 'rt_disc'].forEach(function (c) {
    sh.getRange(start, vprCol_(c), n, 1).setNumberFormat('0%');
  });

  const rng = sh.getRange(start, 1, n, VPR_COLS.length);
  const rules = [];
  /* WO rows tinted, so the pair reads as a pair */
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(
    '=$' + vprA1_('lane', start).replace(/\d+$/, '') + start + '="WO"')
    .setBackground('#FDF9F8').setRanges([rng]).build());
  /* below floor */
  const tm = '$' + vprA1_('true_margin', start).replace(/\d+$/, '') + start;
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(
    '=AND(' + tm + '<>"",' + tm + '<0.12)')
    .setBackground('#FBEEEC').setFontColor('#B3372C')
    .setRanges([sh.getRange(start, vprCol_('true_margin'), n, 1)]).build());
  /* drift over 10% either way */
  const dr = '$' + vprA1_('erp_drift_pct', start).replace(/\d+$/, '') + start;
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(
    '=AND(' + dr + '<>"",ABS(' + dr + ')>0.1)')
    .setBackground('#FDF5E4').setFontColor('#A8730F')
    .setRanges([sh.getRange(start, vprCol_('erp_drift_pct'), n, 1)]).build());
  sh.setConditionalFormatRules(rules);
}

/* ================= 5. the offline file ================= */

/**
 * Copies Verified_Pricing into a standalone spreadsheet with formulas intact,
 * optionally filtered, and returns a link. Work in it offline, then upload.
 * filter is optional: {category:'BEARING'} or {trust:'unverified'}
 */
function exportWorkableFile(filter) {
  const src = vprSheet_();
  if (src.getLastRow() <= VPR.HDR_ROW) throw new Error('Nothing to export — run buildVerifiedRows().');

  const name = 'VT_Pricing_' + Utilities.formatDate(new Date(),
    Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  const dest = SpreadsheetApp.create(name);
  const copied = src.copyTo(dest);
  copied.setName('Pricing');
  const first = dest.getSheets()[0];
  if (first.getName() !== 'Pricing') dest.deleteSheet(first);

  /* filter by deleting rows, keeping W/WO pairs together */
  if (filter && (filter.category || filter.trust)) {
    const n = copied.getLastRow() - VPR.HDR_ROW;
    const v = copied.getRange(VPR.HDR_ROW + 1, 1, n, VPR_COLS.length).getValues();
    const drop = [];
    for (let i = 0; i < v.length; i += 2) {
      let keep = true;
      if (filter.category && String(v[i][vprCol_('category') - 1]) !== filter.category) keep = false;
      if (filter.trust) {
        const a = String(v[i][vprCol_('row_trust') - 1]);
        const b = i + 1 < v.length ? String(v[i + 1][vprCol_('row_trust') - 1]) : '';
        if (a !== filter.trust && b !== filter.trust) keep = false;
      }
      if (!keep) { drop.push(VPR.HDR_ROW + 1 + i); drop.push(VPR.HDR_ROW + 2 + i); }
    }
    drop.sort(function (a, b) { return b - a; });
    for (let i = 0; i < drop.length; i += 2) {
      copied.deleteRows(drop[i + 1] !== undefined ? drop[i + 1] : drop[i], 2);
    }
  }

  const rows = Math.max(0, copied.getLastRow() - VPR.HDR_ROW);
  const msg = 'WORKABLE FILE READY\n\n' + name + '\n' + dest.getUrl() +
    '\n\nrows: ' + rows + '  (' + Math.round(rows / 2) + ' products)\n\n' +
    'White cells are yours to type in. Grey cells are formulas — they\n' +
    'recompute as you type. Blue cells show what Vasy currently says.\n\n' +
    'File > Download > Microsoft Excel if you want it offline.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return dest.getUrl();
}

function exportUnverifiedOnly() { return exportWorkableFile({ trust: 'unverified' }); }

function onOpenVerified() {
  SpreadsheetApp.getUi()
    .createMenu('✅ Verified Pricing')
    .addItem('1. Create the tab', 'setupVerifiedPricing')
    .addItem('2. Build product rows', 'buildVerifiedRows')
    .addItem('3. Export workable file', 'exportWorkableFile')
    .addItem('   …unverified only', 'exportUnverifiedOnly')
    .addToUi();
}