/**********************************************************************
 * VITHYA TRADERS — PRICING IMPORT
 *
 * Globals declared here (check before pasting):
 *   VPI, VPI_INPUTS, VPI_LOG_COLS, VPI_FILE_ID, importWorkableFile,
 *   importWorkableNow, previewWorkableFile, verifyProgress, onOpenPricingImport,
 *   vpiNum_, vpiRead_, vpiKey_, vpiDiff_, vpiLogSheet_, vpiCheck_
 *
 * ── THE OTHER HALF OF THE ROUND TRIP ──
 *   exportWorkableFile() gives you a Google Sheet with live formulas.
 *   You fill in the white cells — offline in Sheets, or in Excel and pasted
 *   back — and this reads it, compares it against Verified_Pricing, and
 *   applies only what actually changed.
 *
 * ── ONLY INPUTS ARE IMPORTED ──
 *   The computed columns are ignored entirely. If someone types over a
 *   formula in the copy, it is discarded rather than written back — the
 *   master recomputes from the inputs, always.
 *
 * ── IT CHECKS BEFORE IT WRITES ──
 *   Selling below loaded cost, negative charges, a cost marked verified with
 *   no source, a trust set to verified while the value is blank. These are
 *   reported and NOT applied. previewWorkableFile() shows everything without
 *   touching the master.
 *
 * ── AUDIT ──
 *   Every change lands in Verify_Log with old value, new value, who, when and
 *   which file it came from. Verified_Pricing is the current state; the log is
 *   how you reconstruct why.
 *
 * ── RUN ──
 *   previewWorkableFile()   read only — what would change
 *   importWorkableNow()     set VPI_FILE_ID below, then run
 *   verifyProgress()        how much of the catalogue is verified
 **********************************************************************/

/* paste the id of the edited sheet here (or the whole URL) */
const VPI_FILE_ID = 'PASTE_THE_EDITED_FILE_ID_HERE';

const VPI = {
  MASTER: 'Verified_Pricing',
  LOG: 'Verify_Log',
  HDR_ROW: 2,
  FLOOR: 0.12,
};

/* the only columns that come back in. Everything else is computed. */
const VPI_INPUTS = [
  'cost_value', 'cost_mode', 'cost_param', 'cost_trust', 'cost_source', 'cost_date',
  'transport_value', 'transport_type', 'transport_trust',
  'packing_value', 'packing_type', 'packing_trust',
  'selling_value', 'selling_mode', 'selling_param', 'selling_trust',
  'mrp_disc', 'wh_disc', 'rt_disc', 'notes',
];

const VPI_LOG_COLS = ['at', 'item_code', 'lane', 'field', 'old_value', 'new_value',
  'trust', 'source', 'by', 'from_file'];

function vpiNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function vpiKey_(code, lane) { return String(code).trim() + '|' + String(lane).trim(); }

function vpiRead_(ss, name, hdrRow) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  const hr = hdrRow || 1;
  if (sh.getLastRow() <= hr) return { sh: sh, H: {}, rows: [] };
  const hdr = sh.getRange(hr, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  return { sh: sh, H: H, hr: hr,
    rows: sh.getRange(hr + 1, 1, sh.getLastRow() - hr, sh.getLastColumn()).getValues() };
}

function vpiLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(VPI.LOG);
  if (!sh) {
    sh = ss.insertSheet(VPI.LOG);
    sh.getRange(1, 1, 1, VPI_LOG_COLS.length).setValues([VPI_LOG_COLS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, VPI_LOG_COLS.length).setFontWeight('bold')
      .setBackground('#6C6C60').setFontColor('#FFFFFF');
  }
  return sh;
}

/* normalise for comparison — 21.5 and "21.50" are the same number */
function vpiSame_(a, b) {
  const na = Number(a), nb = Number(b);
  if (isFinite(na) && isFinite(nb) && a !== '' && b !== '') {
    return Math.abs(na - nb) < 0.0001;
  }
  return String(a === null || a === undefined ? '' : a).trim() ===
         String(b === null || b === undefined ? '' : b).trim();
}

/* ---------- the checks ---------- */

function vpiCheck_(row, H) {
  const bad = [];
  const g = function (c) { return H[c] === undefined ? '' : row[H[c]]; };
  const cost = Number(g('cost_value'));
  const sell = Number(g('selling_value'));
  const tr = Number(g('transport_value'));
  const pk = Number(g('packing_value'));
  const gst = Number(g('gst_rate')) || 0;

  if (g('cost_value') !== '' && !(cost > 0)) bad.push('cost must be above zero');
  if (g('selling_value') !== '' && !(sell > 0)) bad.push('selling must be above zero');
  if (g('transport_value') !== '' && tr < 0) bad.push('transport is negative');
  if (g('packing_value') !== '' && pk < 0) bad.push('packing is negative');

  ['cost', 'transport', 'packing', 'selling'].forEach(function (f) {
    const t = String(g(f + '_trust') || '');
    const v = g(f + '_value');
    if (t === 'verified' && (v === '' || v === null)) {
      bad.push(f + ' marked verified but has no value');
    }
  });
  if (String(g('cost_trust')) === 'verified' && !String(g('cost_source') || '').trim()) {
    bad.push('cost verified with no source — record the bill number');
  }

  if (cost > 0 && sell > 0) {
    const inc = cost * (1 + gst / 100);
    const trAmt = String(g('transport_type')) === 'pct_of_landing' ? inc * tr / 100 : (tr || 0);
    const pkAmt = String(g('packing_type')) === 'pct_of_landing' ? inc * pk / 100 : (pk || 0);
    const loaded = inc + trAmt + pkAmt;
    if (loaded > 0) {
      const m = (sell - loaded) / loaded;
      if (m < 0) bad.push('selling below loaded cost — margin ' + (m * 100).toFixed(1) + '%');
      else if (m < VPI.FLOOR) {
        bad.push('WARN margin ' + (m * 100).toFixed(1) + '% is under the ' +
          (VPI.FLOOR * 100) + '% floor');
      }
    }
  }
  return bad;
}

/* ---------- read the edited copy ---------- */

function vpiOpen_(fileId) {
  let id = String(fileId || '').trim();
  const m = id.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) id = m[1];
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) {
    throw new Error('That does not look like a file id.\n\nOpen the edited sheet and ' +
      'copy the long code from the URL between /d/ and /edit.');
  }
  let ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) {
    throw new Error('Could not open that file as a Google Sheet.\n\n' +
      'If it is an .xlsx, open it in Drive and use File > Save as Google Sheets,\n' +
      'then use the new id.\n\n' + e.message);
  }
  return ss;
}

function vpiDiff_(fileId) {
  const src = vpiOpen_(fileId);
  const sh = src.getSheets()[0];
  const inc = vpiRead_(src, sh.getName(), VPI.HDR_ROW);
  if (!inc.rows.length) throw new Error('That file has no data rows.');
  if (inc.H.item_code === undefined || inc.H.lane === undefined) {
    throw new Error('That file has no item_code / lane columns — is it the exported file?');
  }

  const master = vpiRead_(SpreadsheetApp.getActiveSpreadsheet(), VPI.MASTER, VPI.HDR_ROW);
  const idx = {};
  master.rows.forEach(function (r, i) {
    idx[vpiKey_(r[master.H.item_code], r[master.H.lane])] = i;
  });

  const changes = [], problems = [], unknown = [];
  inc.rows.forEach(function (r) {
    const code = String(r[inc.H.item_code] || '').trim();
    if (!code) return;
    const lane = String(r[inc.H.lane] || '').trim();
    const k = vpiKey_(code, lane);
    if (idx[k] === undefined) { unknown.push(k); return; }
    const mrow = master.rows[idx[k]];

    const bad = vpiCheck_(r, inc.H);
    const hard = bad.filter(function (b) { return b.indexOf('WARN') !== 0; });

    const fields = [];
    VPI_INPUTS.forEach(function (f) {
      if (inc.H[f] === undefined || master.H[f] === undefined) return;
      const nv = r[inc.H[f]], ov = mrow[master.H[f]];
      if (vpiSame_(ov, nv)) return;
      fields.push({ field: f, old: ov, val: nv });
    });
    if (!fields.length && !bad.length) return;

    const rec = { key: k, code: code, lane: lane, rowIndex: idx[k],
      fields: fields, problems: bad, blocked: hard.length > 0,
      trust: String(r[inc.H.cost_trust] || ''),
      source: String(r[inc.H.cost_source] || '') };
    if (rec.blocked) problems.push(rec);
    else if (fields.length) changes.push(rec);
    else if (bad.length) problems.push(rec);
  });
  return { changes: changes, problems: problems, unknown: unknown,
    master: master, fileName: src.getName(), fileId: src.getId() };
}

/* ---------- preview ---------- */

function previewWorkableFile(fileId) {
  const id = fileId || VPI_FILE_ID;
  if (!id || id.indexOf('PASTE') === 0) {
    throw new Error('Set VPI_FILE_ID at the top of this file first.');
  }
  const d = vpiDiff_(id);
  const nf = d.changes.reduce(function (s, c) { return s + c.fields.length; }, 0);

  const lines = d.changes.slice(0, 12).map(function (c) {
    return '   ' + c.code + ' ' + c.lane + ' — ' +
      c.fields.slice(0, 4).map(function (f) {
        return f.field + ': ' + (f.old === '' ? '(blank)' : f.old) + ' -> ' + f.val;
      }).join(', ') + (c.fields.length > 4 ? ' …' : '');
  });
  const probs = d.problems.slice(0, 10).map(function (p) {
    return '   ' + p.code + ' ' + p.lane + ' — ' + p.problems.join('; ');
  });

  const msg = 'PREVIEW — nothing has been changed\n\n' +
    'file: ' + d.fileName + '\n' +
    'rows that would change: ' + d.changes.length + '  (' + nf + ' fields)\n' +
    'rows blocked by a problem: ' + d.problems.filter(function (p) { return p.blocked; }).length + '\n' +
    'warnings only: ' + d.problems.filter(function (p) { return !p.blocked; }).length + '\n' +
    (d.unknown.length ? 'not in the master: ' + d.unknown.length + '\n' : '') +
    (lines.length ? '\n── would change ──\n' + lines.join('\n') +
      (d.changes.length > 12 ? '\n   …and ' + (d.changes.length - 12) + ' more' : '') : '') +
    (probs.length ? '\n\n── problems ──\n' + probs.join('\n') : '') +
    '\n\nRun importWorkableNow() to apply.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return d;
}

/* ---------- apply ---------- */

function importWorkableFile(fileId, byWhom) {
  const d = vpiDiff_(fileId);
  if (!d.changes.length) {
    const m = 'Nothing to apply.' +
      (d.problems.length ? '\n\n' + d.problems.length + ' row(s) have problems — run ' +
        'previewWorkableFile() to see them.' : '');
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return 0;
  }

  const master = d.master;
  const sh = master.sh;
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const by = String(byWhom || Session.getActiveUser().getEmail() || 'import').split('@')[0];
  const log = [];
  let fieldCount = 0;

  d.changes.forEach(function (c) {
    const rowNo = master.hr + 1 + c.rowIndex;
    c.fields.forEach(function (f) {
      sh.getRange(rowNo, master.H[f.field] + 1).setValue(f.val);
      log.push([stamp, c.code, c.lane, f.field, f.old, f.val,
        c.trust, c.source, by, d.fileName]);
      fieldCount++;
    });
    /* stamp the date when a field is newly marked verified and no date given */
    ['cost', 'transport', 'packing', 'selling'].forEach(function (g) {
      const tf = g + '_trust';
      const changed = c.fields.some(function (f) { return f.field === tf; });
      if (!changed) return;
      const nv = c.fields.filter(function (f) { return f.field === tf; })[0].val;
      if (String(nv) !== 'verified') return;
      if (master.H.cost_date !== undefined && g === 'cost') {
        const cur = sh.getRange(rowNo, master.H.cost_date + 1).getValue();
        if (!cur) sh.getRange(rowNo, master.H.cost_date + 1).setValue(today);
      }
    });
  });

  if (log.length) {
    const ls = vpiLogSheet_();
    ls.getRange(ls.getLastRow() + 1, 1, log.length, VPI_LOG_COLS.length).setValues(log);
  }

  const blocked = d.problems.filter(function (p) { return p.blocked; }).length;
  const msg = 'IMPORTED\n\n' +
    'rows updated: ' + d.changes.length + '\n' +
    'fields changed: ' + fieldCount + '\n' +
    'by: ' + by + '\n' +
    (blocked ? '\nSKIPPED ' + blocked + ' row(s) with problems — run\n' +
      'previewWorkableFile() to see why.\n' : '') +
    (d.unknown.length ? '\n' + d.unknown.length + ' row(s) were not in the master.\n' : '') +
    '\nEvery change is recorded in ' + VPI.LOG + '.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return fieldCount;
}

function importWorkableNow() {
  const id = String(VPI_FILE_ID || '').trim();
  if (!id || id.indexOf('PASTE') === 0) {
    throw new Error('Set VPI_FILE_ID at the top of this file, then run again.');
  }
  return importWorkableFile(id);
}

/* ---------- progress ---------- */

function verifyProgress() {
  const m = vpiRead_(SpreadsheetApp.getActiveSpreadsheet(), VPI.MASTER, VPI.HDR_ROW);
  if (!m.rows.length) throw new Error('Verified_Pricing is empty.');
  const byTrust = {}, byField = { cost: {}, transport: {}, packing: {}, selling: {} };
  let rows = 0;
  m.rows.forEach(function (r) {
    const code = String(r[m.H.item_code] || '').trim();
    if (!code) return;
    rows++;
    const rt = String(r[m.H.row_trust] || 'unverified');
    byTrust[rt] = (byTrust[rt] || 0) + 1;
    ['cost', 'transport', 'packing', 'selling'].forEach(function (f) {
      const t = String(r[m.H[f + '_trust']] || 'unverified');
      byField[f][t] = (byField[f][t] || 0) + 1;
    });
  });
  const pct = function (n) { return rows ? (n / rows * 100).toFixed(1) + '%' : '0%'; };
  const msg = 'VERIFICATION PROGRESS\n\n' +
    'rows (products x lanes): ' + rows + '\n\n' +
    '── by row ──\n' +
    Object.keys(byTrust).sort().map(function (k) {
      return '   ' + k + ': ' + byTrust[k] + '  (' + pct(byTrust[k]) + ')';
    }).join('\n') +
    '\n\n── by field ──\n' +
    ['cost', 'transport', 'packing', 'selling'].map(function (f) {
      const v = byField[f].verified || 0;
      const g = byField[f].guessed || 0;
      const b = byField[f].book || 0;
      return '   ' + f + ': ' + v + ' verified, ' + g + ' guessed, ' + b + ' book';
    }).join('\n') +
    '\n\nA row is only as trustworthy as its weakest field.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenPricingImport() {
  SpreadsheetApp.getUi()
    .createMenu('📥 Pricing Import')
    .addItem('Preview changes', 'previewWorkableFile')
    .addItem('Import using VPI_FILE_ID', 'importWorkableNow')
    .addSeparator()
    .addItem('Verification progress', 'verifyProgress')
    .addToUi();
}