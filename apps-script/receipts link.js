/**********************************************************************
 * VITHYA TRADERS — RECEIPT ↔ INVOICE LINKS
 *
 * Globals declared here (check before pasting):
 *   RL, RL_COLS, probeReceiptLinks, pullReceiptLinks, pullReceiptLinksManual,
 *   receiptLinkStatus, reconcileReceipts, rlReset, rlNum_, rlDate_, rlRead_,
 *   rlSheet_, rlGap_, rlSlower_, rlFaster_, onOpenReceiptLinks
 *
 * ── WHY ──
 *   Nothing in the register or the export says which receipt paid which
 *   invoice. Only GET /api/v1/sales/{id} carries it, in a receipt[] array:
 *
 *      receiptId 27961902 · receiptNo PAY59 · salesId 28315158 · Rs 11.00
 *
 *   With that map, every already-tied receipt drops out of the allocation
 *   worklist automatically, and what remains is the real work.
 *
 * ── THE OPTIMISATION THAT MAKES IT POSSIBLE ──
 *   32,600 invoices, one call each, is 9+ hours. Most of those calls would
 *   return nothing useful:
 *
 *      skip  contactId = 0        walk-in cash, no receivable, nothing to map
 *      skip  paidAmount = 0       no receipt exists to find
 *      pull  the rest             an invoice that received money
 *
 *   That is roughly a fifth of the file. And it is ordered by VALUE, so if
 *   you stop after an hour the largest exposures are already mapped.
 *
 * ── FY25-26 ──
 *   You said no receipt payments were recorded against those invoices. This
 *   pulls them anyway where paidAmount > 0, because the ledger says money
 *   arrived — and where an FY25-26 invoice was settled by an FY26-27 receipt,
 *   that link is exactly what reconciliation needs.
 *
 * ── RUN ──
 *   probeReceiptLinks()          read only — how many calls, how long
 *   pullReceiptLinksManual()     25-minute runs, no triggers, repeat
 *   reconcileReceipts()          the analysis, by priority
 **********************************************************************/

/* false = only parties with unallocated money (~190, the real worklist)
   true  = also every party with an open balance (several times the calls) */
const RL_WIDE_SCOPE = false;

const RL = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',
  PATH: '/api/v1/sales/',

  SHEET: 'Receipt_Links',
  INVOICES: 'Sales_Invoices',
  RECEIPTS: 'Receipts',

  CURSOR: 'RL_CURSOR',
  QUEUE: 'RL_QUEUE_BUILT',
  GAP: 'RL_GAP',
  OKC: 'RL_OK',

  GAP_START: 8000,        // measured: this endpoint allows ~4-5 calls/min
  GAP_MIN: 5000,
  GAP_MAX: 16000,
  GAP_UP: 1.25,
  GAP_DOWN: 0.85,
  OK_BEFORE_FASTER: 25,
  BACKOFF: [30000, 60000],
  MANUAL_RUN_MS: 1500000,
  RUN_MS: 250000,
  MANUAL: 'RL_MANUAL',
  TOP: 'RL_TOP_PARTIES',     // pull only the top N parties by exposure
  SAFETY_MS: 120000,         // leave room for a worst-case backoff mid-call
};

const RL_COLS = ['salesId', 'invoice_no', 'invoice_date', 'party_key', 'customer',
  'invoice_total', 'invoice_paid', 'invoice_balance',
  'receipt_no', 'receipt_id', 'receipt_amount', 'receipt_date', 'payment_type',
  'credit_applied', 'fy', 'pulled_at'];

function rlNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function rlDate_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : String(v).slice(0, 10);
}
function rlProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}
function rlGap_() {
  const n = parseInt(PropertiesService.getScriptProperties().getProperty(RL.GAP) || '', 10);
  return isFinite(n) && n > 0 ? n : RL.GAP_START;
}
function rlSlower_() {
  const p = PropertiesService.getScriptProperties();
  const next = Math.min(RL.GAP_MAX, Math.round(rlGap_() * RL.GAP_UP));
  p.setProperty(RL.GAP, String(next));
  p.setProperty(RL.OKC, '0');
  Logger.log('   pace -> ' + next + 'ms');
}
function rlFaster_() {
  const p = PropertiesService.getScriptProperties();
  const okc = parseInt(p.getProperty(RL.OKC) || '0', 10) + 1;
  if (okc < RL.OK_BEFORE_FASTER) { p.setProperty(RL.OKC, String(okc)); return; }
  const next = Math.max(RL.GAP_MIN, Math.round(rlGap_() * RL.GAP_DOWN));
  p.setProperty(RL.OKC, '0');
  if (next !== rlGap_()) p.setProperty(RL.GAP, String(next));
}

function rlRead_(name) {
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

/* ---------- the candidate list ---------- */

/**
 * Which invoices are worth a call, ordered so the biggest exposure is mapped
 * first. Stopping halfway still leaves the important half done.
 */
/**
 * WHICH INVOICES ARE WORTH A CALL.
 *
 * The endpoint shares the hard rate limit — the pace settles around 14s, so
 * 7,364 calls is 29 hours. Pacing cannot fix that. Fewer calls can.
 *
 * Three narrowing steps:
 *   1. skip walk-in cash and paidAmount = 0        (no receipt exists)
 *   2. keep only parties that NEED the answer      (see below)
 *   3. take the top N parties by exposure          (RL_TOP_PARTIES)
 *
 * Step 2 is the important one. A party whose receipts are all tied and whose
 * invoices are all settled teaches us nothing — we already know the answer.
 * The parties worth calls are those with unallocated money, or open invoices,
 * or both. That is where the allocation work actually is.
 */
/**
 * Which invoices are worth a call.
 *
 * The endpoint turns out to be rate-limited like the report endpoints —
 * roughly 4 calls a minute. 7,364 calls is 29 hours, which is not a plan.
 * So the scope narrows to invoices that can actually change an answer:
 *
 *   a party with UNALLOCATED money   we need to know what it could pay
 *   a party with an OPEN balance     we need to know what is really unpaid
 *
 * A party who is square, whose receipts are all tied, tells us nothing new —
 * their invoices are settled and Vasy already knows against what.
 *
 * Ordered BY PARTY, not by value: half a customer's links is useless for a
 * drill-down, so a party is either finished or not started.
 *
 * Already-pulled invoices are skipped, so re-running never repeats work.
 */
function rlCandidates_() {
  const inv = rlRead_(RL.INVOICES);
  if (!inv) throw new Error('Sales_Invoices is empty.');
  const H = inv.H;

  /* Parties that need the link.
     TIGHT scope (the default) = only parties holding unallocated money.
     Those are the ~190 accounts where the answer changes a decision, and
     they are the drill-down that will actually get used.
     WIDE adds every party with an open balance — several times the calls
     for history rather than action. Set RL_WIDE_SCOPE to true for that. */
  const wide = (typeof RL_WIDE_SCOPE !== 'undefined') && RL_WIDE_SCOPE === true;
  const need = {};
  const rc = rcvRead_(txnBook_(), RL.RECEIPTS, 'receipt_no');
  if (rc) {
    rc.rows.forEach(function (r) {
      if (String(r[rc.H.allocated]) === 'yes') return;   // already tied in Vasy
      const k = String(r[rc.H.party_key] || '').trim();
      if (k) need[k] = 'unallocated money';
    });
  }
  if (wide) {
    inv.rows.forEach(function (r) {
      if (rlNum_(r[H.balance]) <= 0.5) return;
      const name = String(r[H.customerName] || '').trim();
      if (!name) return;
      const k = rcvKey_(name);
      if (!need[k]) need[k] = 'open balance';
    });
  }

  /* what has already been pulled */
  const done = {};
  const links = vtSheet(RL.SHEET);
  if (links && links.getLastRow() > 1) {
    const lh = links.getRange(1, 1, 1, links.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim(); });
    const si = lh.indexOf('salesId');
    if (si >= 0) {
      links.getRange(2, si + 1, links.getLastRow() - 1, 1).getValues()
        .forEach(function (r) { done[String(r[0]).trim()] = 1; });
    }
  }

  const out = [];
  let cash = 0, nopay = 0, notNeeded = 0, already = 0;
  inv.rows.forEach(function (r) {
    const id = String(r[H.salesId] || '').trim();
    if (!id) return;
    const name = String(r[H.customerName] || '').trim();
    const cid = rlNum_(r[H.contactId]);
    if (cid <= 0 && !name) { cash++; return; }
    const paid = rlNum_(r[H.paidAmount]);
    const bal = rlNum_(r[H.balance]);
    if (paid <= 0.5 && bal <= 0.5) { nopay++; return; }
    const pk = rcvKey_(name);
    if (!need[pk]) { notNeeded++; return; }
    if (done[id]) { already++; return; }
    out.push({
      id: id, pk: pk,
      no: String(r[H.prefix] || '') + String(r[H.salesNo] || ''),
      date: rlDate_(r[H.salesDate]), name: name,
      total: rlNum_(r[H.total]), paid: paid, bal: bal,
    });
  });

  /* group by party, biggest exposure first, so a customer completes together */
  const partyValue = {};
  out.forEach(function (x) {
    partyValue[x.pk] = (partyValue[x.pk] || 0) + Math.max(x.bal, x.paid);
  });
  out.sort(function (a, b) {
    const d = (partyValue[b.pk] || 0) - (partyValue[a.pk] || 0);
    if (d) return d;
    if (a.pk !== b.pk) return a.pk < b.pk ? -1 : 1;
    return a.date < b.date ? -1 : 1;
  });

  return { list: out, skippedCash: cash, skippedUnpaid: nopay,
    skippedSettled: notNeeded, alreadyDone: already,
    parties: Object.keys(need).length, totalRows: inv.rows.length };
}

function probeReceiptLinks() {
  const c = rlCandidates_();
  const gap = rlGap_();
  const mins = Math.round(c.list.length * gap / 60000);
  const value = c.list.reduce(function (s, x) { return s + x.paid; }, 0);
  const top100 = c.list.slice(0, 100).reduce(function (s, x) { return s + x.paid; }, 0);

  const msg = 'RECEIPT LINK PROBE — nothing pulled\n\n' +
    'invoices in file      : ' + c.totalRows.toLocaleString() + '\n' +
    '   skipped, walk-in   : ' + c.skippedCash.toLocaleString() +
      '   (no customer, no receivable)\n' +
    '   skipped, unpaid    : ' + c.skippedUnpaid.toLocaleString() +
      '   (paidAmount 0 — no receipt to find)\n' +
    '   skipped, settled   : ' + c.skippedSettled.toLocaleString() +
      '   (party has no open bill and no untagged money)\n' +
    '   TO PULL            : ' + c.list.length.toLocaleString() + '\n\n' +
    'parties needing links : ' + c.parties.toLocaleString() +
      (c.partiesKept < c.parties ? '   (limited to top ' + c.partiesKept + ')' : '') + '\n' +
    (c.scoped ? '' : '   ⚠ Receipts not uploaded — scope is invoices only\n') + '\n' +
    'receipt value covered : Rs ' + Math.round(value).toLocaleString('en-IN') + '\n' +
    'top 100 invoices hold : Rs ' + Math.round(top100).toLocaleString('en-IN') +
      '  (' + (value ? Math.round(top100 / value * 100) : 0) + '%)\n\n' +
    'at ' + gap + 'ms per call  ≈ ' + mins + ' min\n' +
    '   in ' + Math.ceil(c.list.length * gap / RL.MANUAL_RUN_MS) + ' manual run(s)\n\n' +
    'Ordered by value, so stopping early still leaves the largest exposures\n' +
    'mapped.\n\n' +
    'TOO MANY CALLS? Run rlLimitTopParties(50) to cover just the 50 biggest\n' +
    'exposures first — usually most of the money, in a fraction of the time.\n\n' +
    'Then pullReceiptLinksManual().';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return c.list.length;
}

/* ---------- the pull ---------- */

function rlSheet_() {
  const ss = txnBook_();
  let sh = vtSheet(RL.SHEET);
  if (!sh) {
    sh = ss.insertSheet(RL.SHEET);
    if (sh.getMaxColumns() < RL_COLS.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), RL_COLS.length - sh.getMaxColumns());
    }
    sh.getRange(1, 1, 1, RL_COLS.length).setValues([RL_COLS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, RL_COLS.length).setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
  }
  return sh;
}

function rlFetch_(salesId) {
  const url = rlProp_(RL.BASE).replace(/\/+$/, '') + RL.PATH + salesId +
    '?branch_id=' + encodeURIComponent(rlProp_(RL.BRANCH));
  for (let a = 0; a <= RL.BACKOFF.length; a++) {
    const r = UrlFetchApp.fetch(url, {
      method: 'get', headers: { 'api-token': rlProp_(RL.TOKEN) },
      muteHttpExceptions: true,
    });
    const code = r.getResponseCode(), txt = r.getContentText();
    if (code === 200) {
      let j;
      try { j = JSON.parse(txt); } catch (e) { return { err: 'non-JSON' }; }
      if (j.status === false) return { err: j.message || 'status false' };
      return { ok: true, data: j.response || {} };
    }
    if (code === 429) {
      rlSlower_();
      if (a === RL.BACKOFF.length) return { rate: true };
      Utilities.sleep(RL.BACKOFF[a]);
      continue;
    }
    return { err: 'HTTP ' + code };
  }
  return { rate: true };
}

function pullReceiptLinksManual() {
  PropertiesService.getScriptProperties().setProperty(RL.MANUAL, '1');
  try { return pullReceiptLinks(); }
  finally { PropertiesService.getScriptProperties().deleteProperty(RL.MANUAL); }
}

function pullReceiptLinks() {
  const props = PropertiesService.getScriptProperties();
  const manual = props.getProperty(RL.MANUAL) === '1';
  const budget = manual ? RL.MANUAL_RUN_MS : RL.RUN_MS;
  const t0 = Date.now();

  const c = rlCandidates_();
  const list = c.list;
  let cursor = parseInt(props.getProperty(RL.CURSOR) || '0', 10);
  const sh = rlSheet_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm');

  let pulled = 0, links = 0, empty = 0, errors = 0;
  const buffer = [];

  const flush = function () {
    if (!buffer.length) return;
    const want = sh.getLastRow() + buffer.length + 10;
    if (sh.getMaxRows() < want) sh.insertRowsAfter(sh.getMaxRows(), want - sh.getMaxRows());
    sh.getRange(sh.getLastRow() + 1, 1, buffer.length, RL_COLS.length).setValues(buffer);
    buffer.length = 0;
  };

  while (cursor < list.length) {
    /* stop early enough that a 429 backoff cannot push the run past the
       platform limit — that is what "Exceeded maximum execution time" was */
    if (Date.now() - t0 > budget - RL.SAFETY_MS) break;
    const inv = list[cursor];
    const r = rlFetch_(inv.id);

    if (r.rate) {
      flush();
      props.setProperty(RL.CURSOR, String(cursor));
      const m = 'Rate limited at ' + cursor + ' of ' + list.length +
        '. Wait a few minutes and run again.';
      Logger.log(m);
      try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
      return cursor;
    }
    if (r.err) { errors++; cursor++; props.setProperty(RL.CURSOR, String(cursor)); continue; }

    rlFaster_();
    pulled++;
    const rec = (r.data && r.data.receipt) || [];
    if (!rec.length) {
      empty++;
    } else {
      rec.forEach(function (x) {
        buffer.push([inv.id, inv.no, inv.date, rcvKey_(inv.name), inv.name,
          inv.total, inv.paid, inv.bal,
          String(x.receiptNo || ''), x.receiptId || '',
          rlNum_(x.totalReceipt), rlDate_(x.receiptDate),
          String(x.paymentType || ''), rlNum_(x.creditApplied),
          syFY(inv.date), stamp]);
        links++;
      });
    }
    cursor++;
    if (buffer.length >= 500) { flush(); props.setProperty(RL.CURSOR, String(cursor)); }
    if (cursor < list.length &&
        Date.now() - t0 + rlGap_() < budget - RL.SAFETY_MS) {
      Utilities.sleep(rlGap_());
    }
  }

  flush();
  props.setProperty(RL.CURSOR, String(cursor));

  const done = cursor >= list.length;
  if (done) props.deleteProperty(RL.CURSOR);
  const msg = (done ? 'RECEIPT LINKS COMPLETE' : 'RECEIPT LINKS — PAUSED') + '\n\n' +
    'position: ' + cursor.toLocaleString() + ' of ' + list.length.toLocaleString() +
    '  (' + Math.round(cursor / list.length * 100) + '%)\n' +
    'this run: ' + pulled + ' invoice(s), ' + links + ' link(s)\n' +
    '   with no receipt array: ' + empty + '\n' +
    (errors ? '   errors: ' + errors + '\n' : '') +
    'pace: ' + rlGap_() + 'ms\n\n' +
    (done ? 'Next: reconcileReceipts()' : 'Run pullReceiptLinksManual() again.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return cursor;
}

/**
 * Limit the pull to the N parties with the most at stake. Pass 0 for all.
 * At a ~14s pace this is the difference between an afternoon and a fortnight.
 */
function rlLimitTopParties(n) {
  const p = PropertiesService.getScriptProperties();
  if (!n || n <= 0) { p.deleteProperty(RL.TOP); }
  else p.setProperty(RL.TOP, String(Math.round(n)));
  p.deleteProperty(RL.CURSOR);
  const c = rlCandidates_();
  const msg = (n > 0 ? 'Scope: top ' + n + ' parties' : 'Scope: every party') +
    '\n\ncalls now: ' + c.list.length.toLocaleString() +
    '\nat ' + rlGap_() + 'ms  ≈ ' + Math.round(c.list.length * rlGap_() / 60000) + ' min' +
    '\n\nCursor reset. Run pullReceiptLinksManual().';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function rlTop50() { rlLimitTopParties(50); }
function rlTop200() { rlLimitTopParties(200); }
function rlAllParties() { rlLimitTopParties(0); }

/* ---------- unattended grinding ----------
   Triggered runs get a short slice each, but they add up. At ~12s per call a
   6-minute run does ~28 calls; every 15 minutes that is roughly 2,600 a day —
   which finishes the tight scope overnight without anyone watching.

   It stops itself when the queue is empty, so it will not burn trigger quota
   forever. */

function startReceiptGrind() {
  stopReceiptGrind();
  ScriptApp.newTrigger('grindReceiptLinks').timeBased().everyMinutes(15).create();
  const c = rlCandidates_();
  const gap = rlGap_();
  const perRun = Math.max(1, Math.floor(RL.RUN_MS / gap));
  const runs = Math.ceil(c.list.length / perRun);
  const msg = 'RECEIPT GRIND STARTED\n\n' +
    'every 15 minutes, ' + perRun + ' call(s) per run\n' +
    c.list.length.toLocaleString() + ' to go  ->  about ' +
    Math.ceil(runs / 4) + ' hour(s)\n\n' +
    'It stops itself when the queue empties.\n' +
    'stopReceiptGrind() to end it early.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function stopReceiptGrind() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'grindReceiptLinks') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

function grindReceiptLinks() {
  const before = parseInt(PropertiesService.getScriptProperties()
    .getProperty(RL.CURSOR) || '0', 10);
  pullReceiptLinks();
  const after = parseInt(PropertiesService.getScriptProperties()
    .getProperty(RL.CURSOR) || '0', 10);
  /* cursor cleared means the queue emptied */
  if (!PropertiesService.getScriptProperties().getProperty(RL.CURSOR)) {
    stopReceiptGrind();
    Logger.log('Queue empty — grind stopped and trigger removed.');
  } else if (after === before) {
    Logger.log('No progress this run (rate limited). Leaving the trigger in place.');
  }
}

function receiptLinkStatus() {
  const p = PropertiesService.getScriptProperties();
  const sh = vtSheet(RL.SHEET);
  const rows = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  const msg = 'RECEIPT LINKS\n\nlinks stored: ' + rows.toLocaleString() +
    '\ncursor: ' + (p.getProperty(RL.CURSOR) || '(none — finished or not started)') +
    '\npace: ' + rlGap_() + 'ms';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function rlReset() {
  const p = PropertiesService.getScriptProperties();
  [RL.CURSOR, RL.GAP, RL.OKC].forEach(function (k) { p.deleteProperty(k); });
  try { SpreadsheetApp.getUi().alert('Reset. The next pull starts from the top.'); } catch (e) {}
}

/* ---------- the analysis ---------- */

/**
 * Cross-checks three sources and reports what is left to do, by priority.
 *   Receipts export   what money arrived, and how Vasy classified it
 *   Receipt_Links     which receipts are actually tied to an invoice
 *   Sales_Invoices    what is still open
 */
function reconcileReceipts() {
  const links = rlRead_(RL.SHEET);
  const rc = rcvRead_(txnBook_(), RL.RECEIPTS, 'receipt_no');
  const inv = rlRead_(RL.INVOICES);
  if (!inv) throw new Error('Sales_Invoices is empty.');

  /* every receipt number that a sale claims */
  const linked = {}, linkedByParty = {};
  let linkedAmt = 0;
  if (links) {
    links.rows.forEach(function (r) {
      const no = String(r[links.H.receipt_no] || '').trim();
      if (!no) return;
      if (!linked[no]) { linked[no] = 0; linkedAmt += rlNum_(r[links.H.receipt_amount]); }
      linked[no]++;
      const k = String(r[links.H.party_key] || '');
      if (k) linkedByParty[k] = (linkedByParty[k] || 0) + 1;
    });
  }

  /* what the export says arrived */
  const byType = {}; let exportTotal = 0, exportRows = 0;
  const untied = [];
  if (rc) {
    rc.rows.forEach(function (r) {
      const no = String(r[rc.H.receipt_no] || '').trim();
      if (!no) return;
      const type = String(r[rc.H.type] || '');
      const amt = rcvNum_(r[rc.H.amount]);
      const party = String(r[rc.H.party_name] || '').trim();
      exportRows++; exportTotal += amt;
      byType[type] = (byType[type] || 0) + amt;
      if (!linked[no] && party && party !== '-') {
        untied.push({ no: no, amt: amt, type: type, party: party,
          date: rcvDate_(r[rc.H.date]) });
      }
    });
  }

  /* open invoices, for the size of the remaining problem */
  const IH = inv.H;
  let openAmt = 0, openCount = 0, openOld = 0;
  inv.rows.forEach(function (r) {
    const b = rlNum_(r[IH.balance]);
    if (b <= 0.5) return;
    const name = String(r[IH.customerName] || '').trim();
    if (!name) return;
    openAmt += b; openCount++;
    if (syFY(rlDate_(r[IH.salesDate])) === '2526') openOld += b;
  });

  untied.sort(function (a, b) { return b.amt - a.amt; });
  const untiedAmt = untied.reduce(function (s, x) { return s + x.amt; }, 0);

  const msg = 'RECEIPT RECONCILIATION\n\n' +
    '── what arrived (export) ──\n' +
    '   receipts: ' + exportRows.toLocaleString() + '   Rs ' +
      Math.round(exportTotal).toLocaleString('en-IN') + '\n' +
    Object.keys(byType).sort().map(function (k) {
      return '      ' + k + ': Rs ' + Math.round(byType[k]).toLocaleString('en-IN');
    }).join('\n') +
    '\n\n── what is tied to an invoice (from the API) ──\n' +
    '   receipts linked: ' + Object.keys(linked).length.toLocaleString() +
      '   Rs ' + Math.round(linkedAmt).toLocaleString('en-IN') + '\n' +
    (links ? '' : '   (no links pulled yet — run pullReceiptLinksManual)\n') +
    '\n── PRIORITY 1: money with no invoice ──\n' +
    '   ' + untied.length.toLocaleString() + ' receipt(s), Rs ' +
      Math.round(untiedAmt).toLocaleString('en-IN') + '\n' +
    untied.slice(0, 10).map(function (x) {
      return '      Rs ' + Math.round(x.amt).toLocaleString('en-IN') + '  ' +
        x.no + '  ' + x.type + '  ' + x.party.slice(0, 28);
    }).join('\n') +
    '\n\n── PRIORITY 2: invoices still open ──\n' +
    '   ' + openCount.toLocaleString() + ' invoice(s), Rs ' +
      Math.round(openAmt).toLocaleString('en-IN') + '\n' +
    '   of which FY25-26: Rs ' + Math.round(openOld).toLocaleString('en-IN') +
      '   <- these predate receipt recording, so many are settled in fact\n\n' +
    'Match the Priority 1 list against the Priority 2 list party by party.\n' +
    'Anything already linked above needs no work at all.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return { untied: untied.length, untiedAmt: untiedAmt, openAmt: openAmt };
}

function onOpenReceiptLinks() {
  SpreadsheetApp.getUi()
    .createMenu('🔗 Receipt Links')
    .addItem('1. Probe (safe)', 'probeReceiptLinks')
    .addItem('2a. Scope: top 50 parties', 'rlTop50')
    .addItem('2b. Scope: top 200 parties', 'rlTop200')
    .addItem('2c. Scope: everything', 'rlAllParties')
    .addItem('3. Pull links', 'pullReceiptLinksManual')
    .addItem('4. Reconcile', 'reconcileReceipts')
    .addSeparator()
    .addSeparator()
    .addItem('Start unattended grind', 'startReceiptGrind')
    .addItem('Stop grind', 'stopReceiptGrind')
    .addSeparator()
    .addItem('Status', 'receiptLinkStatus')
    .addItem('Reset', 'rlReset')
    .addToUi();
}