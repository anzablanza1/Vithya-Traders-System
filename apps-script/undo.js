/**********************************************************************
 * VITHYA TRADERS — UNDO
 *
 * Applied changes were only reversible by hand from Price_History.
 * This replays that history backwards.
 *
 * HOW IT WORKS
 *   Price_History records every applied change as
 *        changed_at | by | item_code | field | old_value | new_value | batch_id
 *   Undo takes a batch_id, writes old_value back into Pricing, and logs the
 *   reversal as its own history row (so the undo itself is auditable, and an
 *   undo can be undone).
 *
 * SAFETY
 *   - Only fields that still exist in Pricing are touched.
 *   - If the CURRENT value no longer matches new_value, the row is SKIPPED and
 *     reported. That means someone changed it again after the batch was applied,
 *     and blindly reverting would destroy their work.
 *   - The Change_Queue rows for that batch move to status "reverted".
 *
 * ACTIONS
 *   undoLastBatch()          reverse the most recently applied batch
 *   undoBatch(batchId)       reverse a specific one
 *   listAppliedBatches()     what can be undone, newest first
 **********************************************************************/

const UN = {
  PRICING: 'Pricing',
  HISTORY: 'Price_History',
  QUEUE: 'Change_Queue',
};

function unHeaderRow_(sh, key) {
  for (let r = 1; r <= 8; r++)
    if (String(sh.getRange(r, 1).getValue()).trim() === key) return r;
  return 1;
}
function unMap_(sh, hRow) {
  const hdr = sh.getRange(hRow, 1, 1, sh.getLastColumn()).getValues()[0];
  const M = {};
  hdr.forEach((h, i) => { const k = String(h).trim(); if (k) M[k] = i + 1; });
  return M;
}
function unNum_(v) { const n = Number(v); return isFinite(n) ? n : null; }
function unSame_(a, b) {
  const x = unNum_(a), y = unNum_(b);
  if (x !== null && y !== null) return Math.abs(x - y) < 0.0001;
  return String(a === null || a === undefined ? '' : a).trim() ===
         String(b === null || b === undefined ? '' : b).trim();
}
function unNow_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/* ---------- what can be undone ---------- */

function unAppliedBatches_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(UN.HISTORY);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues();
  const g = {};
  v.forEach(r => {
    const b = String(r[6] || '').trim();
    if (!b) return;
    const note = String(r[7] || '');
    if (note.indexOf('UNDO') === 0) return;       // do not offer undos of undos here
    if (!g[b]) g[b] = { batch_id: b, at: String(r[0]), by: String(r[1]), n: 0, items: {} };
    g[b].n++;
    g[b].items[String(r[2])] = 1;
  });
  return Object.keys(g).sort().reverse().map(b => ({
    batch_id: g[b].batch_id, at: g[b].at, by: g[b].by,
    changes: g[b].n, products: Object.keys(g[b].items).length,
  }));
}

function listAppliedBatches() {
  const list = unAppliedBatches_();
  if (!list.length) {
    try { SpreadsheetApp.getUi().alert('Nothing applied yet — nothing to undo.'); } catch (e) {}
    return [];
  }
  const msg = 'APPLIED BATCHES (newest first)\n\n' +
    list.slice(0, 15).map(b => '   ' + b.batch_id + '   ' + b.changes + ' changes, ' +
      b.products + ' products   ' + b.at).join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return list;
}

/* ---------- the undo ---------- */

function undoBatch(batchId, by) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hs = ss.getSheetByName(UN.HISTORY);
  if (!hs || hs.getLastRow() < 2) throw new Error('Price_History is empty.');
  const pg = ss.getSheetByName(UN.PRICING);
  const pRow = unHeaderRow_(pg, 'product_id');
  const PH = unMap_(pg, pRow);
  const first = pRow + 1;
  const n = pg.getLastRow() - pRow;
  const codes = pg.getRange(first, PH.item_code, n, 1).getValues();
  const rowOf = {};
  codes.forEach((c, i) => { const k = String(c[0] || '').trim(); if (k) rowOf[k] = first + i; });

  const hv = hs.getRange(2, 1, hs.getLastRow() - 1, 8).getValues();
  const target = String(batchId || '').trim();
  if (!target) throw new Error('No batch id given.');

  /* newest first, so if a field changed twice in one batch we restore the earliest */
  const rows = hv.filter(r => String(r[6] || '').trim() === target).reverse();
  if (!rows.length) throw new Error('No history for batch ' + target);

  let reverted = 0, skipped = 0, missing = 0;
  const skips = [];
  const log = [];
  const seen = {};

  rows.forEach(r => {
    const code = String(r[2] || '').trim();
    const field = String(r[3] || '').trim();
    const oldV = r[4], newV = r[5];
    const k = code + '|' + field;
    if (seen[k]) return;                       // already restored to the earliest value
    const pr = rowOf[code];
    if (!pr || !PH[field]) { missing++; return; }

    const cur = pg.getRange(pr, PH[field]).getValue();
    if (!unSame_(cur, newV)) {
      skipped++;
      if (skips.length < 8) skips.push(code + ' ' + field + ': now ' + cur + ', batch set ' + newV);
      return;
    }
    pg.getRange(pr, PH[field]).setValue(oldV === '' ? '' : oldV);
    seen[k] = 1;
    reverted++;
    log.push([unNow_(), by || 'undo', code, field, newV, oldV, target,
      'UNDO of ' + target]);
  });

  if (log.length) hs.getRange(hs.getLastRow() + 1, 1, log.length, 8).setValues(log);

  /* mark the queue rows */
  const q = ss.getSheetByName(UN.QUEUE);
  if (q && q.getLastRow() > 1) {
    const qv = q.getRange(2, 1, q.getLastRow() - 1, 15).getValues();
    let touched = 0;
    qv.forEach(r => {
      if (String(r[0]).trim() === target && String(r[10]) === 'applied') {
        r[10] = 'reverted'; touched++;
      }
    });
    if (touched) q.getRange(2, 1, qv.length, 15).setValues(qv);
  }

  const msg = 'UNDO ' + target + '\n\n' +
    '   reverted: ' + reverted + '\n' +
    '   skipped (changed again since): ' + skipped + '\n' +
    (missing ? '   not found in Pricing: ' + missing + '\n' : '') +
    (skips.length ? '\nSkipped examples:\n   ' + skips.join('\n   ') +
      '\n\nThese were edited after the batch was applied, so reverting would\n' +
      'have destroyed the newer edit. Handle them by hand if needed.' : '') +
    '\n\nThe reversal is itself logged, so it can be undone.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return { batch_id: target, reverted: reverted, skipped: skipped, missing: missing };
}

function undoLastBatch(by) {
  const list = unAppliedBatches_();
  if (!list.length) throw new Error('Nothing applied yet — nothing to undo.');
  return undoBatch(list[0].batch_id, by);
}

function undoLastMenu() {
  const list = unAppliedBatches_();
  if (!list.length) {
    SpreadsheetApp.getUi().alert('Nothing to undo.');
    return;
  }
  const b = list[0];
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('Undo the last applied batch?',
    b.batch_id + '\n' + b.changes + ' changes across ' + b.products + ' products\n' +
    'applied ' + b.at + '\n\nValues are restored from Price_History.',
    ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  undoBatch(b.batch_id, Session.getActiveUser().getEmail() || 'sheet');
}

function onOpenUndo() {
  SpreadsheetApp.getUi()
    .createMenu('↩️ Undo')
    .addItem('Undo last applied batch', 'undoLastMenu')
    .addItem('List applied batches', 'listAppliedBatches')
    .addToUi();
}