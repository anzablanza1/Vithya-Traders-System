/**********************************************************************
 * VITHYA TRADERS — DATA AUDIT
 *
 * Globals declared here (check before pasting):
 *   auditEverything, auditSalesCoverage, auditFindTab
 *
 * READ ONLY. Nothing is created, moved or deleted.
 *
 * ── WHY ──
 *   After a split, "not found" can mean two very different things: the tab
 *   was renamed as intended, or rows went missing. This tells you which,
 *   by listing every tab in every workbook with its row count and — for
 *   sales tabs — its actual date range.
 *
 * ── RUN ──
 *   auditEverything()      every workbook, every tab, cell counts
 *   auditSalesCoverage()   which months of sales exist, and where
 *   auditFindTab('name')   locate one tab by partial name
 **********************************************************************/

function auditEverything() {
  const books = vtBooks();
  const lines = [];
  let grand = 0;
  Object.keys(books).sort().forEach(function (alias) {
    let ss;
    try { ss = SpreadsheetApp.openById(books[alias]); }
    catch (e) { lines.push(alias + ': UNREADABLE — ' + e.message); return; }
    let cells = 0;
    const tabs = ss.getSheets().map(function (s) {
      const r = s.getLastRow(), c = s.getLastColumn();
      cells += r * c;
      return '      ' + s.getName() + '  —  ' + Math.max(0, r - 1).toLocaleString() +
        ' data rows, ' + c + ' cols';
    });
    grand += cells;
    lines.push(alias + '  =  ' + ss.getName() + '\n' +
      '      ' + cells.toLocaleString() + ' cells (' +
      (cells / 10000000 * 100).toFixed(1) + '% of limit)\n' + tabs.join('\n'));
  });
  const msg = 'EVERY WORKBOOK\n\n' + lines.join('\n\n') +
    '\n\nTOTAL across all books: ' + grand.toLocaleString() + ' cells';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
}

/**
 * The question that matters after a split: is every month of sales still
 * present, and in which tab? Reads the date column of every sales-ish tab.
 */
function auditSalesCoverage() {
  const books = vtBooks();
  const found = [];
  Object.keys(books).forEach(function (alias) {
    let ss;
    try { ss = SpreadsheetApp.openById(books[alias]); } catch (e) { return; }
    ss.getSheets().forEach(function (sh) {
      const n = sh.getName();
      if (n.indexOf('Sales_Items') !== 0 && n.indexOf('Sales_Invoices') !== 0) return;
      if (sh.getLastRow() < 2) { found.push({ alias: alias, tab: n, rows: 0, months: {} }); return; }
      const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
        .map(function (x) { return String(x).trim(); });
      const di = hdr.indexOf('salesDate');
      const rows = sh.getLastRow() - 1;
      const months = {};
      if (di >= 0) {
        const B = 20000;
        for (let s = 0; s < rows; s += B) {
          const take = Math.min(B, rows - s);
          const v = sh.getRange(2 + s, di + 1, take, 1).getValues();
          v.forEach(function (r) {
            const x = r[0];
            let m = '';
            if (x instanceof Date) {
              m = Utilities.formatDate(x, Session.getScriptTimeZone(), 'yyyy-MM');
            } else {
              const mm = String(x || '').match(/^\d{4}-\d{2}/);
              m = mm ? mm[0] : '';
            }
            if (m) months[m] = (months[m] || 0) + 1;
          });
        }
      }
      found.push({ alias: alias, tab: n, rows: rows, months: months });
    });
  });

  if (!found.length) {
    const m = 'NO SALES TABS FOUND ANYWHERE.\n\nThat is serious — tell me before ' +
      'running anything else.';
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return;
  }

  /* combined month coverage, so a gap is obvious */
  const allMonths = {};
  found.forEach(function (f) {
    Object.keys(f.months).forEach(function (m) {
      allMonths[m] = (allMonths[m] || 0) + f.months[m];
    });
  });
  const ms = Object.keys(allMonths).sort();

  const lines = found.map(function (f) {
    const mk = Object.keys(f.months).sort();
    return '   ' + f.tab + '  (' + f.alias + ')\n' +
      '      ' + f.rows.toLocaleString() + ' rows' +
      (mk.length ? ', ' + mk[0] + ' .. ' + mk[mk.length - 1] : ', no readable dates');
  });

  /* flag any missing month between the first and last seen */
  const gaps = [];
  if (ms.length) {
    let y = parseInt(ms[0].slice(0, 4), 10), mo = parseInt(ms[0].slice(5), 10);
    const endY = parseInt(ms[ms.length - 1].slice(0, 4), 10);
    const endM = parseInt(ms[ms.length - 1].slice(5), 10);
    while (y < endY || (y === endY && mo <= endM)) {
      const k = y + '-' + ('0' + mo).slice(-2);
      if (!allMonths[k]) gaps.push(k);
      mo++; if (mo > 12) { mo = 1; y++; }
    }
  }

  const total = Object.keys(allMonths).reduce(function (s, k) { return s + allMonths[k]; }, 0);
  const msg = 'SALES COVERAGE\n\n' + lines.join('\n') +
    '\n\ncombined: ' + total.toLocaleString() + ' rows across ' + ms.length + ' month(s)\n' +
    (ms.length ? '   ' + ms[0] + ' .. ' + ms[ms.length - 1] : '') +
    (gaps.length ? '\n\n⚠ MISSING MONTHS: ' + gaps.join(', ') +
      '\n   Those rows are not in any workbook.' :
      '\n\nNo gaps — every month between the first and last is present.') +
    '\n\n── month by month ──\n' +
    ms.map(function (m) { return '   ' + m + ': ' + allMonths[m].toLocaleString(); }).join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return { total: total, months: ms.length, gaps: gaps };
}

function auditFindTab(partial) {
  const want = String(partial || '').toLowerCase();
  if (!want) throw new Error("auditFindTab('sales')");
  const books = vtBooks();
  const hits = [];
  Object.keys(books).forEach(function (alias) {
    let ss;
    try { ss = SpreadsheetApp.openById(books[alias]); } catch (e) { return; }
    ss.getSheets().forEach(function (sh) {
      if (sh.getName().toLowerCase().indexOf(want) < 0) return;
      hits.push('   ' + sh.getName() + '  ->  ' + alias + ' (' + ss.getName() + ')  ' +
        Math.max(0, sh.getLastRow() - 1).toLocaleString() + ' rows');
    });
  });
  const msg = 'TABS MATCHING "' + partial + '"\n\n' +
    (hits.length ? hits.join('\n') : '   none found');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function stopEverything() {
  var t = ScriptApp.getProjectTriggers();
  t.forEach(function (x) { ScriptApp.deleteTrigger(x); });
  Logger.log('Deleted ' + t.length + ' trigger(s).');
}
