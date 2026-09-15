/**********************************************************************
 * VITHYA TRADERS — RECEIVABLES
 *
 * Globals declared here (check before pasting):
 *   RCV, RCV_FILE_ID, RCV_RECEIPT_COLS, RCV_ALLOC_COLS, importReceipts,
 *   importReceiptsNow, importReceiptsPrompt,
 *   buildAllocation, allocationSummary, markAllocated, collectionList,
 *   rcvNum_, rcvDate_, rcvKey_, rcvRead_, rcvSheet_, onOpenReceivables
 *
 * ── THE PROBLEM ──
 *   Your Vasy outstanding export nets to Rs 1.37 crore across 657 parties.
 *   Of Rs 5.36 crore in receipts, Rs 2.21 crore (41%) is NOT allocated to any
 *   invoice — Rs 1.68 cr "On Account" and Rs 0.52 cr "Advance Payment".
 *
 *   So the PARTY-level balance is already correct: Vasy's ledger credits those
 *   receipts. What is wrong is the INVOICE-level view — Rs 2.21 crore is not
 *   attached to specific bills, so ageing is distorted and you cannot tell
 *   which invoices are genuinely overdue. That is what drives collection calls.
 *
 * ── WHAT THIS DOES ──
 *   1. importReceipts(fileId)  reads your Vasy receipts export
 *   2. buildAllocation()       per party, lines up unallocated receipts against
 *                              open invoices and proposes matches
 *   3. you allocate IN VASY; the next pull reflects it and the worklist shrinks
 *
 * ── THE MATCHING, AND ITS LIMIT ──
 *   Receipts carry only a party NAME. Invoices carry a contactId AND a name.
 *   So matching is by normalised name, and the leading "." that marks your
 *   non-GST accounts is preserved — ". A2Z PUMPS" and "A2Z PUMPS" are two
 *   different accounts and must not be merged.
 *
 *   Where a name cannot be matched, the row is reported as UNMATCHED rather
 *   than guessed at. A wrong allocation is worse than none.
 *
 *   Proposals are ranked: exact single-invoice match, then an exact
 *   combination of two, then oldest-first partial. Nothing is ever written to
 *   Vasy — this produces a worklist, and Vasy stays the master.
 *
 * ── RUN ──
 *   importReceiptsNow()        after setting RCV_FILE_ID at the top of this file
 *   importReceiptsPrompt()     same thing, but only from the sheet menu
 *   buildAllocation()          build the worklist
 *   collectionList()           who to chase, ranked
 **********************************************************************/

const RCV = {
  RECEIPTS: 'Receipts',
  INVOICES: 'Sales_Invoices',
  OUTSTANDING: 'Customer_Outstanding',
  ALLOC: 'Allocation_Worklist',
  MATCH_TOL: 1,          // rupees; anything closer is treated as exact
};

const RCV_RECEIPT_COLS = ['receipt_no', 'party_name', 'party_key', 'mode', 'type',
  'date', 'amount', 'status', 'created_by', 'allocated'];

const RCV_ALLOC_COLS = ['party_key', 'party_name', 'lane', 'unallocated_amount',
  'receipts', 'open_invoices', 'open_amount', 'confidence', 'proposal',
  'receipt_list', 'invoice_list', 'status', 'note'];

function rcvNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }

function rcvDate_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  /* Vasy exports often use dd-MM-yyyy or dd/MM/yyyy */
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) {
    return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  }
  return s.slice(0, 10);
}

/**
 * The match key. Case, spacing and punctuation are normalised, but a LEADING
 * DOT is preserved as "wo:" because it marks your non-GST accounts —
 * ". A2Z PUMPS" and "A2Z PUMPS" are different ledgers and must not merge.
 */
function rcvKey_(name) {
  let s = String(name || '').trim();
  if (!s) return '';
  const wo = s.charAt(0) === '.';
  if (wo) s = s.slice(1);
  s = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (wo ? 'wo:' : 'w:') + s;
}

function rcvRead_(ss, name, key) {
  const sh = vtSheet(name) || ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return null;
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  if (key && H[key] === undefined) return null;
  return { sh: sh, H: H,
    rows: sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues() };
}

function rcvSheet_(name, cols, bg) {
  const ss = txnBook_();
  let sh = ss.getSheetByName(name);
  if (sh) {
    const w = sh.getLastColumn();
    const hdr = w ? sh.getRange(1, 1, 1, w).getValues()[0]
      .map(function (x) { return String(x).trim(); }) : [];
    const same = hdr.length === cols.length &&
      cols.every(function (c, i) { return hdr[i] === c; });
    if (!same) {
      if (sh.getLastRow() > 1) {
        sh.setName(name + '_old_' + Utilities.formatDate(new Date(),
          Session.getScriptTimeZone(), 'yyyyMMdd_HHmm'));
        sh = null;
      } else sh.clear();
    }
  }
  if (!sh) {
    try { sh = ss.insertSheet(name); }
    catch (e) { sh = ss.getSheetByName(name); if (!sh) throw e; sh.clear(); }
  }
  sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold')
    .setBackground(bg || '#CC3018').setFontColor('#FFFFFF').setWrap(true);
  return sh;
}

/* ================= 1. import the receipts export ================= */

/**
 * Reads the Vasy receipts export.
 *
 * IMPORTANT: point this at a GOOGLE SHEET, not a raw .xlsx.
 *   In Drive, open the exported file — Drive shows it in Sheets — then use
 *   File > Save as Google Sheets, and copy THAT file's id.
 *
 * Why: reading a raw .xlsx needs DriveApp plus the Drive advanced service, and
 * an unauthorised DriveApp call fails with an unhelpful
 * "Unexpected error while getting the method or property getFileById".
 * SpreadsheetApp alone needs no extra scope, so this uses only that.
 *
 * Accepts either a bare file id or a pasted URL.
 */
function importReceipts(fileId) {
  let id = String(fileId || '').trim();
  if (!id) throw new Error('No file id given.');

  /* accept a pasted URL */
  const m = id.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) id = m[1];
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) {
    throw new Error('That does not look like a Drive file id.\n\n' +
      'Open the file in Drive and copy the long code from the URL between ' +
      '/d/ and /edit.\n\nGot: ' + id.slice(0, 60));
  }

  let src;
  try {
    src = SpreadsheetApp.openById(id).getSheets()[0];
  } catch (e) {
    throw new Error('Could not open that file as a Google Sheet.\n\n' +
      'If it is still an .xlsx, open it in Drive and use\n' +
      '   File > Save as Google Sheets\n' +
      'then use the id of the new Sheet.\n\nDrive said: ' + e.message);
  }

  const vals = src.getDataRange().getValues();
  if (vals.length < 3) throw new Error('That sheet has almost no rows.');

  /* the export carries a two-line title band above the real header */
  let hRow = -1;
  for (let i = 0; i < Math.min(vals.length, 12); i++) {
    const j = vals[i].map(function (x) { return String(x).trim().toLowerCase(); });
    if (j.indexOf('receipt no.') >= 0 || j.indexOf('receipt no') >= 0) { hRow = i; break; }
  }
  if (hRow < 0) {
    throw new Error('No "Receipt No." header found in the first 12 rows.\n\n' +
      'Row 1 reads: ' + vals[0].slice(0, 6).join(' | ').slice(0, 120));
  }

  const H = {};
  vals[hRow].forEach(function (h, i) {
    const k = String(h).trim().toLowerCase().replace(/\.$/, '');
    if (k) H[k] = i;
  });
  const need = ['receipt no', 'party name', 'type', 'date', 'amount'];
  const missing = need.filter(function (k) { return H[k] === undefined; });
  if (missing.length) {
    throw new Error('Columns not found: ' + missing.join(', ') +
      '\n\nHeader row reads: ' + vals[hRow].join(' | ').slice(0, 160));
  }

  const out = [];
  for (let i = hRow + 1; i < vals.length; i++) {
    const r = vals[i];
    const no = String(r[H['receipt no']] || '').trim();
    if (!no) continue;
    const party = String(r[H['party name']] || '').trim();
    const type = String(r[H['type']] || '').trim();
    const named = party && party !== '-';
    out.push([no, party, named ? rcvKey_(party) : '',
      H['mode'] !== undefined ? String(r[H['mode']] || '').trim() : '', type,
      rcvDate_(r[H['date']]), rcvNum_(r[H['amount']]),
      H['status'] !== undefined ? String(r[H['status']] || '').trim() : '',
      H['created by'] !== undefined ? String(r[H['created by']] || '').trim() : '',
      /* "Against Bill" is already tied to invoices; the rest is not */
      /^against bill$/i.test(type) ? 'yes' : 'no']);
  }
  if (!out.length) throw new Error('No receipt rows found below the header.');

  const sh = rcvSheet_(RCV.RECEIPTS, RCV_RECEIPT_COLS, '#6C6C60');
  const B = 3000;
  for (let i = 0; i < out.length; i += B) {
    const blk = out.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, RCV_RECEIPT_COLS.length).setValues(blk);
  }

  const byType = {}; let unalloc = 0, total = 0, noParty = 0;
  out.forEach(function (r) {
    byType[r[4]] = (byType[r[4]] || 0) + rcvNum_(r[6]);
    total += rcvNum_(r[6]);
    if (r[9] === 'no') unalloc += rcvNum_(r[6]);
    if (!r[2]) noParty++;
  });
  const msg = 'RECEIPTS IMPORTED\n\n' +
    'rows: ' + out.length + '\n' +
    'total: Rs ' + Math.round(total).toLocaleString('en-IN') + '\n\n' +
    Object.keys(byType).sort().map(function (k) {
      return '   ' + k + ': Rs ' + Math.round(byType[k]).toLocaleString('en-IN');
    }).join('\n') +
    '\n\nUNALLOCATED: Rs ' + Math.round(unalloc).toLocaleString('en-IN') +
    '\nwalk-in receipts with no party: ' + noParty + '  (excluded from matching)' +
    '\n\nNext: buildAllocation()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return out.length;
}

/* ── PASTE YOUR FILE ID HERE, then run importReceiptsNow ──
   Upload the Vasy receipts export to Drive, open it, and copy the long code
   from the URL between /d/ and /edit.
   This exists because SpreadsheetApp.getUi() only works when the spreadsheet
   UI is open — from the editor's Run button there is no dialog to show. */
const RCV_FILE_ID = '1DBwPZcSCpdxv565XWEl7a5OYW38Ndd1Fm2T4NzvmOb8';

function importReceiptsNow() {
  const id = String(RCV_FILE_ID || '').trim();
  if (!id || id.indexOf('PASTE') === 0) {
    throw new Error('Edit RCV_FILE_ID at the top of Receivables.gs first, ' +
      'then run this again.');
  }
  return importReceipts(id);
}

/* menu version — only works from the sheet, not the editor */
function importReceiptsPrompt() {
  let ui;
  try { ui = SpreadsheetApp.getUi(); }
  catch (e) {
    throw new Error('This one needs the spreadsheet open. From the editor, ' +
      'set RCV_FILE_ID at the top of this file and run importReceiptsNow instead.');
  }
  const r = ui.prompt('Import receipts',
    'Upload the Vasy receipts export to Drive, open it, and paste the file id\n' +
    '(the long code in the URL between /d/ and /edit).',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const id = r.getResponseText().trim();
  if (id) importReceipts(id);
}

/* ================= 2. the allocation worklist ================= */

function buildAllocation() {
  const txn = txnBook_();
  const rc = rcvRead_(txn, RCV.RECEIPTS, 'receipt_no');
  if (!rc) throw new Error('No receipts imported — run importReceiptsNow() first.');

  /* invoices may be split across per-year workbooks */
  let inv = null;
  try { inv = readSalesAcrossYears(RCV.INVOICES); } catch (e) { inv = null; }
  if (!inv || !inv.rows.length) inv = rcvRead_(txn, RCV.INVOICES, 'salesId');
  if (!inv) throw new Error('Sales_Invoices is empty.');
  const IH = inv.H;

  /* unallocated receipts, by party */
  const byParty = {};
  rc.rows.forEach(function (r) {
    if (String(r[rc.H.allocated]) !== 'no') return;
    const key = String(r[rc.H.party_key] || '').trim();
    if (!key) return;                       // walk-in, nothing to allocate
    if (!byParty[key]) byParty[key] = { name: String(r[rc.H.party_name] || ''),
      receipts: [], amount: 0 };
    const amt = rcvNum_(r[rc.H.amount]);
    byParty[key].receipts.push({ no: String(r[rc.H.receipt_no]),
      date: rcvDate_(r[rc.H.date]), amount: amt, type: String(r[rc.H.type]) });
    byParty[key].amount += amt;
  });

  /* open invoices, by party, oldest first */
  const openInv = {};
  inv.rows.forEach(function (r) {
    const bal = rcvNum_(r[IH.balance]);
    if (bal <= 0.5) return;
    const name = String(r[IH.customerName] || '').trim();
    if (!name) return;
    const key = rcvKey_(name);
    if (!openInv[key]) openInv[key] = [];
    openInv[key].push({
      no: String(r[IH.prefix] || '') + String(r[IH.salesNo] || ''),
      date: rcvDate_(r[IH.salesDate]), due: rcvDate_(r[IH.dueDate]),
      balance: bal,
    });
  });
  Object.keys(openInv).forEach(function (k) {
    openInv[k].sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  });

  const out = [];
  let matched = 0, unmatched = 0, partial = 0;

  Object.keys(byParty).forEach(function (key) {
    const p = byParty[key];
    const invs = openInv[key] || [];
    const lane = key.indexOf('wo:') === 0 ? 'WO' : 'W';
    const openAmt = invs.reduce(function (s, x) { return s + x.balance; }, 0);

    let confidence = '', proposal = '';
    if (!invs.length) {
      confidence = 'unmatched';
      proposal = 'no open invoice for this party — the money may already be ' +
        'applied, or the name differs between the two systems';
      unmatched++;
    } else {
      let hit = null;
      for (let i = 0; i < invs.length; i++) {
        if (Math.abs(invs[i].balance - p.amount) <= RCV.MATCH_TOL) { hit = [invs[i]]; break; }
      }
      if (!hit) {
        outer:
        for (let i = 0; i < invs.length && i < 25; i++) {
          for (let j = i + 1; j < invs.length && j < 25; j++) {
            if (Math.abs(invs[i].balance + invs[j].balance - p.amount) <= RCV.MATCH_TOL) {
              hit = [invs[i], invs[j]]; break outer;
            }
          }
        }
      }
      if (hit) {
        confidence = hit.length === 1 ? 'exact' : 'exact pair';
        proposal = 'apply to ' + hit.map(function (x) { return x.no; }).join(' + ');
        matched++;
      } else {
        let left = p.amount;
        const take = [];
        for (let i = 0; i < invs.length && left > 0.5; i++) {
          take.push(invs[i].no + (invs[i].balance <= left ? '' :
            ' (part ' + Math.round(left) + ')'));
          left -= invs[i].balance;
        }
        confidence = left > 0.5 ? 'excess' : 'oldest first';
        proposal = 'apply oldest first: ' + take.slice(0, 6).join(', ') +
          (take.length > 6 ? ' …' : '') +
          (left > 0.5 ? '  — Rs ' + Math.round(left) + ' still left over' : '');
        partial++;
      }
    }

    out.push([key, p.name, lane, Math.round(p.amount * 100) / 100,
      p.receipts.length, invs.length, Math.round(openAmt * 100) / 100,
      confidence, proposal,
      p.receipts.slice(0, 8).map(function (x) {
        return x.no + ' ' + x.date + ' ' + Math.round(x.amount);
      }).join(' | '),
      invs.slice(0, 8).map(function (x) {
        return x.no + ' ' + x.date + ' ' + Math.round(x.balance);
      }).join(' | '),
      'open', '']);
  });

  out.sort(function (a, b) { return b[3] - a[3]; });

  const sh = rcvSheet_(RCV.ALLOC, RCV_ALLOC_COLS, '#CC3018');
  const B = 2000;
  for (let i = 0; i < out.length; i += B) {
    const blk = out.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, RCV_ALLOC_COLS.length).setValues(blk);
  }
  sh.setColumnWidth(2, 240);
  sh.setColumnWidth(9, 380);

  const totalUn = out.reduce(function (s, r) { return s + r[3]; }, 0);
  const exactAmt = out.filter(function (r) { return r[7].indexOf('exact') === 0; })
    .reduce(function (s, r) { return s + r[3]; }, 0);
  const msg = 'ALLOCATION WORKLIST\n\n' +
    'parties with unallocated money: ' + out.length + '\n' +
    'total unallocated: Rs ' + Math.round(totalUn).toLocaleString('en-IN') + '\n\n' +
    '   exact match:   ' + matched + '  (Rs ' + Math.round(exactAmt).toLocaleString('en-IN') + ')\n' +
    '   oldest-first:  ' + partial + '\n' +
    '   no open bill:  ' + unmatched + '\n\n' +
    'Now that invoices are pulled, the proposals name ACTUAL BILL NUMBERS.\n' +
    'Start with the exact matches — they are unambiguous.\n' +
    'Allocate in Vasy; the next pull shrinks this list on its own.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return out.length;
}

function markAllocated(partyKey, note) {
  const txn = txnBook_();
  const a = rcvRead_(txn, RCV.ALLOC, 'party_key');
  if (!a) throw new Error('No worklist.');
  const k = String(partyKey || '').trim();
  for (let i = 0; i < a.rows.length; i++) {
    if (String(a.rows[i][a.H.party_key]).trim() === k) {
      a.sh.getRange(i + 2, a.H.status + 1).setValue('done');
      a.sh.getRange(i + 2, a.H.note + 1).setValue(note || '');
      return { ok: true };
    }
  }
  throw new Error('Not on the worklist: ' + k);
}

/* ================= 3. who to chase ================= */

function collectionList(limit) {
  const txn = txnBook_();
  const o = rcvRead_(txn, RCV.OUTSTANDING, 'contactId');
  if (!o) throw new Error('Customer_Outstanding is empty — it builds at 22:00, ' +
    'or run buildOutstanding() now.');

  const rows = [];
  o.rows.forEach(function (r) {
    const bal = rcvNum_(r[o.H.outstanding]);
    if (bal <= 0.5) return;
    const b90 = rcvNum_(r[o.H.age_90_plus]);
    const b60 = rcvNum_(r[o.H.age_61_90]);
    /* chase on overdue money, not on total exposure — a big customer paying
       on time is not a collection problem */
    const score = b90 * 3 + b60 * 1.5 + rcvNum_(r[o.H.age_31_60]);
    rows.push({
      name: String(r[o.H.customerName] || ''), lane: String(r[o.H.lane] || ''),
      outstanding: bal, over90: b90, oldest: rcvNum_(r[o.H.oldest_days]),
      openInv: rcvNum_(r[o.H.open_invoices]), score: score,
    });
  });
  rows.sort(function (a, b) { return b.score - a.score; });

  const top = rows.slice(0, limit || 25);
  const total = rows.reduce(function (s, x) { return s + x.outstanding; }, 0);
  const t90 = rows.reduce(function (s, x) { return s + x.over90; }, 0);
  const msg = 'COLLECTION PRIORITY\n\n' +
    'customers owing: ' + rows.length + '\n' +
    'total: Rs ' + Math.round(total).toLocaleString('en-IN') + '\n' +
    'over 90 days: Rs ' + Math.round(t90).toLocaleString('en-IN') +
    (total ? '  (' + (t90 / total * 100).toFixed(1) + '%)' : '') + '\n\n' +
    top.slice(0, 15).map(function (x) {
      return '   ' + (x.name || '(no name)').slice(0, 30) +
        '  Rs ' + Math.round(x.outstanding).toLocaleString('en-IN') +
        (x.over90 > 0 ? '   90+: Rs ' + Math.round(x.over90).toLocaleString('en-IN') : '') +
        '   oldest ' + x.oldest + 'd';
    }).join('\n') +
    '\n\nRanked on OVERDUE money, not total exposure — a large customer who\n' +
    'pays on time is not a collection problem.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return top;
}

function allocationSummary() {
  const txn = txnBook_();
  const a = rcvRead_(txn, RCV.ALLOC, 'party_key');
  if (!a) { try { SpreadsheetApp.getUi().alert('No worklist yet.'); } catch (e) {} return; }
  const byConf = {}; let open = 0, done = 0, openAmt = 0;
  a.rows.forEach(function (r) {
    const c = String(r[a.H.confidence] || '?');
    const st = String(r[a.H.status] || 'open');
    byConf[c] = (byConf[c] || 0) + 1;
    if (st === 'done') done++; else { open++; openAmt += rcvNum_(r[a.H.unallocated_amount]); }
  });
  const msg = 'ALLOCATION PROGRESS\n\n' +
    'open: ' + open + '  (Rs ' + Math.round(openAmt).toLocaleString('en-IN') + ')\n' +
    'done: ' + done + '\n\n' +
    Object.keys(byConf).sort().map(function (k) {
      return '   ' + k + ': ' + byConf[k];
    }).join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenReceivables() {
  SpreadsheetApp.getUi()
    .createMenu('💰 Receivables')
    .addItem('Import receipts export', 'importReceiptsPrompt')
    .addItem('Import using RCV_FILE_ID', 'importReceiptsNow')
    .addItem('Build allocation worklist', 'buildAllocation')
    .addSeparator()
    .addItem('Collection priority', 'collectionList')
    .addItem('Allocation progress', 'allocationSummary')
    .addToUi();
}