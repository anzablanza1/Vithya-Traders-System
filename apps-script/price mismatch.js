/**********************************************************************
 * VITHYA TRADERS — Price Mismatch Report
 * ERP_Snapshot (product level)  vs  Cost_Current (batch level)
 *
 * Answers: "which products have mismatch between mrp and selling price
 * in erp snapshot and in product details with batch price"
 *
 * For every itemCode present in BOTH tabs, compares:
 *     sellingPrice   snapshot vs batch
 *     mrp            snapshot vs batch
 * Lists ONLY the rows where either differs by more than 0.05.
 *
 * These are the products where the product-master price and the active
 * batch price disagree — the ones YOU said you would check by hand.
 *
 * REQUIRES: ERP_Snapshot populated, Cost_Current populated (Phase B done).
 * RUN:  buildPriceMismatch()
 * OUTPUT: Price_Mismatch tab.
 **********************************************************************/

const PM = {
  SNAP: 'ERP_Snapshot',
  CUR: 'Cost_Current',
  OUT: 'Price_Mismatch',
  TOL: 0.05,             // differences under 5 paise are rounding, not edits
};

function pmNum_(v) { const n = Number(v); return isFinite(n) ? n : null; }

function buildPriceMismatch() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const snapSh = ss.getSheetByName(PM.SNAP);
  const curSh = ss.getSheetByName(PM.CUR);
  if (!snapSh || snapSh.getLastRow() < 2) throw new Error('ERP_Snapshot is empty.');
  if (!curSh || curSh.getLastRow() < 2) throw new Error('Cost_Current is empty — finish Phase B and foldCostCurrent first.');

  // --- snapshot: itemCode -> {sell, mrp}
  const sv = snapSh.getDataRange().getValues();
  const sH = {}; sv[0].forEach((h, i) => sH[String(h).trim()] = i);
  const snap = {};
  for (let i = 1; i < sv.length; i++) {
    const code = String(sv[i][sH.itemCode] || '').trim();
    if (!code) continue;
    snap[code] = {
      sell: pmNum_(sv[i][sH.sellingPrice]),
      mrp: pmNum_(sv[i][sH.mrp]),
      name: sv[i][sH.productName],
      qty: pmNum_(sv[i][sH.qty]),
    };
  }

  // --- current (batch): itemCode -> {sell, mrp, pp, date}
  const cv = curSh.getDataRange().getValues();
  const cH = {}; cv[0].forEach((h, i) => cH[String(h).trim()] = i);
  const out = [['itemCode','productName','lane',
    'snapshot_selling','batch_selling','selling_gap',
    'snapshot_mrp','batch_mrp','mrp_gap',
    'batch_purchase_price','batch_updated','erp_qty','what_differs']];

  let checked = 0, mismatched = 0;
  for (let i = 1; i < cv.length; i++) {
    const code = String(cv[i][cH.itemCode] || '').trim();
    if (!code) continue;
    const s = snap[code];
    if (!s) continue;
    checked++;

    const bSell = pmNum_(cv[i][cH.sellingPrice]);
    const bMrp = pmNum_(cv[i][cH.mrp]);
    const sSell = s.sell, sMrp = s.mrp;

    const sellDiff = (sSell !== null && bSell !== null) ? Math.abs(sSell - bSell) : 0;
    const mrpDiff = (sMrp !== null && bMrp !== null) ? Math.abs(sMrp - bMrp) : 0;

    if (sellDiff > PM.TOL || mrpDiff > PM.TOL) {
      mismatched++;
      let what = [];
      if (sellDiff > PM.TOL) what.push('SELLING differs by ' + (Math.round(sellDiff * 100) / 100));
      if (mrpDiff > PM.TOL) what.push('MRP differs by ' + (Math.round(mrpDiff * 100) / 100));
      out.push([code, s.name,
        code.slice(-1) === '/' ? 'WO' : 'W',
        sSell === null ? '' : sSell, bSell === null ? '' : bSell,
        sellDiff > PM.TOL ? Math.round((bSell - sSell) * 100) / 100 : '',
        sMrp === null ? '' : sMrp, bMrp === null ? '' : bMrp,
        mrpDiff > PM.TOL ? Math.round((bMrp - sMrp) * 100) / 100 : '',
        pmNum_(cv[i][cH.purchasePrice]) === null ? '' : pmNum_(cv[i][cH.purchasePrice]),
        cv[i][cH.batchUpdatedDate] || '',
        s.qty === null ? '' : s.qty,
        what.join('; ')]);
    }
  }

  let sh = ss.getSheetByName(PM.OUT);
  if (!sh) sh = ss.insertSheet(PM.OUT);
  sh.clear();
  sh.getRange(1, 1, out.length, out[0].length).setValues(out);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, out[0].length).setFontWeight('bold')
    .setBackground('#1F3864').setFontColor('#FFFFFF');
  sh.setColumnWidth(2, 300);
  sh.setColumnWidth(13, 260);

  const msg = 'Price_Mismatch built.\n\n' +
    'SKUs compared (in both tabs): ' + checked + '\n' +
    'SKUs where batch price differs from snapshot: ' + mismatched + '\n\n' +
    'These are the products to check by hand in Vasy.\n' +
    'If mismatched is small, the product master and batches mostly agree.\n' +
    'If large, batch prices routinely diverge from the product master.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}