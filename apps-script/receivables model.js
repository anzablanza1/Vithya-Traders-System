/**********************************************************************
 * VITHYA TRADERS — RECEIVABLES MODEL
 *
 * Globals declared here (check before pasting):
 *   RM2, RM2_CUST, RM2_INV, RM2_RCPT, RM2_ALLOC,
 *   setupReceivablesBook, buildReceivablesModel, receivablesModelStatus,
 *   customerLedger, rm2Num_, rm2Date_, rm2Read_, rm2Sheet_, rm2Book_,
 *   onOpenReceivablesModel
 *
 * ── THE SHAPE OF THE PROBLEM ──
 *   One receipt can settle several invoices. One invoice can be settled by
 *   several receipts. That is many-to-many, so it needs a junction table —
 *   everything else hangs off it.
 *
 *       Rcv_Customers    one row per party      the ledger position
 *       Rcv_Invoices     one row per invoice    what was billed
 *       Rcv_Receipts     one row per receipt    what arrived
 *       Rcv_Allocations  receipt x invoice      WHICH money paid WHICH bill
 *
 *   Ask "show me this customer" and you walk: customer -> their invoices ->
 *   the allocations on each -> the receipts behind those. Ask "show me this
 *   receipt" and you walk the same edges the other way. One structure, both
 *   questions.
 *
 * ── WHERE EACH FACT COMES FROM ──
 *   Rcv_Invoices      Sales_Invoices        API, nightly
 *   Rcv_Receipts      Receipts              your Vasy export, uploaded
 *   Rcv_Allocations   Receipt_Links         API, /api/v1/sales/{id}
 *   Rcv_Customers     Customer_Outstanding  your ledger export + derived
 *
 *   The ledger export is authoritative for the BALANCE. The API is
 *   authoritative for the LINKS. Neither replaces the other, and where they
 *   disagree the model says so rather than picking a winner.
 *
 * ── ITS OWN WORKBOOK ──
 *   VT_Receivables. Receivables will grow — every receipt, every allocation,
 *   forever — and it has no business competing for cells with sales lines.
 *
 * ── RUN ──
 *   setupReceivablesBook()      once
 *   buildReceivablesModel()     after any pull or upload
 *   customerLedger('A2Z')       everything about one customer, in the log
 **********************************************************************/

const RM2 = {
  BOOK_PROP: 'VT_RECEIVABLES_BOOK_ID',
  CUST: 'Rcv_Customers',
  INV: 'Rcv_Invoices',
  RCPT: 'Rcv_Receipts',
  ALLOC: 'Rcv_Allocations',

  SRC_INV: 'Sales_Invoices',
  SRC_RCPT: 'Receipts',
  SRC_LINK: 'Receipt_Links',
  SRC_LEDGER: 'Customer_Outstanding',
};

const RM2_CUST = ['party_key', 'customer', 'lane', 'contact_id',
  'opening_balance', 'billed', 'received', 'closing_balance',
  'invoices', 'open_invoices', 'invoiced_total', 'invoice_open_total',
  'receipts', 'receipt_total', 'allocated_total', 'unallocated_total',
  'oldest_open_days', 'ledger_vs_invoice_gap', 'status'];

const RM2_INV = ['sales_id', 'invoice_no', 'invoice_date', 'due_date', 'fy',
  'party_key', 'customer', 'total', 'paid', 'balance',
  'receipt_count', 'receipt_nos', 'status'];

const RM2_RCPT = ['receipt_no', 'receipt_id', 'receipt_date', 'party_key',
  'customer', 'amount', 'mode', 'type', 'allocated_amount', 'unallocated_amount',
  'invoice_count', 'invoice_nos', 'status'];

const RM2_ALLOC = ['receipt_no', 'receipt_id', 'sales_id', 'invoice_no',
  'party_key', 'customer', 'amount', 'receipt_date', 'invoice_date', 'source'];

function rm2Num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function rm2Date_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  let m = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return s.slice(0, 10);
}
function rm2Days_(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return Math.floor((new Date() - d) / 86400000);
}

/* ---------- the workbook ---------- */

function rm2Book_() {
  const id = PropertiesService.getScriptProperties().getProperty(RM2.BOOK_PROP);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* stale */ }
  }
  return txnBook_();
}

function setupReceivablesBook() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty(RM2.BOOK_PROP);
  if (existing) {
    try {
      const ss = SpreadsheetApp.openById(existing);
      try { SpreadsheetApp.getUi().alert('Already linked:\n\n' + ss.getName() +
        '\n' + ss.getUrl()); } catch (e) {}
      return existing;
    } catch (e) { /* make a new one */ }
  }
  const ss = SpreadsheetApp.create('VT_Receivables');
  const f = ss.getSheets()[0];
  f.setName('README');
  f.getRange(1, 1, 10, 1).setValues([
    ['VT_Receivables'], [''],
    ['Four tables, because receipts and invoices are many-to-many:'],
    ['   Rcv_Customers    the ledger position per party'],
    ['   Rcv_Invoices     what was billed'],
    ['   Rcv_Receipts     what arrived'],
    ['   Rcv_Allocations  which receipt paid which invoice'],
    [''],
    ['Rebuilt by buildReceivablesModel(). Every row is derived —'],
    ['nothing here is typed by hand.'],
  ]);
  f.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  props.setProperty(RM2.BOOK_PROP, ss.getId());
  try { registerBook('receivables', ss.getId()); } catch (e) {}
  const msg = 'Created VT_Receivables\n\n' + ss.getUrl() +
    '\n\nReceivables grows forever — every receipt, every allocation. It has\n' +
    'no business competing for cells with sales lines.\n\nNext: buildReceivablesModel()';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return ss.getId();
}

function rm2Sheet_(name, cols) {
  const ss = rm2Book_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  if (sh.getMaxColumns() < cols.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold')
    .setBackground('#CC3018').setFontColor('#FFFFFF').setWrap(true);
  return sh;
}

function rm2Write_(sh, rows, cols) {
  if (!rows.length) return;
  const want = rows.length + 10;
  if (sh.getMaxRows() < want) sh.insertRowsAfter(sh.getMaxRows(), want - sh.getMaxRows());
  const B = 3000;
  for (let i = 0; i < rows.length; i += B) {
    const blk = rows.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, cols.length).setValues(blk);
  }
}

function rm2Read_(name) {
  let d = null;
  try { d = readSalesAcrossYears(name); } catch (e) { d = null; }
  if (d && d.rows && d.rows.length) return d;
  const sh = vtSheet(name);
  if (!sh || sh.getLastRow() < 2) return null;
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  return { H: H, rows: sh.getRange(2, 1, sh.getLastRow() - 1,
    sh.getLastColumn()).getValues() };
}

/* ---------- build ---------- */

function buildReceivablesModel() {
  const t0 = Date.now();
  const notes = [];

  const invSrc = rm2Read_(RM2.SRC_INV);
  if (!invSrc) throw new Error('Sales_Invoices is empty — pull invoices first.');
  const rcptSrc = rm2Read_(RM2.SRC_RCPT);
  if (!rcptSrc) notes.push('Receipts not uploaded — receipt rows will be missing.');
  const linkSrc = rm2Read_(RM2.SRC_LINK);
  if (!linkSrc) notes.push('Receipt_Links not pulled — allocations will be empty.');
  const ledSrc = rm2Read_(RM2.SRC_LEDGER);

  /* ── allocations: the junction, straight from the API ── */
  const alloc = [];
  const allocByReceipt = {}, allocByInvoice = {};
  if (linkSrc) {
    const LH = linkSrc.H;
    linkSrc.rows.forEach(function (r) {
      const rno = String(r[LH.receipt_no] || '').trim();
      const sid = String(r[LH.salesId] || '').trim();
      if (!rno || !sid) return;
      const amt = rm2Num_(r[LH.receipt_amount]);
      const pk = String(r[LH.party_key] || '');
      const row = [rno, r[LH.receipt_id] || '', sid,
        String(r[LH.invoice_no] || ''), pk, String(r[LH.customer] || ''),
        amt, rm2Date_(r[LH.receipt_date]), rm2Date_(r[LH.invoice_date]), 'api'];
      alloc.push(row);
      (allocByReceipt[rno] = allocByReceipt[rno] || []).push({ sid: sid,
        no: String(r[LH.invoice_no] || ''), amt: amt });
      (allocByInvoice[sid] = allocByInvoice[sid] || []).push({ rno: rno, amt: amt });
    });
  }

  /* ── invoices ── */
  const IH = invSrc.H;
  const invRows = [], invByParty = {};
  invSrc.rows.forEach(function (r) {
    const sid = String(r[IH.salesId] || '').trim();
    if (!sid) return;
    const name = String(r[IH.customerName] || '').trim();
    const cid = rm2Num_(r[IH.contactId]);
    if (cid <= 0 && !name) return;                 // walk-in cash, no receivable
    const pk = rcvKey_(name);
    const date = rm2Date_(r[IH.salesDate]);
    const total = rm2Num_(r[IH.total]);
    const paid = rm2Num_(r[IH.paidAmount]);
    const bal = rm2Num_(r[IH.balance]);
    const links = allocByInvoice[sid] || [];
    const status = bal <= 0.5 ? 'settled' : (paid > 0.5 ? 'part paid' : 'open');
    invRows.push([sid, String(r[IH.prefix] || '') + String(r[IH.salesNo] || ''),
      date, rm2Date_(r[IH.dueDate]), syFY(date), pk, name,
      total, paid, bal, links.length,
      links.map(function (x) { return x.rno; }).slice(0, 8).join(', '), status]);
    if (!invByParty[pk]) invByParty[pk] = { name: name, cid: cid, n: 0, open: 0,
      total: 0, openTotal: 0, oldest: '' };
    const a = invByParty[pk];
    a.n++; a.total += total;
    if (!a.name && name) a.name = name;
    if (a.cid <= 0 && cid > 0) a.cid = cid;
    if (bal > 0.5) {
      a.open++; a.openTotal += bal;
      if (!a.oldest || date < a.oldest) a.oldest = date;
    }
  });

  /* ── receipts ── */
  const rcptRows = [], rcptByParty = {};
  let joinHit = 0, joinMiss = 0;
  if (rcptSrc) {
    const RH = rcptSrc.H;
    rcptSrc.rows.forEach(function (r) {
      const rno = String(r[RH.receipt_no] || '').trim();
      if (!rno) return;
      const name = String(r[RH.party_name] || '').trim();
      if (!name || name === '-') return;            // walk-in
      const pk = String(r[RH.party_key] || '') || rcvKey_(name);
      const amt = rm2Num_(r[RH.amount]);
      const links = allocByReceipt[rno] || [];
      const allocAmt = links.reduce(function (s, x) { return s + x.amt; }, 0);
      if (links.length) joinHit++; else joinMiss++;
      const unalloc = Math.round((amt - Math.min(allocAmt, amt)) * 100) / 100;
      const type = String(r[RH.type] || '');
      const status = links.length ? 'allocated' :
        (/against bill/i.test(type) ? 'tied in vasy, link not pulled' : 'unallocated');
      rcptRows.push([rno, links.length ? (links[0].id || '') : '',
        rm2Date_(r[RH.date]), pk, name, amt,
        String(r[RH.mode] || ''), type,
        Math.round(Math.min(allocAmt, amt) * 100) / 100, unalloc,
        links.length,
        links.map(function (x) { return x.no; }).slice(0, 8).join(', '), status]);
      if (!rcptByParty[pk]) rcptByParty[pk] = { n: 0, total: 0, alloc: 0, unalloc: 0 };
      const a = rcptByParty[pk];
      a.n++; a.total += amt; a.alloc += Math.min(allocAmt, amt); a.unalloc += unalloc;
    });
  }

  /* ── customers ── */
  const led = {};
  if (ledSrc) {
    const CH = ledSrc.H;
    ledSrc.rows.forEach(function (r) {
      const name = String(r[CH.customerName] || r[CH['Party Name']] || '').trim();
      if (!name) return;
      led[rcvKey_(name)] = {
        name: name,
        open: rm2Num_(r[CH.opening_balance] || r[CH['Opening Balance']]),
        billed: rm2Num_(r[CH.total_billed] || r[CH.Debit]),
        recv: rm2Num_(r[CH.total_paid] || r[CH.Credit]),
        close: rm2Num_(r[CH.outstanding] || r[CH.Closing]),
      };
    });
  }

  const keys = {};
  Object.keys(invByParty).forEach(function (k) { keys[k] = 1; });
  Object.keys(rcptByParty).forEach(function (k) { keys[k] = 1; });
  Object.keys(led).forEach(function (k) { keys[k] = 1; });

  const custRows = Object.keys(keys).map(function (k) {
    const i = invByParty[k] || { name: '', cid: '', n: 0, open: 0, total: 0,
      openTotal: 0, oldest: '' };
    const rr = rcptByParty[k] || { n: 0, total: 0, alloc: 0, unalloc: 0 };
    const l = led[k] || null;
    const name = i.name || (l && l.name) || '';
    const lane = k.indexOf('wo:') === 0 ? 'WO' : 'W';
    const gap = l ? Math.round((i.openTotal - l.close) * 100) / 100 : '';
    let status;
    if (!l) status = 'not in ledger';
    else if (l.close < -0.5) status = 'credit balance';
    else if (rr.unalloc > 0.5 && i.openTotal > 0.5) status = 'needs allocation';
    else if (rr.unalloc > 0.5) status = 'money with no open bill';
    else if (i.openTotal > 0.5) status = 'genuinely owed';
    else status = 'square';
    return [k, name, lane, i.cid || '',
      l ? l.open : '', l ? l.billed : '', l ? l.recv : '', l ? l.close : '',
      i.n, i.open, Math.round(i.total * 100) / 100,
      Math.round(i.openTotal * 100) / 100,
      rr.n, Math.round(rr.total * 100) / 100,
      Math.round(rr.alloc * 100) / 100, Math.round(rr.unalloc * 100) / 100,
      i.oldest ? rm2Days_(i.oldest) : '', gap, status];
  }).sort(function (a, b) { return rm2Num_(b[11]) - rm2Num_(a[11]); });

  /* ── write ── */
  rm2Write_(rm2Sheet_(RM2.CUST, RM2_CUST), custRows, RM2_CUST);
  rm2Write_(rm2Sheet_(RM2.INV, RM2_INV), invRows, RM2_INV);
  rm2Write_(rm2Sheet_(RM2.RCPT, RM2_RCPT), rcptRows, RM2_RCPT);
  rm2Write_(rm2Sheet_(RM2.ALLOC, RM2_ALLOC), alloc, RM2_ALLOC);

  try { regSet_(REG.MAP, {}); } catch (e) {}
  try { vtInvalidate(); } catch (e) {}

  const unalloc = custRows.reduce(function (s, r) { return s + rm2Num_(r[15]); }, 0);
  const owed = custRows.reduce(function (s, r) { return s + rm2Num_(r[11]); }, 0);
  const msg = 'RECEIVABLES MODEL BUILT  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    '   customers   : ' + custRows.length.toLocaleString() + '\n' +
    '   invoices    : ' + invRows.length.toLocaleString() + '\n' +
    '   receipts    : ' + rcptRows.length.toLocaleString() + '\n' +
    '   allocations : ' + alloc.length.toLocaleString() + '\n\n' +
    'receipt -> allocation join:\n' +
    '   matched   : ' + joinHit.toLocaleString() + '\n' +
    '   unmatched : ' + joinMiss.toLocaleString() +
      (joinMiss > joinHit && joinHit > 0 ?
        '   ⚠ check the receipt-number format in both sources' : '') + '\n\n' +
    'open invoice value : Rs ' + Math.round(owed).toLocaleString('en-IN') + '\n' +
    'unallocated money  : Rs ' + Math.round(unalloc).toLocaleString('en-IN') +
    (notes.length ? '\n\nNOT COMPLETE:\n   ' + notes.join('\n   ') : '');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return custRows.length;
}

/* ---------- one customer, everything ---------- */

function customerLedger(search) {
  const q = String(search || '').trim().toUpperCase();
  if (!q) throw new Error("customerLedger('A2Z')");
  const ss = rm2Book_();
  const rd = function (n) {
    const sh = ss.getSheetByName(n);
    if (!sh || sh.getLastRow() < 2) return { H: {}, rows: [] };
    const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const H = {};
    hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
    return { H: H, rows: sh.getRange(2, 1, sh.getLastRow() - 1,
      sh.getLastColumn()).getValues() };
  };
  const C = rd(RM2.CUST), I = rd(RM2.INV), R = rd(RM2.RCPT), A = rd(RM2.ALLOC);

  const hits = C.rows.filter(function (r) {
    return String(r[C.H.customer]).toUpperCase().indexOf(q) >= 0;
  });
  if (!hits.length) throw new Error('No customer matching "' + search + '"');
  if (hits.length > 5) {
    Logger.log(hits.length + ' matches — narrow the search:\n' +
      hits.slice(0, 20).map(function (r) { return '   ' + r[C.H.customer]; }).join('\n'));
    return;
  }

  hits.forEach(function (c) {
    const pk = String(c[C.H.party_key]);
    const inv = I.rows.filter(function (r) { return String(r[I.H.party_key]) === pk; });
    const rcpt = R.rows.filter(function (r) { return String(r[R.H.party_key]) === pk; });

    Logger.log('');
    Logger.log('════ ' + c[C.H.customer] + '  [' + c[C.H.lane] + '] ════');
    Logger.log('  ledger  opening ' + c[C.H.opening_balance] +
      '  billed ' + c[C.H.billed] + '  received ' + c[C.H.received] +
      '  closing ' + c[C.H.closing_balance]);
    Logger.log('  invoices ' + c[C.H.invoices] + ' (' + c[C.H.open_invoices] +
      ' open, Rs ' + c[C.H.invoice_open_total] + ')');
    Logger.log('  receipts ' + c[C.H.receipts] + '  allocated Rs ' +
      c[C.H.allocated_total] + '  UNALLOCATED Rs ' + c[C.H.unallocated_total]);
    Logger.log('  status: ' + c[C.H.status]);

    Logger.log('');
    Logger.log('  ── invoices ──');
    inv.slice(0, 25).forEach(function (r) {
      Logger.log('    ' + String(r[I.H.invoice_no]).padEnd(18) +
        r[I.H.invoice_date] + '  total ' + String(r[I.H.total]).padStart(10) +
        '  bal ' + String(r[I.H.balance]).padStart(10) +
        '  ' + r[I.H.status] +
        (r[I.H.receipt_nos] ? '   <- ' + r[I.H.receipt_nos] : ''));
    });

    Logger.log('');
    Logger.log('  ── receipts ──');
    rcpt.slice(0, 25).forEach(function (r) {
      Logger.log('    ' + String(r[R.H.receipt_no]).padEnd(14) +
        r[R.H.receipt_date] + '  ' + String(r[R.H.amount]).padStart(10) +
        '  ' + String(r[R.H.type]).padEnd(16) +
        '  unalloc ' + String(r[R.H.unallocated_amount]).padStart(9) +
        (r[R.H.invoice_nos] ? '   -> ' + r[R.H.invoice_nos] : ''));
    });
  });
}

function receivablesModelStatus() {
  const ss = rm2Book_();
  const lines = [RM2.CUST, RM2.INV, RM2.RCPT, RM2.ALLOC].map(function (n) {
    const sh = ss.getSheetByName(n);
    return '   ' + n + ': ' + (sh ? Math.max(0, sh.getLastRow() - 1).toLocaleString() : 0) + ' rows';
  });
  const msg = 'RECEIVABLES MODEL\n\n' + ss.getName() + '\n' + ss.getUrl() +
    '\n\n' + lines.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenReceivablesModel() {
  SpreadsheetApp.getUi()
    .createMenu('💰 Receivables Model')
    .addItem('Set up VT_Receivables', 'setupReceivablesBook')
    .addItem('Build model', 'buildReceivablesModel')
    .addItem('Status', 'receivablesModelStatus')
    .addToUi();
}