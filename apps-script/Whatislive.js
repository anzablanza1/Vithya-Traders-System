/**********************************************************************
 * VITHYA TRADERS — WHAT IS ACTUALLY LIVE
 *
 * Globals declared here (check before pasting):
 *   whatIsLive, wilFn_, wilTab_
 *
 * READ ONLY. Writes nothing, changes nothing.
 *
 * ── WHY THIS EXISTS ──
 *   I have twice reported a fix as applied when it was not, and we have gone
 *   round three times on "Sales_Items does not exist" — an error message that
 *   does not appear anywhere in the file I keep sending. Guessing from here
 *   is wasting your time.
 *
 *   Apps Script concatenates every .gs file in the project. If two files
 *   define the same function, ONE SILENTLY WINS and there is no warning.
 *   This reads the live function bodies and reports which version is really
 *   running, so we stop arguing about what is in the editor.
 *
 * ── RUN ──
 *   whatIsLive()      and paste the log back
 **********************************************************************/

/** is a marker string present in the LIVE body of a function? */
function wilFn_(name, marker) {
  let f = null;
  try { f = eval(name); } catch (e) { return 'NOT DEFINED'; }
  if (typeof f !== 'function') return 'NOT A FUNCTION';
  const src = String(f);
  return src.indexOf(marker) >= 0 ? 'NEW' : 'OLD';
}

function wilTab_(name) {
  let sh = null;
  try { sh = vtSheet(name); } catch (e) {}
  if (!sh) return null;
  return { rows: Math.max(0, sh.getLastRow() - 1), book: sh.getParent().getName() };
}

function whatIsLive() {
  const L = [];
  L.push('════════ WHICH CODE IS ACTUALLY RUNNING ════════');
  L.push('');

  /* each check names a function and a phrase only the NEW version contains */
  const checks = [
    ['refreshSalesRecent', 'No Sales_Items tab found', 'the year-tab fix'],
    ['refreshInvoicesRecent', 'No Sales_Invoices tab found', 'the year-tab fix'],
    ['sautTargets_', 'ANY existing year tab', 'header fallback after a split'],
    ['flrNorm_', '[^a-z0-9]', 'punctuation-blind search'],
    ['flrSearch_', 'flrTokens_', 'token search'],
    ['buildProductAnalytics', 'CHECK COST', 'the honest cost flag'],
    ['ofcActions_', 'Cost needs verifying', 'the split action group'],
    ['buildPoStatus', 'for_customer', 'PO request reason'],
    ['pullCustomers', 'LIMIT_STEPS', 'page-size negotiation'],
  ];
  checks.forEach(function (c) {
    const v = wilFn_(c[0], c[1]);
    L.push('   ' + (v === 'NEW' ? 'NEW  ' : (v === 'OLD' ? 'OLD  ' : v + '  ')) +
      c[0] + '   (' + c[2] + ')');
  });

  /* duplicate definitions are invisible until something behaves oddly */
  L.push('');
  L.push('── duplicate definitions ──');
  const dupCheck = ['refreshSalesRecent', 'refreshInvoicesRecent', 'nightlyAnalytics',
    'installAllTriggers', 'installSalesTriggers', 'doGet', 'each'];
  L.push('   Apps Script keeps only ONE definition per name across all files.');
  L.push('   If a job misbehaves, an older file is probably redefining it.');
  dupCheck.forEach(function (n) {
    let ok = 'missing';
    try { ok = (typeof eval(n) === 'function') ? 'defined' : 'not a function'; }
    catch (e) { ok = 'missing'; }
    L.push('      ' + n + ': ' + ok);
  });

  /* what the triggers are really pointing at */
  L.push('');
  L.push('── installed triggers ──');
  try {
    const t = ScriptApp.getProjectTriggers();
    if (!t.length) L.push('   none');
    t.forEach(function (x) {
      L.push('   ' + x.getHandlerFunction() + '   ' + x.getEventType());
    });
  } catch (e) { L.push('   could not read: ' + e.message); }

  /* the tabs the sales jobs look for */
  L.push('');
  L.push('── sales tabs ──');
  ['Sales_Items', 'Sales_Items_2526', 'Sales_Items_2627',
   'Sales_Invoices', 'Sales_Invoices_2526', 'Sales_Invoices_2627'].forEach(function (n) {
    const t = wilTab_(n);
    L.push('   ' + n + ': ' + (t ? t.rows.toLocaleString() + ' rows in ' + t.book : 'NOT FOUND'));
  });

  /* the data behind the office flags — code can be right and data stale */
  L.push('');
  L.push('── what Product_Analytics actually says ──');
  try {
    const sh = vtSheet('Product_Analytics');
    if (!sh || sh.getLastRow() < 2) L.push('   empty');
    else {
      const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
        .map(function (x) { return String(x).trim(); });
      const fi = hdr.indexOf('flags'), ai = hdr.indexOf('action');
      L.push('   columns: ' + hdr.length +
        (hdr.indexOf('cost_source') >= 0 ? '   (has the new cost columns)'
                                         : '   (OLD — no cost_source column)'));
      if (fi >= 0) {
        const v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
        let loss = 0, check = 0;
        const acts = {};
        v.forEach(function (r) {
          const f = String(r[fi] || '');
          if (f.indexOf('CHECK COST') >= 0) check++;
          else if (f.indexOf('LOSS') >= 0) loss++;
          if (ai >= 0) {
            const a = String(r[ai] || '').split(' ')[0];
            if (a) acts[a] = (acts[a] || 0) + 1;
          }
        });
        L.push('   flagged LOSS       : ' + loss);
        L.push('   flagged CHECK COST : ' + check +
          (check === 0 && loss > 0 ? '   <-- analytics has NOT been rebuilt' : ''));
        L.push('   first word of each action:');
        Object.keys(acts).sort().forEach(function (k) {
          L.push('      ' + k + ': ' + acts[k]);
        });
      }
    }
  } catch (e) { L.push('   error: ' + e.message); }

  /* read models can lag behind analytics */
  L.push('');
  L.push('── read models ──');
  try {
    const sh = vtSheet('Read_Models');
    if (!sh || sh.getLastRow() < 2) L.push('   none built');
    else {
      const v = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
      const m = {};
      v.forEach(function (r) {
        const n = String(r[0]);
        if (!m[n]) m[n] = { cells: 0, built: String(r[2]) };
        m[n].cells++;
      });
      Object.keys(m).sort().forEach(function (k) {
        L.push('   ' + k + ': ' + m[k].cells + ' cells, built ' + m[k].built);
      });
    }
  } catch (e) { L.push('   error: ' + e.message); }

  const msg = L.join('\n');
  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert('Diagnostic written to the log.\n\n' +
      'View > Logs, then paste it back.');
  } catch (e) {}
  return msg;
}


/**
 * WHICH FILE IS WINNING.
 *
 * Apps Script concatenates every .gs file and keeps ONE definition per name.
 * There is no warning and no file list. But the live source IS readable, so
 * printing it lets you search the project for a line only that copy contains.
 *
 * Run this, copy a distinctive line from the output, then use the editor's
 * search (the magnifier in the left bar) to find which file it is in.
 */
function findDuplicate() {
  const names = ['refreshSalesRecent', 'refreshInvoicesRecent'];
  const L = [];
  names.forEach(function (n) {
    let src = null;
    try { src = String(eval(n)); } catch (e) {}
    L.push('════════ ' + n + ' ════════');
    if (!src) { L.push('   not defined at all'); return; }
    const isNew = src.indexOf('sautTargets_') >= 0;
    L.push('   ' + (isNew ? 'this is the FIXED version' :
      'this is the OLD version — another file is overriding the fix'));
    L.push('   ' + src.length + ' chars');
    L.push('');
    /* the first 25 lines are enough to identify it */
    src.split('\n').slice(0, 25).forEach(function (line) { L.push('   ' + line); });
    L.push('   …');
    L.push('');
    if (!isNew) {
      const hunt = (src.match(/'[^']{15,60}'/g) || []).slice(0, 4);
      L.push('   SEARCH THE PROJECT for any of these strings —');
      L.push('   whichever file contains them is the one to delete:');
      hunt.forEach(function (x) { L.push('      ' + x); });
    }
    L.push('');
  });
  L.push('When you find it: delete that file (or rename its functions),');
  L.push('then Deploy > Manage deployments > New version.');
  const msg = L.join('\n');
  Logger.log(msg);
  return msg;
}