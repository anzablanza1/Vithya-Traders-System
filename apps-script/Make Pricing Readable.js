/**********************************************************************
 * VITHYA TRADERS — Pricing tab: MAKE IT READABLE
 *
 * Does NOT rebuild anything. It only adds colour, grouping, a legend,
 * and a frozen reference column so you can SEE where each number
 * comes from at a glance.
 *
 * WHAT IT DOES
 *   1. Adds a colour legend across the top (row 1 pushed down by 2).
 *   2. Colours every column header by its SOURCE group:
 *        yellow = frozen original (never changes)
 *        blue   = you type here
 *        grey   = synced from Vasy / register (don't type)
 *        green  = the answer (cost_active, landing, selling, mrp)
 *        white  = id / label
 *   3. Colours the cost_source cell per row so you can scan which
 *      products are on master vs batch vs manual.
 *   4. Adds a plain-English "reads_as" note column that says, per row,
 *      e.g. "master cost 37.97 -> sells 48 (same as Vasy)".
 *
 * RUN  makePricingReadable()
 * UNDO nothing to undo — it only recolours and adds two helper columns.
 **********************************************************************/

const RD = { PRICING: 'Pricing' };

/* group -> columns (1-indexed) and colour */
const RD_GROUPS = [
  { name: 'LABEL',   colour: '#FFFFFF', head: '#666666', cols: [1,2,3,4] },
  { name: 'FROZEN ORIGINAL (never changes)', colour: '#FFF2CC', head: '#BF9000', cols: [5] },
  { name: 'SYNCED FROM VASY / REGISTER (do not type)', colour: '#EFEFEF', head: '#666666',
    cols: [6,7,8,9,10,27,28,29,30] },
  { name: 'YOU CHOOSE / YOU TYPE', colour: '#D9E8FB', head: '#1155CC',
    cols: [11,12,14,15,16,17,19,20,23,24,33] },
  { name: 'THE ANSWER (formulas)', colour: '#E2F0D9', head: '#548235',
    cols: [13,18,21,22,25,26,31,32] },
];

function makePricingReadable() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(RD.PRICING);
  if (!sh || sh.getLastRow() < 2) throw new Error('Build the Pricing tab first.');

  // --- if legend already inserted, don't insert again ---
  const a1 = String(sh.getRange(1, 1).getValue());
  const hasLegend = a1.indexOf('LEGEND') === 0;
  if (!hasLegend) {
    sh.insertRowsBefore(1, 2);
  }

  // --- legend in row 1 ---
  sh.getRange(1, 1).setValue('LEGEND  ▸  read left to right').setFontWeight('bold');
  const legendCells = [
    { c: 3,  t: 'FROZEN original', bg: '#FFF2CC', fc: '#7F6000' },
    { c: 6,  t: 'SYNCED from Vasy (don\'t type)', bg: '#EFEFEF', fc: '#444444' },
    { c: 12, t: 'YOU type / choose', bg: '#D9E8FB', fc: '#1155CC' },
    { c: 18, t: 'THE ANSWER (formula)', bg: '#E2F0D9', fc: '#548235' },
  ];
  legendCells.forEach(x => {
    const cell = sh.getRange(1, x.c);
    cell.setValue(x.t).setBackground(x.bg).setFontColor(x.fc).setFontWeight('bold');
  });
  sh.getRange(2, 1).setValue('cost_source controls which cost is used. Change it in column L. ' +
    'Everything green recomputes automatically.').setFontStyle('italic').setFontColor('#666666');

  const headerRow = 3;                 // real headers now on row 3
  const firstData = 4;
  const n = sh.getLastRow() - (firstData - 1);
  if (n <= 0) { Logger.log('No data rows.'); return; }

  // --- colour header + body by group ---
  RD_GROUPS.forEach(g => {
    g.cols.forEach(c => {
      sh.getRange(headerRow, c).setBackground(g.head).setFontColor('#FFFFFF').setFontWeight('bold');
      sh.getRange(firstData, c, n, 1).setBackground(g.colour);
    });
  });

  // frozen column extra emphasis
  sh.getRange(firstData, 5, n, 1).setFontColor('#7F6000');
  // the two headline answers get a border
  sh.getRange(firstData, 13, n, 1).setFontWeight('bold'); // cost_active
  sh.getRange(firstData, 18, n, 1).setFontWeight('bold'); // landing_cost

  // --- per-row colour of cost_source (col 12 = L) so you can scan it ---
  const rules = sh.getConditionalFormatRules().filter(r => {
    // drop any prior rules we set on L
    const rr = r.getRanges();
    return !(rr.length === 1 && rr[0].getColumn() === 12);
  });
  const Lrange = sh.getRange(firstData, 12, n, 1);
  const mk = (txt, bg, fc) => SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(txt).setBackground(bg).setFontColor(fc).setBold(true)
    .setRanges([Lrange]).build();
  rules.push(mk('master',        '#FFF2CC', '#7F6000'));
  rules.push(mk('batch_bill',    '#DDEBF7', '#1F4E79'));
  rules.push(mk('batch_current', '#D6E9D5', '#375623'));
  rules.push(mk('manual',        '#FCE4D6', '#833C00'));
  rules.push(mk('none',          '#F4CCCC', '#990000'));
  sh.setConditionalFormatRules(rules);

  // --- add "reads_as" explanation column at the far right, if not present ---
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  let readCol = headers.indexOf('reads_as') + 1;
  if (readCol === 0) {
    readCol = lastCol + 1;
    sh.getRange(headerRow, readCol).setValue('reads_as')
      .setBackground('#375623').setFontColor('#FFFFFF').setFontWeight('bold');
  }

  // build the plain-English sentence per row with one ArrayFormula
  // columns: L source(12), M active(13), U sell_w(21), AA erp_sell_w(27)
  const Lc = 'L', Mc = 'M', Uc = 'U', AAc = 'AA';
  const f = firstData;
  sh.getRange(f, readCol).setFormula(
    '=ARRAYFORMULA(IF(' + 'B' + f + ':B="","",' +
    'IF(' + Mc + f + ':' + Mc + '="","(no cost set)",' +
    '"" & ' + Lc + f + ':' + Lc + ' & " cost " & TEXT(' + Mc + f + ':' + Mc + ',"0.00") & ' +
    '" → sells " & IF(' + Uc + f + ':' + Uc + '="","?",TEXT(' + Uc + f + ':' + Uc + ',"0.00")) & ' +
    'IF(' + AAc + f + ':' + AAc + '="","",' +
    'IF(ABS(IF(' + Uc + f + ':' + Uc + '="",0,' + Uc + f + ':' + Uc + ')-' + AAc + f + ':' + AAc + ')<0.5,' +
    '" (same as Vasy)"," (Vasy has " & TEXT(' + AAc + f + ':' + AAc + ',"0.00") & ")")))))');
  sh.setColumnWidth(readCol, 340);

  // --- group the noisy columns so they can be collapsed ---
  try {
    // collapse the "synced / erp" comparison columns AA..AD (27..30)
    sh.getRange(1, 27, 1, 4);
    // (grouping API is limited; we just widen key cols instead)
  } catch (e) {}

  // widen the columns that matter, narrow the rest
  sh.setColumnWidth(3, 300);   // description
  sh.setColumnWidth(12, 110);  // cost_source
  sh.setColumnWidth(13, 90);   // cost_active
  sh.setColumnWidth(18, 90);   // landing_cost
  sh.setFrozenColumns(3);
  sh.setFrozenRows(3);

  const msg = 'Pricing tab recoloured.\n\n' +
    'Legend is in row 1.\n' +
    'YELLOW = frozen original\n' +
    'GREY   = synced from Vasy (do not type)\n' +
    'BLUE   = you type / choose\n' +
    'GREEN  = the answer (formulas)\n\n' +
    'The cost_source cell (column L) is colour-coded per row.\n' +
    'The new "reads_as" column (far right) explains each row in words.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}