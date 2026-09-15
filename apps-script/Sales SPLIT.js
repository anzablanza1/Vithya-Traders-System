/**********************************************************************
 * VITHYA TRADERS — SALES YEAR SPLIT
 *
 * Globals declared here (check before pasting):
 *   SY, syFY, syTabName, syBookAlias, salesYearTabs, readSalesAcrossYears,
 *   splitSalesByYear, ensureYearBook, salesSplitStatus, syRows_, syDate_,
 *   onOpenSalesSplit
 *
 * ── WHY ──
 *   Sales_Items is 5.58M cells for FY25-26 alone. FY26-27 is running at
 *   176,000 lines a year, another 5.12M. One workbook holds 10M. Both years
 *   live in one file is arithmetically impossible.
 *
 * ── HOW ──
 *   One workbook per financial year, and the TAB carries the year in its name:
 *
 *       VT_Sales_2526 : Sales_Items_2526 · Sales_Invoices_2526
 *       VT_Sales_2627 : Sales_Items_2627 · Sales_Invoices_2627
 *
 *   Year in the tab name, not just the workbook, so the registry can still
 *   resolve every tab to exactly one place. Two tabs called Sales_Items in
 *   two books would make vtSheet() ambiguous.
 *
 * ── BOTH YEARS STAY LIVE ──
 *   Nightly refresh writes into whichever year a row belongs to. Readers use
 *   readSalesAcrossYears(), which walks every year tab it can find. Adding
 *   FY27-28 next April needs no code change.
 *
 * ── SAFE ORDER ──
 *   Copy rows to the year book, verify the count, then delete from source.
 *   Nothing is removed until its new home is confirmed.
 *
 * ── RUN ──
 *   salesSplitStatus()    read only — what would move where
 *   splitSalesByYear()    do it, one year at a time, resumable
 **********************************************************************/

const SY = {
  ITEMS: 'Sales_Items',
  INVOICES: 'Sales_Invoices',
  DATE_FIELD: { Sales_Items: 'salesDate', Sales_Invoices: 'salesDate' },
  CURSOR: 'SY_CURSOR',
  BLOCK: 10000,      // rows per getValues — 10k x 29 is a safe read
  MAX_RUN_MS: 280000,
};

/** financial year label for a date: 2025-06-01 -> '2526' (April to March) */
function syFY(iso) {
  const s = String(iso || '');
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) return '';
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
  const start = mo >= 4 ? y : y - 1;
  return String(start % 100) + String((start + 1) % 100);
}
function syTabName(base, fy) { return base + '_' + fy; }
function syBookAlias(fy) { return 'sales' + fy; }

function syDate_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : String(v).slice(0, 10);
}

/* ---------- year books ---------- */

function ensureYearBook(fy) {
  const alias = syBookAlias(fy);
  const books = vtBooks();
  if (books[alias]) {
    try { return SpreadsheetApp.openById(books[alias]); } catch (e) { /* stale */ }
  }
  const name = 'VT_Sales_' + fy;
  const ss = SpreadsheetApp.create(name);
  const f = ss.getSheets()[0];
  f.setName('README');
  f.getRange(1, 1, 6, 1).setValues([
    [name], [''],
    ['Sales lines and invoices for financial year 20' + fy.slice(0, 2) +
     '-' + fy.slice(2)],
    ['One workbook per year, because a single year is already ~5M cells'],
    ['and the limit is 10M.'],
    ['Both current and previous year stay LIVE and are refreshed nightly.'],
  ]);
  f.getRange(1, 1).setFontWeight('bold').setFontSize(13);
  registerBook(alias, ss.getId());
  return ss;
}

/** every year tab of a kind that currently exists, oldest first */
function salesYearTabs(base) {
  const books = vtBooks();
  const out = [];
  Object.keys(books).forEach(function (alias) {
    if (alias.indexOf('sales') !== 0) return;
    let ss;
    try { ss = SpreadsheetApp.openById(books[alias]); } catch (e) { return; }
    ss.getSheets().forEach(function (sh) {
      const n = sh.getName();
      if (n.indexOf(base + '_') === 0) out.push({ tab: n, fy: n.slice(base.length + 1), sh: sh });
    });
  });
  /* the un-split original, if it is still there */
  const legacy = vtSheet(base);
  if (legacy) out.push({ tab: base, fy: '', sh: legacy });
  out.sort(function (a, b) { return a.fy < b.fy ? -1 : 1; });
  return out;
}

/**
 * Read rows from every year tab of a kind, optionally from a date onward.
 * Callers get one combined array with a consistent header, so nothing
 * downstream needs to know the data is split.
 */
function readSalesAcrossYears(base, fromDate) {
  const tabs = salesYearTabs(base);
  if (!tabs.length) return null;
  const field = SY.DATE_FIELD[base] || 'salesDate';
  let header = null;
  const rows = [];
  tabs.forEach(function (t) {
    const sh = t.sh;
    if (sh.getLastRow() < 2) return;
    const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(function (x) { return String(x).trim(); });
    if (!header) header = hdr;
    const H = {};
    hdr.forEach(function (h, i) { if (h) H[h] = i; });
    const n = sh.getLastRow() - 1;
    for (let s = 0; s < n; s += SY.BLOCK) {
      const take = Math.min(SY.BLOCK, n - s);
      const v = sh.getRange(2 + s, 1, take, sh.getLastColumn()).getValues();
      v.forEach(function (r) {
        if (fromDate && H[field] !== undefined && syDate_(r[H[field]]) < fromDate) return;
        rows.push(r);
      });
    }
  });
  const H = {};
  (header || []).forEach(function (h, i) { if (h) H[h] = i; });
  return { H: H, header: header, rows: rows, tabs: tabs.length };
}

/* ---------- the split ---------- */

function salesSplitStatus() {
  const lines = [];
  [SY.ITEMS, SY.INVOICES].forEach(function (base) {
    const legacy = vtSheet(base);
    if (legacy && legacy.getLastRow() > 1) {
      const hdr = legacy.getRange(1, 1, 1, legacy.getLastColumn()).getValues()[0]
        .map(function (x) { return String(x).trim(); });
      const H = {};
      hdr.forEach(function (h, i) { if (h) H[h] = i; });
      const f = SY.DATE_FIELD[base];
      const n = legacy.getLastRow() - 1;
      const byFy = {};
      for (let s = 0; s < n; s += SY.BLOCK) {
        const take = Math.min(SY.BLOCK, n - s);
        const v = legacy.getRange(2 + s, H[f] + 1, take, 1).getValues();
        v.forEach(function (r) {
          const fy = syFY(syDate_(r[0]));
          byFy[fy || '?'] = (byFy[fy || '?'] || 0) + 1;
        });
      }
      lines.push(base + ' — still unsplit, ' + n.toLocaleString() + ' rows:\n' +
        Object.keys(byFy).sort().map(function (k) {
          return '      FY' + k + ': ' + byFy[k].toLocaleString() + ' -> ' +
            syTabName(base, k);
        }).join('\n'));
    }
    const yr = salesYearTabs(base).filter(function (t) { return t.fy; });
    yr.forEach(function (t) {
      lines.push('   ' + t.tab + ': ' + Math.max(0, t.sh.getLastRow() - 1).toLocaleString() +
        ' rows  (' + t.sh.getParent().getName() + ')');
    });
  });
  const msg = 'SALES SPLIT\n\n' + (lines.length ? lines.join('\n') : 'Nothing found.') +
    '\n\nsplitSalesByYear() copies, verifies, then removes from the source.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
}

/**
 * Moves one base tab at a time. Resumable: if it runs out of execution time,
 * run it again and it carries on. The source rows for a year are deleted only
 * after that year's destination row count matches.
 */
/**
 * Moves one base tab into per-year workbooks.
 *
 * CHUNKED AND RESUMABLE. An earlier version read every row in one
 * getValues() — 192,057 x 29 = 5.5M cells — which Apps Script will not
 * survive. This walks the source in blocks, remembers how far it got, and
 * carries on when run again.
 *
 * The source is deleted ONLY after every row is accounted for in the
 * destinations. A partial run leaves both sides intact.
 */
function splitSalesByYear(baseName) {
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();
  const bases = baseName ? [baseName] : [SY.ITEMS, SY.INVOICES];
  const report = [];

  for (let bi = 0; bi < bases.length; bi++) {
    const base = bases[bi];
    const src = vtSheet(base);
    if (!src || src.getLastRow() < 2) { report.push(base + ': nothing to split'); continue; }

    const hdr = src.getRange(1, 1, 1, src.getLastColumn()).getValues()[0];
    const names = hdr.map(function (x) { return String(x).trim(); });
    const H = {};
    names.forEach(function (h, i) { if (h) H[h] = i; });
    const f = SY.DATE_FIELD[base];
    if (H[f] === undefined) { report.push(base + ': no ' + f + ' column'); continue; }

    const n = src.getLastRow() - 1, w = src.getLastColumn();
    const ckey = SY.CURSOR + '_' + base;
    let cursor = parseInt(props.getProperty(ckey) || '0', 10);
    let movedThisRun = 0, hitBudget = false;

    while (cursor < n) {
      if (Date.now() - t0 > SY.MAX_RUN_MS) { hitBudget = true; break; }
      const take = Math.min(SY.BLOCK, n - cursor);
      const block = src.getRange(2 + cursor, 1, take, w).getValues();

      /* bucket this block by financial year */
      const buckets = {};
      block.forEach(function (r) {
        const fy = syFY(syDate_(r[H[f]])) || 'unknown';
        (buckets[fy] = buckets[fy] || []).push(r);
      });

      let blockOk = true;
      Object.keys(buckets).sort().forEach(function (fy) {
        if (!blockOk) return;
        if (fy === 'unknown') {
          report.push('   ' + base + ': ' + buckets[fy].length +
            ' row(s) with no readable date at offset ' + cursor + ' — STOPPED');
          blockOk = false;
          return;
        }
        const rows = buckets[fy];
        const book = ensureYearBook(fy);
        const tabName = syTabName(base, fy);
        let sh = book.getSheetByName(tabName);
        if (!sh) {
          sh = book.insertSheet(tabName);
          if (sh.getMaxColumns() < w) {
            sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
          }
          sh.getRange(1, 1, 1, w).setValues([hdr]);
          sh.setFrozenRows(1);
          sh.getRange(1, 1, 1, w).setFontWeight('bold')
            .setBackground('#CC3018').setFontColor('#FFFFFF');
          const dcol = names.indexOf(f) + 1;
          if (dcol > 0) sh.getRange(1, dcol, sh.getMaxRows(), 1).setNumberFormat('@');
        }
        const want = sh.getLastRow() + rows.length + 10;
        if (sh.getMaxRows() < want) sh.insertRowsAfter(sh.getMaxRows(), want - sh.getMaxRows());
        const before = sh.getLastRow();
        sh.getRange(before + 1, 1, rows.length, w).setValues(rows);
        if (sh.getLastRow() - before !== rows.length) {
          report.push('   ' + tabName + ': write verify failed at offset ' + cursor);
          blockOk = false;
        }
      });

      if (!blockOk) break;
      cursor += take;
      movedThisRun += take;
      props.setProperty(ckey, String(cursor));
    }

    if (cursor < n) {
      report.push('   ' + base + ': ' + cursor.toLocaleString() + ' of ' +
        n.toLocaleString() + ' copied' +
        (hitBudget ? ' — time budget, run again to continue' : ' — STOPPED, see above'));
      report.push('   ' + base + ': source KEPT');
      continue;
    }

    /* every row copied — verify the totals before removing anything */
    let dest = 0;
    salesYearTabs(base).forEach(function (t) {
      if (t.fy) dest += Math.max(0, t.sh.getLastRow() - 1);
    });
    if (dest !== n) {
      report.push('   ' + base + ': VERIFY FAILED — source ' + n.toLocaleString() +
        ', destinations hold ' + dest.toLocaleString() + '. Source KEPT.');
      continue;
    }
    src.getParent().deleteSheet(src);
    props.deleteProperty(ckey);
    report.push('   ' + base + ': ' + n.toLocaleString() +
      ' rows split and verified, source removed');
  }

  try { regSet_(REG.MAP, {}); } catch (e) {}
  try { vtInvalidate(); } catch (e) {}

  const msg = 'SALES SPLIT\n\n' + report.join('\n') +
    '\n\nReaders use readSalesAcrossYears(), so both years stay live.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
}

function resetSplitCursor() {
  const p = PropertiesService.getScriptProperties();
  [SY.ITEMS, SY.INVOICES].forEach(function (b) { p.deleteProperty(SY.CURSOR + '_' + b); });
  try { SpreadsheetApp.getUi().alert('Split cursors reset.'); } catch (e) {}
}

function onOpenSalesSplit() {
  SpreadsheetApp.getUi()
    .createMenu('📅 Sales Split')
    .addItem('What would move (safe)', 'salesSplitStatus')
    .addItem('Split by financial year', 'splitSalesByYear')
    .addItem('Reset split cursor', 'resetSplitCursor')
    .addToUi();
}