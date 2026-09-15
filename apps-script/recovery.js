/**********************************************************************
 * VITHYA TRADERS — SALES RECOVERY
 *
 * Globals declared here (check before pasting):
 *   RCV2, recoveryStatus, recoveryStep1_Clear, recoveryStep2_Dedupe,
 *   recoveryStep2_Apply, recoveryStep5_Rebuild, rcv2Del_
 *
 * ── WHAT HAPPENED ──
 *   The nightly refresh deleted rows inside its window and trusted a later
 *   step to re-pull them. After the year split changed which tab it purged,
 *   the delete ran and the restore did not. 188,000 sales lines went.
 *
 *   Nothing is permanently lost — every one of those rows came from the Vasy
 *   API and can be pulled again. This walks the recovery.
 *
 * ── ORDER ──
 *   recoveryStatus()          where things stand
 *   recoveryStep2_Dedupe()    dry run — what duplicates exist
 *   recoveryStep2_Apply()     apply the dedupe
 *   recoveryStep1_Clear()     remove the 4,500 partial rows so the re-pull
 *                             cannot duplicate them
 *   then, by hand:
 *     siReset()  ->  pullSalesItems()      repeat until COMPLETE  (~2-3 h)
 *     solReset() ->  pullSalesInvoices()   repeat until COMPLETE  (~1 h)
 *     splitSalesByYear()
 *   recoveryStep5_Rebuild()   rollup, analytics, outstanding, read models
 *
 * ── TRIGGERS STAY OFF ──
 *   Until recoveryStatus() reports the full row counts back. A nightly job
 *   running mid-recovery is how this happened.
 **********************************************************************/

const RCV2 = {
  EXPECT_ITEMS: 192057,
  EXPECT_INVOICES: 33271,
  EXPECT_MONTHS: 17,
};

function rcv2Del_(base) {
  const books = vtBooks();
  const gone = [];
  Object.keys(books).forEach(function (alias) {
    let ss;
    try { ss = SpreadsheetApp.openById(books[alias]); } catch (e) { return; }
    ss.getSheets().forEach(function (sh) {
      const n = sh.getName();
      if (n !== base && n.indexOf(base + '_') !== 0) return;
      gone.push(n + ' (' + alias + ', ' + Math.max(0, sh.getLastRow() - 1) + ' rows)');
      ss.deleteSheet(sh);
    });
  });
  return gone;
}

/* ---------- status ---------- */

function recoveryStatus() {
  const trig = ScriptApp.getProjectTriggers();
  const cov = (function () {
    const books = vtBooks();
    let items = 0, invoices = 0;
    const months = {};
    Object.keys(books).forEach(function (alias) {
      let ss;
      try { ss = SpreadsheetApp.openById(books[alias]); } catch (e) { return; }
      ss.getSheets().forEach(function (sh) {
        const n = sh.getName();
        const isI = n.indexOf('Sales_Items') === 0;
        const isV = n.indexOf('Sales_Invoices') === 0;
        if (!isI && !isV) return;
        const rows = Math.max(0, sh.getLastRow() - 1);
        if (isI) items += rows; else invoices += rows;
        if (!isI || rows < 1) return;
        const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
          .map(function (x) { return String(x).trim(); });
        const di = hdr.indexOf('salesDate');
        if (di < 0) return;
        const B = 20000;
        for (let s = 0; s < rows; s += B) {
          const take = Math.min(B, rows - s);
          sh.getRange(2 + s, di + 1, take, 1).getValues().forEach(function (r) {
            const x = r[0];
            const m = (x instanceof Date)
              ? Utilities.formatDate(x, Session.getScriptTimeZone(), 'yyyy-MM')
              : (String(x || '').match(/^\d{4}-\d{2}/) || [''])[0];
            if (m) months[m] = 1;
          });
        }
      });
    });
    return { items: items, invoices: invoices, months: Object.keys(months).sort() };
  })();

  const roll = vtSheet('Sales_Monthly');
  const rollRows = roll ? Math.max(0, roll.getLastRow() - 1) : 0;

  const pct = function (a, b) { return b ? Math.round(a / b * 100) + '%' : '0%'; };
  const ok = cov.items >= RCV2.EXPECT_ITEMS * 0.98;

  const msg = 'RECOVERY STATUS\n\n' +
    'triggers running: ' + trig.length +
    (trig.length ? '   ⚠ TURN THESE OFF until recovery is done' : '   good') + '\n\n' +
    'sales lines:    ' + cov.items.toLocaleString() + ' of ~' +
      RCV2.EXPECT_ITEMS.toLocaleString() + '  (' + pct(cov.items, RCV2.EXPECT_ITEMS) + ')\n' +
    'sales invoices: ' + cov.invoices.toLocaleString() + ' of ~' +
      RCV2.EXPECT_INVOICES.toLocaleString() + '  (' + pct(cov.invoices, RCV2.EXPECT_INVOICES) + ')\n' +
    'months covered: ' + cov.months.length + ' of ' + RCV2.EXPECT_MONTHS +
      (cov.months.length ? '   ' + cov.months[0] + ' .. ' + cov.months[cov.months.length - 1] : '') + '\n' +
    'Sales_Monthly:  ' + rollRows.toLocaleString() + ' rows' +
      (rollRows < 20000 ? '   (stale — rebuild after the pull)' : '   ok') + '\n\n' +
    (ok ? 'Sales data looks complete. Run recoveryStep5_Rebuild(), then\n' +
          'reinstall triggers with installSalesTriggers().'
        : 'Still recovering. Next: siReset() then pullSalesItems(), repeat\n' +
          'until it says COMPLETE.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return cov;
}

/* ---------- step 1 ---------- */

/**
 * Removes the partial sales tabs so the re-pull starts clean. Without this the
 * 4,500 surviving rows would be duplicated by the fresh pull.
 * Only sales tabs are touched — nothing else is deleted.
 */
function recoveryStep1_Clear() {
  const trig = ScriptApp.getProjectTriggers();
  if (trig.length) {
    throw new Error('There are still ' + trig.length + ' trigger(s) installed.\n\n' +
      'Delete them first (clock icon in the sidebar), or a nightly job will run ' +
      'in the middle of the recovery. That is how the data was lost.');
  }
  /* Sales_Invoices came back from the restore with its full history — do NOT
     delete it. Only the partial year tab and the sales LINES are cleared. */
  const gone = rcv2Del_('Sales_Items');
  const inv = vtSheet('Sales_Invoices');
  const invRows = inv ? Math.max(0, inv.getLastRow() - 1) : 0;
  if (invRows < 20000) {
    gone.push.apply(gone, rcv2Del_('Sales_Invoices'));
  } else {
    /* drop only the partial year tab, which is a subset of the restored one */
    const books = vtBooks();
    Object.keys(books).forEach(function (alias) {
      let ss;
      try { ss = SpreadsheetApp.openById(books[alias]); } catch (e) { return; }
      ss.getSheets().forEach(function (sh) {
        if (sh.getName().indexOf('Sales_Invoices_') !== 0) return;
        gone.push(sh.getName() + ' (' + alias + ', partial subset)');
        ss.deleteSheet(sh);
      });
    });
    gone.push('KEPT Sales_Invoices with ' + invRows.toLocaleString() +
      ' rows — the restore recovered it, no re-pull needed');
  }
  try {
    const p = PropertiesService.getScriptProperties();
    ['SI_MONTH', 'SI_OFFSET', 'SOL_CURSOR', 'SOL_TOTAL'].forEach(function (k) {
      p.deleteProperty(k);
    });
  } catch (e) {}
  try { regSet_(REG.MAP, {}); } catch (e) {}

  const msg = 'CLEARED FOR RE-PULL\n\n' +
    (gone.length ? gone.join('\n') : '(nothing to remove)') +
    '\n\nCursors reset.\n\nNow run, in order:\n' +
    '   pullSalesItems()      repeat until COMPLETE  (~2-3 hours)\n' +
    '   pullSalesInvoices()   repeat until COMPLETE  (~1 hour)\n' +
    '   splitSalesByYear()\n' +
    '   recoveryStep5_Rebuild()\n\n' +
    'Leave the triggers off throughout.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ---------- step 2: clean up after a restore ---------- */

/**
 * A Drive restore brings back the whole workbook, including tabs that had
 * since been MOVED elsewhere. The result is two copies of the same tab in two
 * books, and vtSheet() picks whichever it finds first — the silent-divergence
 * problem again.
 *
 * This reports every duplicate and, on confirm, keeps the right one:
 *   computed tabs  -> keep the VT_Analytics copy (both are rebuilt anyway)
 *   sales tabs     -> keep whichever has MORE rows, since the restore may
 *                     hold history the live copy lost
 */
function recoveryStep2_Dedupe(apply) {
  const books = vtBooks();
  const seen = {};
  Object.keys(books).forEach(function (alias) {
    let ss;
    try { ss = SpreadsheetApp.openById(books[alias]); } catch (e) { return; }
    ss.getSheets().forEach(function (sh) {
      const n = sh.getName();
      if (n === 'README') return;
      (seen[n] = seen[n] || []).push({ alias: alias, ss: ss, sh: sh,
        rows: Math.max(0, sh.getLastRow() - 1) });
    });
  });

  const dupes = Object.keys(seen).filter(function (n) { return seen[n].length > 1; });
  if (!dupes.length) {
    const m = 'No duplicate tabs. Nothing to clean up.';
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return;
  }

  const COMPUTED = { Product_Analytics: 1, Sales_Monthly: 1,
    Customer_Outstanding: 1, Read_Models: 1 };
  const plan = [];
  dupes.forEach(function (n) {
    const copies = seen[n].slice();
    let keep;
    if (COMPUTED[n]) {
      keep = copies.filter(function (c) { return c.alias === 'analytics'; })[0] ||
        copies.sort(function (a, b) { return b.rows - a.rows; })[0];
    } else {
      keep = copies.slice().sort(function (a, b) { return b.rows - a.rows; })[0];
    }
    copies.forEach(function (c) {
      if (c === keep) return;
      plan.push({ name: n, drop: c, keepAlias: keep.alias, keepRows: keep.rows });
    });
  });

  const lines = plan.map(function (p) {
    return '   ' + p.name + ': drop the ' + p.drop.alias + ' copy (' +
      p.drop.rows.toLocaleString() + ' rows), keep ' + p.keepAlias + ' (' +
      p.keepRows.toLocaleString() + ')';
  });

  if (!apply) {
    const m = 'DUPLICATE TABS — nothing changed\n\n' + lines.join('\n') +
      '\n\nRun recoveryStep2_Dedupe(true) to apply.';
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return plan;
  }

  let removed = 0;
  plan.forEach(function (p) {
    try { p.drop.ss.deleteSheet(p.drop.sh); removed++; }
    catch (e) { Logger.log('could not delete ' + p.name + ' from ' + p.drop.alias); }
  });
  try { regSet_(REG.MAP, {}); } catch (e) {}
  try { vtInvalidate(); } catch (e) {}

  const msg = 'DEDUPED\n\n' + lines.join('\n') +
    '\n\nremoved ' + removed + ' duplicate tab(s).';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* The Run dropdown only lists functions that take NO arguments, so
   recoveryStep2_Dedupe(true) cannot be picked from the editor. This is the
   one to run once the dry run looks right. */
function recoveryStep2_Apply() { return recoveryStep2_Dedupe(true); }

/**
 * The Apps Script Run dropdown only lists functions that take no arguments,
 * so recoveryStep2_Dedupe(true) cannot be selected from it. This is the
 * runnable version.
 */
function recoveryStep2_Apply() {
  return recoveryStep2_Dedupe(true);
}

/* ---------- step 5 ---------- */

function recoveryStep5_Rebuild() {
  const done = [];
  const step = function (label, fn) {
    try { const r = fn(); done.push('   ' + label + ': ok' + (r ? ' (' + r + ')' : '')); }
    catch (e) { done.push('   ' + label + ': FAILED — ' + e.message); }
  };
  step('Sales_Monthly', function () {
    buildSalesMonthly();
    const sh = vtSheet('Sales_Monthly');
    return (sh ? sh.getLastRow() - 1 : 0) + ' rows';
  });
  step('Product_Analytics', function () { return buildProductAnalytics() + ' products'; });
  step('Customer_Outstanding', function () {
    buildOutstanding();
    const sh = vtSheet('Customer_Outstanding');
    return (sh ? sh.getLastRow() - 1 : 0) + ' customers';
  });
  step('Read models', function () { return buildReadModels() + ' cells'; });

  const msg = 'REBUILD\n\n' + done.join('\n') +
    '\n\nRun recoveryStatus() to confirm, then installSalesTriggers()\n' +
    'to put the nightly jobs back.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}