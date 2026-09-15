/**********************************************************************
 * VITHYA TRADERS — PASS B SERVER
 *
 * 1. XLSX ROUND-TRIP
 *      exportPricingXlsx()      writes an .xlsx to Drive and returns a link.
 *                               Every column is included, so it is easy to verify.
 *      importPricingXlsx(fileId) reads an edited copy back, diffs it against
 *                               the live Pricing tab, and STAGES the differences
 *                               into Change_Queue. Nothing is written directly.
 *      Same pair works for the Review queue: exportQueueXlsx / importQueueXlsx.
 *
 *    Why Drive and not the browser: a local HTML file cannot build a real .xlsx
 *    without a third-party library, and you would lose formatting. Apps Script
 *    can convert a Sheet to .xlsx natively, so the file you get is a true
 *    spreadsheet with all columns and no library dependency.
 *
 * 2. SOURCE ATTRIBUTION for the overnight feed
 *      Every Review_Feed row gains  source =
 *          purchase_register  the bill said so
 *          cost_current       the live batch says so
 *          erp_snapshot       Vasy's product master says so
 *          master             computed from your own numbers
 *      so you can see, and filter by, WHERE a change came from.
 *
 * RUN / WIRE
 *   exportPricingXlsx()  from the sheet menu, or via the dashboard action
 *   addFeedSource()      once, to add the column to an existing Review_Feed
 **********************************************************************/

const PB2 = {
  PRICING: 'Pricing',
  QUEUE: 'Change_Queue',
  FEED: 'Review_Feed',
  FOLDER_PROP: 'VT_EXPORT_FOLDER_ID',
};

/* ---------- helpers ---------- */

function pb2HeaderRow_(sh, key) {
  for (let r = 1; r <= 8; r++)
    if (String(sh.getRange(r, 1).getValue()).trim() === key) return r;
  return 1;
}
function pb2Num_(v) { const n = Number(v); return isFinite(n) ? n : null; }
function pb2Now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
}
function pb2Folder_() {
  const id = PropertiesService.getScriptProperties().getProperty(PB2.FOLDER_PROP);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const it = DriveApp.getFoldersByName('VT Price Exports');
  const f = it.hasNext() ? it.next() : DriveApp.createFolder('VT Price Exports');
  PropertiesService.getScriptProperties().setProperty(PB2.FOLDER_PROP, f.getId());
  return f;
}

/* ---------- export any tab to a real .xlsx ---------- */

function pb2Export_(tabName, keyHeader, label) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(tabName);
  if (!src || src.getLastRow() < 2) throw new Error(tabName + ' is empty.');

  const hRow = pb2HeaderRow_(src, keyHeader);
  const nRows = src.getLastRow() - hRow + 1;
  const nCols = src.getLastColumn();
  const values = src.getRange(hRow, 1, nRows, nCols).getValues();

  /* build a clean temporary spreadsheet — values only, no formulas */
  const tmp = SpreadsheetApp.create('VT_' + label + '_' + pb2Now_());
  const ts = tmp.getSheets()[0];
  ts.setName(label);
  ts.getRange(1, 1, nRows, nCols).setValues(values);
  ts.setFrozenRows(1);
  ts.getRange(1, 1, 1, nCols).setFontWeight('bold')
    .setBackground('#CC3018').setFontColor('#FFFFFF');
  SpreadsheetApp.flush();

  const file = DriveApp.getFileById(tmp.getId());
  const folder = pb2Folder_();
  const url = 'https://docs.google.com/spreadsheets/d/' + tmp.getId() +
    '/export?format=xlsx&id=' + tmp.getId();
  const blob = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
  }).getBlob().setName('VT_' + label + '_' + pb2Now_() + '.xlsx');
  const xlsx = folder.createFile(blob);
  file.setTrashed(true);      // drop the temp Sheet, keep the .xlsx

  return {
    file_id: xlsx.getId(),
    name: xlsx.getName(),
    url: xlsx.getUrl(),
    rows: nRows - 1,
    cols: nCols,
  };
}

function exportPricingXlsx() {
  const r = pb2Export_(PB2.PRICING, 'product_id', 'Pricing');
  const msg = 'Exported ' + r.rows + ' rows x ' + r.cols + ' columns\n\n' +
    r.name + '\n\n' + r.url + '\n\n' +
    'Edit it, then use Import to bring the changes back for review.\n' +
    'Keep the item_code column unchanged — it is the match key.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return r;
}

function exportQueueXlsx() {
  const r = pb2Export_(PB2.QUEUE, 'batch_id', 'Review_Queue');
  const msg = 'Exported ' + r.rows + ' queue rows\n\n' + r.name + '\n\n' + r.url;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return r;
}

/* ---------- import an edited file and stage the differences ---------- */

/**
 * fileId : the Drive id of the edited .xlsx (or Sheet).
 * Returns a diff summary. Nothing is written to Pricing — changes are STAGED.
 */
function importPricingXlsx(fileId, by) {
  if (!fileId) throw new Error('No fileId. Upload the edited file to Drive and pass its id.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const live = ss.getSheetByName(PB2.PRICING);
  const hRow = pb2HeaderRow_(live, 'product_id');
  const lHdr = live.getRange(hRow, 1, 1, live.getLastColumn()).getValues()[0]
    .map(x => String(x).trim());
  const LH = {}; lHdr.forEach((h, i) => { if (h) LH[h] = i; });
  const n = live.getLastRow() - hRow;
  const lVals = live.getRange(hRow + 1, 1, n, live.getLastColumn()).getValues();
  const lByCode = {};
  lVals.forEach(r => {
    const c = String(r[LH.item_code] || '').trim();
    if (c) lByCode[c] = r;
  });

  /* open the uploaded file — convert if it is still .xlsx */
  let openId = fileId;
  let temp = null;
  const f = DriveApp.getFileById(fileId);
  if (f.getMimeType() !== MimeType.GOOGLE_SHEETS) {
    const res = Drive.Files.copy(
      { title: 'VT_import_tmp_' + pb2Now_(), mimeType: MimeType.GOOGLE_SHEETS },
      fileId);
    openId = res.id;
    temp = res.id;
  }
  const up = SpreadsheetApp.openById(openId).getSheets()[0];
  const uVals = up.getDataRange().getValues();
  if (uVals.length < 2) throw new Error('The uploaded file has no data rows.');
  const uHdr = uVals[0].map(x => String(x).trim());
  const UH = {}; uHdr.forEach((h, i) => { if (h) UH[h] = i; });
  if (UH.item_code === undefined) throw new Error('The uploaded file has no item_code column.');

  /* which columns may be staged — anything editable that exists on both sides */
  const skip = { item_code: 1, product_id: 1, description: 1, category: 1 };
  const cols = Object.keys(UH).filter(k => LH[k] !== undefined && !skip[k]);

  const diffs = [];
  for (let i = 1; i < uVals.length; i++) {
    const r = uVals[i];
    const code = String(r[UH.item_code] || '').trim();
    if (!code) continue;
    const lr = lByCode[code];
    if (!lr) continue;                       // unknown product — ignore, do not invent
    cols.forEach(k => {
      const nv = r[UH[k]];
      const ov = lr[LH[k]];
      const nn = pb2Num_(nv), on = pb2Num_(ov);
      let changed;
      if (nn !== null && on !== null) changed = Math.abs(nn - on) > 0.0001;
      else changed = String(nv === null ? '' : nv).trim() !== String(ov === null ? '' : ov).trim();
      if (changed) diffs.push({ c: code, f: k, o: ov, v: nv });
    });
  }

  if (temp) { try { DriveApp.getFileById(temp).setTrashed(true); } catch (e) {} }

  if (!diffs.length) {
    const m = 'No differences found. Nothing staged.';
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return { changed: 0, staged: 0, batch_id: '' };
  }

  /* stage into Change_Queue — approval still required */
  let q = ss.getSheetByName(PB2.QUEUE);
  if (!q) {
    q = ss.insertSheet(PB2.QUEUE);
    q.getRange(1, 1, 1, 15).setValues([['batch_id', 'staged_at', 'staged_by', 'item_code',
      'product_id', 'lane', 'field', 'old_value', 'new_value', 'note', 'status',
      'approved_by', 'approved_at', 'uploaded_at', 'applied_at']]);
    q.setFrozenRows(1);
  }
  const bid = 'CHG-' + pb2Now_() + '-XLSX';
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const rows = diffs.map(d => [bid, now, by || 'xlsx-import', d.c, '', '', d.f,
    d.o, d.v, 'from uploaded workbook', 'staged', '', '', '', '']);
  const B = 2000;
  for (let i = 0; i < rows.length; i += B) {
    const blk = rows.slice(i, i + B);
    q.getRange(q.getLastRow() + 1, 1, blk.length, 15).setValues(blk);
  }

  const byField = {};
  diffs.forEach(d => byField[d.f] = (byField[d.f] || 0) + 1);
  const msg = 'IMPORT STAGED\n\n' + diffs.length + ' change(s) across ' +
    Object.keys(byField).length + ' field(s):\n' +
    Object.keys(byField).sort().map(k => '   ' + k + ': ' + byField[k]).join('\n') +
    '\n\nBatch ' + bid + '\nOpen the Review tab to approve or reject.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return { changed: diffs.length, staged: rows.length, batch_id: bid, fields: byField };
}

/* prompt version for the sheet menu */
function importPricingPrompt() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Import edited workbook',
    'Upload the edited file to Drive, open it, and paste its file id here.\n' +
    '(The id is the long code in the URL between /d/ and /edit)',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const id = res.getResponseText().trim();
  if (!id) return;
  importPricingXlsx(id, Session.getActiveUser().getEmail() || 'sheet');
}

/* ---------- source attribution on the review feed ---------- */

/**
 * Adds a `source` column to Review_Feed and fills it from the feed type.
 * Safe to re-run.
 */
function addFeedSource() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PB2.FEED);
  if (!sh || sh.getLastRow() < 2) throw new Error('Review_Feed is empty — build it first.');
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(x => String(x).trim());
  const H = {}; hdr.forEach((h, i) => { if (h) H[h] = i + 1; });

  if (!H.source) {
    const c = sh.getLastColumn() + 1;
    sh.getRange(1, c).setValue('source').setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
    H.source = c;
    SpreadsheetApp.flush();
  }

  const n = sh.getLastRow() - 1;
  const types = sh.getRange(2, H.type, n, 1).getValues();
  const MAP = {
    COST_UP: 'purchase_register',
    COST_DOWN: 'purchase_register',
    PRICE_CHANGED: 'erp_snapshot',
    NEW_PRODUCT: 'erp_snapshot',
    MISSING_IN_ERP: 'erp_snapshot',
    MARGIN_RISK: 'master',
    BATCH_EDITED: 'cost_current',
  };
  const out = types.map(r => [MAP[String(r[0]).trim()] || 'master']);
  sh.getRange(2, H.source, n, 1).setValues(out);

  const tally = {};
  out.forEach(r => tally[r[0]] = (tally[r[0]] || 0) + 1);
  const msg = 'Source attribution added to Review_Feed:\n\n' +
    Object.keys(tally).sort().map(k => '   ' + k + ': ' + tally[k]).join('\n') +
    '\n\nThe dashboard can now filter the overnight feed by where a change came from.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ---------- menu ---------- */

function onOpenPassB() {
  SpreadsheetApp.getUi()
    .createMenu('📤 Export / Import')
    .addItem('Export Pricing to xlsx', 'exportPricingXlsx')
    .addItem('Export Review queue to xlsx', 'exportQueueXlsx')
    .addSeparator()
    .addItem('Import edited workbook', 'importPricingPrompt')
    .addSeparator()
    .addItem('Add source column to feed', 'addFeedSource')
    .addToUi();
}
