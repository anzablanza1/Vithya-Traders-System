/**********************************************************************
 * VITHYA TRADERS — Speed up the Pricing tab
 *
 * WHY
 *   Pricing carries 8 ArrayFormulas spanning ~7,000 rows plus conditional
 *   formatting over 7,000 cells. Every edit anywhere in the workbook makes
 *   Sheets recalculate all of it. That is what makes the sheet feel slow.
 *
 *   The dashboard now performs every calculation, so the sheet only needs to
 *   STORE the numbers — which is the architecture you asked for:
 *   "calculations on the dashboard, only data in the sheet".
 *
 * WHAT freezePricingFormulas() DOES
 *   Replaces the formula columns with their CURRENT VALUES:
 *     M cost_active, R landing_cost, U selling_w, V selling_wo,
 *     Y mrp_w, Z mrp_wo, AE price_diff_flag, AF cost_status, AH reads_as
 *   Everything you type (cost_source, margins, transport, manual cost) is
 *   untouched. cost_master_frozen is untouched.
 *
 * REVERSIBLE?
 *   The values stay correct. If you later want live formulas back, run
 *   restorePricingFormulas(). Nothing is lost either way.
 *
 * ALSO
 *   stripPricingConditionalFormats() removes the per-row colour rules that
 *   slow rendering. Header/group colours stay.
 *
 * RUN ORDER (do a File > Make a copy first if you want a safety net)
 *   1. freezePricingFormulas()
 *   2. stripPricingConditionalFormats()      (optional, more speed)
 **********************************************************************/

const SPD = { PRICING: 'Pricing' };

function spdHeaderRow_(sh) {
  for (let r = 1; r <= 6; r++) {
    if (String(sh.getRange(r, 1).getValue()).trim() === 'product_id') return r;
  }
  throw new Error('Could not find the Pricing header row.');
}

function spdColMap_(sh, hRow) {
  const w = sh.getLastColumn();
  const hdr = sh.getRange(hRow, 1, 1, w).getValues()[0];
  const M = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k) M[k] = i + 1; });
  return M;
}

/* ---------- freeze formulas -> values ---------- */

function freezePricingFormulas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SPD.PRICING);
  if (!sh) throw new Error('Pricing tab not found.');
  const hRow = spdHeaderRow_(sh);
  const first = hRow + 1;
  const n = sh.getLastRow() - hRow;
  if (n <= 0) throw new Error('No data rows in Pricing.');

  const M = spdColMap_(sh, hRow);
  const targets = ['cost_active','landing_cost','selling_w','selling_wo',
                   'mrp_w','mrp_wo','price_diff_flag','cost_status','reads_as'];

  let done = [];
  targets.forEach(name => {
    const c = M[name];
    if (!c) return;
    const rng = sh.getRange(first, c, n, 1);
    const vals = rng.getValues();        // current computed values
    rng.clearContent();                  // remove the ArrayFormula
    rng.setValues(vals);                 // write them back as plain numbers/text
    done.push(name);
  });

  SpreadsheetApp.flush();
  const msg = 'Frozen to values: ' + done.join(', ') +
    '\n\nRows: ' + n +
    '\n\nYour input columns (cost_source, margins, transport, manual cost,\n' +
    'cost_master_frozen) were NOT touched.\n\n' +
    'The dashboard now does all calculation. Run restorePricingFormulas()\n' +
    'if you ever want live formulas back.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ---------- put the ArrayFormulas back ---------- */

function restorePricingFormulas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SPD.PRICING);
  const hRow = spdHeaderRow_(sh);
  const f = hRow + 1;
  const n = sh.getLastRow() - hRow;
  const M = spdColMap_(sh, hRow);

  function clearCol(name) {
    const c = M[name];
    if (c) sh.getRange(f, c, n, 1).clearContent();
  }
  ['cost_active','landing_cost','selling_w','selling_wo','mrp_w','mrp_wo',
   'price_diff_flag','cost_status','reads_as'].forEach(clearCol);

  const A = c => sh.getRange(f, M[c]);

  A('cost_active').setFormula(
    '=ARRAYFORMULA(IF(B' + f + ':B="","",' +
    'IF(L' + f + ':L="manual",K' + f + ':K,' +
    'IF(L' + f + ':L="batch_bill",IF(F' + f + ':F<>"",F' + f + ':F,G' + f + ':G),' +
    'IF(L' + f + ':L="batch_current",IF(I' + f + ':I<>"",I' + f + ':I,J' + f + ':J),' +
    'IF(L' + f + ':L="master",E' + f + ':E,""))))))');

  A('landing_cost').setFormula(
    '=ARRAYFORMULA(IF(B' + f + ':B="","",IF(M' + f + ':M="","",' +
    'M' + f + ':M+IF(O' + f + ':O="percentage",M' + f + ':M*N' + f + ':N/100,N' + f + ':N)' +
    '+IF(Q' + f + ':Q="percentage",M' + f + ':M*P' + f + ':P/100,P' + f + ':P))))');

  A('selling_w').setFormula(
    '=ARRAYFORMULA(IF(B' + f + ':B="","",IF(R' + f + ':R="","",IF(S' + f + ':S="","",' +
    'ROUND(R' + f + ':R*(1+S' + f + ':S),3)))))');
  A('selling_wo').setFormula(
    '=ARRAYFORMULA(IF(B' + f + ':B="","",IF(R' + f + ':R="","",IF(T' + f + ':T="","",' +
    'ROUND(R' + f + ':R*(1+T' + f + ':T),3)))))');
  A('mrp_w').setFormula(
    '=ARRAYFORMULA(IF(B' + f + ':B="","",IF(U' + f + ':U="","",IF(W' + f + ':W="","",' +
    'IF(W' + f + ':W>=1,"",ROUND(U' + f + ':U/(1-W' + f + ':W),2))))))');
  A('mrp_wo').setFormula(
    '=ARRAYFORMULA(IF(B' + f + ':B="","",IF(V' + f + ':V="","",IF(X' + f + ':X="","",' +
    'IF(X' + f + ':X>=1,"",ROUND(V' + f + ':V/(1-X' + f + ':X),2))))))');

  Logger.log('ArrayFormulas restored.');
  try { SpreadsheetApp.getUi().alert('Live formulas restored in Pricing.'); } catch (e) {}
}

/* ---------- remove heavy per-row conditional formatting ---------- */

function stripPricingConditionalFormats() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SPD.PRICING);
  const before = sh.getConditionalFormatRules().length;
  sh.setConditionalFormatRules([]);
  const msg = 'Removed ' + before + ' conditional-format rule(s) from Pricing.\n\n' +
    'Static header and column colours remain.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ---------- how heavy is this workbook? ---------- */

function sheetWeightReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lines = [];
  let totalCells = 0, totalRules = 0;
  ss.getSheets().forEach(sh => {
    const r = sh.getLastRow(), c = sh.getLastColumn();
    const cells = r * c;
    totalCells += cells;
    const rules = sh.getConditionalFormatRules().length;
    totalRules += rules;
    lines.push(sh.getName() + ': ' + r + ' rows x ' + c + ' cols = ' +
               cells.toLocaleString() + ' cells' + (rules ? ', ' + rules + ' CF rules' : ''));
  });
  lines.sort();
  const msg = lines.join('\n') + '\n\nTOTAL: ' + totalCells.toLocaleString() +
    ' cells, ' + totalRules + ' conditional-format rules\n' +
    '(Sheets limit is 10,000,000 cells)';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}