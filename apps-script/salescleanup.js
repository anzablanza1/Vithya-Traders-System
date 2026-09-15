/**********************************************************************
 * VITHYA TRADERS — SALES PULL: DIAGNOSE, VERIFY, FINISH
 *
 * WHY THE AUTO-CONTINUE STALLS
 *   Triggered executions share a DAILY runtime budget, and Utilities.sleep()
 *   counts toward it. At a 33s pace each 4.3-minute run is almost entirely
 *   sleeping, so the budget drains without much work being done. It resets
 *   overnight — but with only ~28 calls left, finishing by hand is quicker.
 *
 * ORDER
 *   1. diagnoseSalesPull()      what state is it actually in
 *   2. checkSalesDuplicates()   did overlapping triggers double-write anything
 *   3. finishSalesItems()       cancel the trigger, run to the end by hand
 *   4. removeSalesDuplicates()  only if step 2 found some
 **********************************************************************/

const SF = {
  SHEET: 'Sales_Items',
  MONTH: 'SI_MONTH',
  OFFSET: 'SI_OFFSET',
  GAP: 'SI_GAP',
  OKC: 'SI_OK_COUNT',
};

function diagnoseSalesPull() {
  const p = PropertiesService.getScriptProperties();
  const ss = txnBook_();
  const sh = ss.getSheetByName(SF.SHEET);
  const rows = sh ? Math.max(0, sh.getLastRow() - 1) : 0;

  const trigs = ScriptApp.getProjectTriggers();
  const mine = trigs.filter(t => t.getHandlerFunction() === 'pullSalesItems');
  const all = trigs.map(t => t.getHandlerFunction());
  const counts = {};
  all.forEach(h => counts[h] = (counts[h] || 0) + 1);

  const gap = parseInt(p.getProperty(SF.GAP) || '20000', 10);
  const month = p.getProperty(SF.MONTH) || '(none)';
  const off = parseInt(p.getProperty(SF.OFFSET) || '0', 10);

  /* what is left */
  const TOTAL = 192057;
  const remaining = Math.max(0, TOTAL - rows);
  const calls = Math.ceil(remaining / 500);

  const msg = 'SALES PULL DIAGNOSIS\n\n' +
    'rows in sheet : ' + rows.toLocaleString() + ' of ~' + TOTAL.toLocaleString() +
    '  (' + (rows / TOTAL * 100).toFixed(1) + '%)\n' +
    'position      : ' + month + ' offset ' + off + '\n' +
    'pace          : ' + gap + 'ms\n' +
    'remaining     : ~' + remaining.toLocaleString() + ' lines, ~' + calls + ' calls\n' +
    '                ≈ ' + Math.round(calls * gap / 60000) + ' min of API time\n\n' +
    'pullSalesItems triggers: ' + mine.length +
    (mine.length > 1 ? '   ⚠ MORE THAN ONE — they can overlap and double-write' : '') +
    '\nall project triggers: ' + trigs.length + '\n' +
    Object.keys(counts).sort().map(k => '   ' + k + ' x' + counts[k]).join('\n') +
    '\n\nIf it has not moved for hours, the daily TRIGGER runtime budget is\n' +
    'most likely exhausted. It resets overnight. With ' + calls + ' calls left,\n' +
    'finishSalesItems() is faster.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ---- duplicates: the real risk if two triggers ever overlapped ---- */

function checkSalesDuplicates() {
  const ss = txnBook_();
  const sh = ss.getSheetByName(SF.SHEET);
  if (!sh || sh.getLastRow() < 2) throw new Error('Sales_Items is empty.');
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {}; hdr.forEach((h, i) => H[String(h).trim()] = i);
  const n = sh.getLastRow() - 1;

  const seen = {};
  let dupes = 0;
  const examples = [];
  const B = 25000;
  for (let s = 0; s < n; s += B) {
    const take = Math.min(B, n - s);
    const v = sh.getRange(2 + s, 1, take, sh.getLastColumn()).getValues();
    v.forEach((r, i) => {
      /* a sales line is unique on invoice + item + batch + qty + amount */
      const k = [r[H.salesNo], r[H.itemCode], r[H.batchNo],
        r[H.qty], r[H.netAmount]].join('|');
      if (seen[k]) {
        dupes++;
        if (examples.length < 6) examples.push('row ' + (s + i + 2) + '  ' + k);
      } else seen[k] = 1;
    });
  }

  const msg = 'DUPLICATE CHECK\n\n' +
    'rows: ' + n.toLocaleString() + '\n' +
    'unique lines: ' + Object.keys(seen).length.toLocaleString() + '\n' +
    'duplicates: ' + dupes.toLocaleString() +
    (dupes ? '  ⚠\n\nExamples:\n   ' + examples.join('\n   ') +
      '\n\nRun removeSalesDuplicates() to clean them.' :
      '\n\nClean — no overlapping writes happened.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return dupes;
}

function removeSalesDuplicates() {
  const ss = txnBook_();
  const sh = ss.getSheetByName(SF.SHEET);
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {}; hdr.forEach((h, i) => H[String(h).trim()] = i);
  const n = sh.getLastRow() - 1;
  const w = sh.getLastColumn();
  const v = sh.getRange(2, 1, n, w).getValues();

  const seen = {};
  const keep = [];
  v.forEach(r => {
    const k = [r[H.salesNo], r[H.itemCode], r[H.batchNo],
      r[H.qty], r[H.netAmount]].join('|');
    if (seen[k]) return;
    seen[k] = 1;
    keep.push(r);
  });
  const removed = n - keep.length;
  if (!removed) {
    try { SpreadsheetApp.getUi().alert('Nothing to remove.'); } catch (e) {}
    return 0;
  }
  sh.getRange(2, 1, n, w).clearContent();
  const B = 5000;
  for (let i = 0; i < keep.length; i += B) {
    const blk = keep.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, w).setValues(blk);
  }
  const msg = 'Removed ' + removed.toLocaleString() + ' duplicate line(s).\n' +
    'Kept ' + keep.length.toLocaleString() + '.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return removed;
}

/* ---- finish it by hand ---- */

/**
 * Cancels the trigger first, so a scheduled run cannot fire mid-way and
 * double-write. Manual executions get the full runtime budget, which is what
 * the last stretch needs.
 * Run it repeatedly until it says COMPLETE.
 */
function finishSalesItems() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'pullSalesItems') ScriptApp.deleteTrigger(t);
  });
  /* ease the pace back — 33s was set by two transient 429s hours ago */
  const p = PropertiesService.getScriptProperties();
  const cur = parseInt(p.getProperty(SF.GAP) || '20000', 10);
  if (cur > 20000) {
    p.setProperty(SF.GAP, '20000');
    p.setProperty(SF.OKC, '0');
    Logger.log('pace eased ' + cur + 'ms -> 20000ms for the manual finish');
  }
  Logger.log('Trigger cancelled. Running to the end...');
  pullSalesItems();
}

function onOpenSalesFinish() {
  SpreadsheetApp.getUi()
    .createMenu('🔧 Sales Pull')
    .addItem('Diagnose', 'diagnoseSalesPull')
    .addItem('Check duplicates', 'checkSalesDuplicates')
    .addItem('Finish manually', 'finishSalesItems')
    .addSeparator()
    .addItem('Remove duplicates', 'removeSalesDuplicates')
    .addToUi();
}
