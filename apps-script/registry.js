/**********************************************************************
 * VITHYA TRADERS — WORKBOOK REGISTRY
 *
 * Globals declared here (check before pasting):
 *   REG, REG_PLAN, vtSheet, vtBookOf, vtBooks, registerBook, setupAllBooks,
 *   migrateTabs, migratePlan, registryStatus, verifyMigration,
 *   regProp_, regSet_, regFind_, vtGuardRebuild_, onOpenRegistry
 *
 * ── THE PROBLEM WITH HARDCODING ──
 *   Every reader currently says txnBook_() or getActiveSpreadsheet(). Move a
 *   tab and every one of them breaks. With six workbooks coming, that is
 *   dozens of edits and one forgotten reference away from a silent failure.
 *
 * ── THE FIX ──
 *   vtSheet('Product_Analytics') finds the tab in whichever workbook holds
 *   it, and remembers where. Move the tab, and nothing else changes.
 *
 * ── THE SPLIT, IN SAFE ORDER ──
 *   VT_Analytics first: every tab in it is COMPUTED and rebuildable, so a
 *   mistake costs a re-run rather than data. Raw transaction history moves
 *   last, and only after the machinery is proven on tabs that do not matter.
 *
 * ── MIGRATION IS COPY, VERIFY, THEN DELETE ──
 *   Never move-and-hope. The source tab is deleted only after the row and
 *   column counts match in the destination. If they do not, the source stays
 *   and you are told.
 *
 * ── RUN ──
 *   setupAllBooks()      create/link the workbooks
 *   migratePlan()        move the computed tabs to VT_Analytics
 *   registryStatus()     where every tab lives, and cell counts
 **********************************************************************/

const REG = {
  PROP: 'VT_BOOKS',           // {alias: spreadsheetId}
  MAP: 'VT_TAB_MAP',          // {tabName: alias}  — a cache, rebuilt on miss
};

/* which computed tabs belong in the analytics book. All are rebuildable. */
const REG_PLAN = [
  { to: 'analytics', tabs: ['Sales_Monthly', 'Product_Analytics',
      'Customer_Outstanding', 'Read_Models'] },
];

function regProp_(name, dflt) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) return dflt;
  try { return JSON.parse(v); } catch (e) { return dflt; }
}
function regSet_(name, obj) {
  PropertiesService.getScriptProperties().setProperty(name, JSON.stringify(obj));
}

/* ---------- the book list ---------- */

function vtBooks() {
  const b = regProp_(REG.PROP, {});
  /* the master is always the container this script is bound to */
  b.master = SpreadsheetApp.getActiveSpreadsheet().getId();
  /* adopt ids already set by earlier scripts, so nothing needs re-entering */
  const p = PropertiesService.getScriptProperties();
  if (!b.txn) { const t = p.getProperty('VT_TXN_BOOK_ID'); if (t) b.txn = t; }
  if (!b.analytics) { const a = p.getProperty('VT_ANALYTICS_BOOK_ID'); if (a) b.analytics = a; }
  return b;
}

function registerBook(alias, id) {
  if (!alias || !id) throw new Error("registerBook('sales2526', '1AbC...')");
  const ss = SpreadsheetApp.openById(String(id).trim());   // throws if wrong
  const b = regProp_(REG.PROP, {});
  b[String(alias)] = ss.getId();
  regSet_(REG.PROP, b);
  regSet_(REG.MAP, {});                                    // location cache is stale
  return ss.getName();
}

function setupAllBooks() {
  const b = vtBooks();
  const made = [];
  const need = [
    ['txn', 'VT_Transactions', 'raw transaction pulls'],
    ['analytics', 'VT_Analytics', 'computed tables and read models'],
  ];
  need.forEach(function (n) {
    if (b[n[0]]) return;
    const ss = SpreadsheetApp.create(n[1]);
    const f = ss.getSheets()[0];
    f.setName('README');
    f.getRange(1, 1, 3, 1).setValues([[n[1]], [''], [n[2]]]);
    f.getRange(1, 1).setFontWeight('bold').setFontSize(13);
    b[n[0]] = ss.getId();
    made.push(n[1] + '  ' + ss.getUrl());
  });
  regSet_(REG.PROP, b);
  /* keep the older property names in step, so existing code still resolves */
  const p = PropertiesService.getScriptProperties();
  if (b.txn) p.setProperty('VT_TXN_BOOK_ID', b.txn);
  if (b.analytics) p.setProperty('VT_ANALYTICS_BOOK_ID', b.analytics);

  const msg = 'WORKBOOKS\n\n' +
    Object.keys(b).sort().map(function (k) {
      let nm = '(unreadable)';
      try { nm = SpreadsheetApp.openById(b[k]).getName(); } catch (e) {}
      return '   ' + k + ': ' + nm;
    }).join('\n') +
    (made.length ? '\n\ncreated:\n   ' + made.join('\n   ') : '\n\nAll already exist.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return b;
}

/* ---------- find a tab, wherever it lives ---------- */

function regFind_(tabName) {
  const books = vtBooks();
  /* master first, then analytics, then the rest — cheapest likely hit first */
  const order = ['master', 'analytics', 'txn'].concat(
    Object.keys(books).filter(function (k) {
      return ['master', 'analytics', 'txn'].indexOf(k) < 0;
    }));
  for (let i = 0; i < order.length; i++) {
    const alias = order[i];
    if (!books[alias]) continue;
    try {
      const ss = SpreadsheetApp.openById(books[alias]);
      if (ss.getSheetByName(tabName)) return alias;
    } catch (e) { /* unreadable book, skip */ }
  }
  return null;
}

/**
 * The one function every reader should use.
 * vtSheet('Product_Analytics') returns the Sheet, from whichever workbook
 * currently holds it. The location is cached, and the cache self-heals when
 * a tab has moved.
 */
function vtSheet(tabName) {
  const map = regProp_(REG.MAP, {});
  const books = vtBooks();
  if (map[tabName] && books[map[tabName]]) {
    try {
      const sh = SpreadsheetApp.openById(books[map[tabName]]).getSheetByName(tabName);
      if (sh) return sh;
    } catch (e) { /* fall through and re-find */ }
  }
  const alias = regFind_(tabName);
  if (!alias) return null;
  map[tabName] = alias;
  regSet_(REG.MAP, map);
  return SpreadsheetApp.openById(books[alias]).getSheetByName(tabName);
}

function vtBookOf(tabName) {
  const a = regFind_(tabName);
  return a;
}

/* ---------- migration ---------- */

/**
 * Copy, verify, then delete. The source is removed ONLY when the destination
 * matches on rows and columns. Anything else leaves both in place and says so.
 */
function migrateTabs(toAlias, tabNames) {
  const books = vtBooks();
  if (!books[toAlias]) throw new Error('Unknown workbook: ' + toAlias +
    '. Run setupAllBooks() first.');
  const dest = SpreadsheetApp.openById(books[toAlias]);
  const report = [];
  let moved = 0, skipped = 0, failed = 0;

  tabNames.forEach(function (name) {
    const src = vtSheet(name);
    if (!src) { report.push('   ' + name + ': not found anywhere'); skipped++; return; }
    const srcBook = src.getParent();
    if (srcBook.getId() === dest.getId()) {
      report.push('   ' + name + ': already there'); skipped++; return;
    }
    const rows = src.getLastRow(), cols = src.getLastColumn();

    if (dest.getSheetByName(name)) {
      report.push('   ' + name + ': a tab of that name already exists in ' +
        toAlias + ' — not overwritten');
      skipped++; return;
    }

    let copied;
    try {
      copied = src.copyTo(dest);
      copied.setName(name);
    } catch (e) {
      report.push('   ' + name + ': copy failed — ' + e.message);
      failed++; return;
    }

    /* verify before anything is deleted */
    const gotRows = copied.getLastRow(), gotCols = copied.getLastColumn();
    if (gotRows !== rows || gotCols !== cols) {
      report.push('   ' + name + ': VERIFY FAILED  ' + rows + 'x' + cols +
        ' -> ' + gotRows + 'x' + gotCols + '  — source kept, copy left in place');
      failed++; return;
    }

    try { srcBook.deleteSheet(src); }
    catch (e) {
      report.push('   ' + name + ': copied but source not deleted — ' + e.message);
      failed++; return;
    }
    report.push('   ' + name + ': ' + rows.toLocaleString() + ' rows moved');
    moved++;
  });

  regSet_(REG.MAP, {});     /* locations changed */
  try { vtInvalidate(); } catch (e) {}

  const msg = 'MIGRATION -> ' + toAlias + '\n\n' + report.join('\n') +
    '\n\nmoved ' + moved + ', skipped ' + skipped + ', failed ' + failed +
    (failed ? '\n\nNothing was lost — failures leave the source in place.' : '');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return { moved: moved, skipped: skipped, failed: failed };
}

/** Move the computed tabs to VT_Analytics. Every one is rebuildable. */
function migratePlan() {
  let total = { moved: 0, skipped: 0, failed: 0 };
  REG_PLAN.forEach(function (p) {
    const r = migrateTabs(p.to, p.tabs);
    total.moved += r.moved; total.skipped += r.skipped; total.failed += r.failed;
  });
  return total;
}

/* ---------- header guard ---------- */

/**
 * Write a tab's header and keep it in step with the column list.
 *
 * Headers were being written only when a tab was CREATED. Add a column to the
 * list later and the existing tab keeps its old header, so every column past
 * the change reads one place out — Stock_Live returned 904 for updated_at
 * that way, and nothing complained.
 *
 * Returns true if the header changed, which means the rows below it were
 * written to a different shape and are no longer trustworthy.
 */
function vtHeader_(sh, cols, colour) {
  if (sh.getMaxColumns() < cols.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
  }
  const cur = sh.getRange(1, 1, 1, cols.length).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  if (cur.join('|') === cols.join('|')) return false;
  sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold')
    .setBackground(colour || '#CC3018').setFontColor('#FFFFFF');
  return true;
}

/* ---------- rebuild guard ---------- */

/**
 * Derived tables are cleared and rewritten every night, which is correct —
 * they are recomputed from source. The danger is rebuilding from a source
 * that is empty or half-loaded: the table is then wrong, not missing, and
 * nothing looks broken.
 *
 * That is how Sales_Monthly went from 84,773 rows to 584 unnoticed.
 *
 * Call before writing. It throws if the new size collapses without reason.
 * Pass force=true for a deliberate rebuild after a known data change.
 */
function vtGuardRebuild_(tabName, newRows, force) {
  if (force) return true;
  const sh = vtSheet(tabName);
  const had = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  if (had < 500) return true;                 // nothing meaningful to protect
  /* 0.25, not 0.5. A legitimate rebuild CAN halve a table — fixing the month
     key bug correctly took Sales_Monthly from 84,773 to 39,867. A 75%+
     collapse is a different animal: that is an empty source, not a fix. */
  if (newRows >= had * 0.25) return true;
  throw new Error('REFUSING TO REBUILD ' + tabName + '.\n\n' +
    'It holds ' + had.toLocaleString() + ' rows but the rebuild produced only ' +
    newRows.toLocaleString() + ' — a ' +
    Math.round((1 - newRows / had) * 100) + '% collapse.\n\n' +
    'That usually means the SOURCE is empty or half-loaded, not that the ' +
    'business shrank. Nothing was overwritten.\n\n' +
    'Check the source, then re-run. If the drop is genuine, the rebuild ' +
    'function accepts a force flag.');
}

/* ---------- status ---------- */

function registryStatus() {
  const books = vtBooks();
  const lines = [];
  Object.keys(books).sort().forEach(function (alias) {
    let ss;
    try { ss = SpreadsheetApp.openById(books[alias]); }
    catch (e) { lines.push(alias + ': UNREADABLE'); return; }
    let cells = 0;
    const tabs = ss.getSheets().map(function (s) {
      const c = s.getLastRow() * s.getLastColumn();
      cells += c;
      return '      ' + s.getName() + '  ' + s.getLastRow().toLocaleString() +
        ' rows, ' + c.toLocaleString() + ' cells';
    });
    lines.push(alias + '  —  ' + ss.getName() + '\n' +
      '      TOTAL ' + cells.toLocaleString() + ' of 10,000,000  (' +
      (cells / 10000000 * 100).toFixed(1) + '%)\n' + tabs.join('\n'));
  });
  const msg = 'WORKBOOK REGISTRY\n\n' + lines.join('\n\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
}

/** Read-only check that every tab the system needs can be found. */
function verifyMigration() {
  const need = ['Products_Core', 'Pricing', 'ERP_Snapshot', 'Batch_Cost',
    'Cost_Current', 'Dash_Data', 'Verified_Pricing',
    'Sales_Monthly', 'Product_Analytics',
    'Customer_Outstanding', 'Stock_History', 'Stock_Latest', 'Count_Tasks',
    'Inventory_Config', 'Read_Models'];
  const found = [], lost = [];
  need.forEach(function (t) {
    const a = vtBookOf(t);
    if (a) found.push('   ' + t + '  ->  ' + a);
    else lost.push('   ' + t);
  });

  /* Sales tabs may be un-split (Sales_Items) or split by year
     (Sales_Items_2526). Either is fine — none at all is not. */
  ['Sales_Items', 'Sales_Invoices'].forEach(function (base) {
    const plain = vtBookOf(base);
    if (plain) { found.push('   ' + base + '  ->  ' + plain + '  (not yet split)'); return; }
    const years = [];
    const books = vtBooks();
    Object.keys(books).forEach(function (alias) {
      let ss;
      try { ss = SpreadsheetApp.openById(books[alias]); } catch (e) { return; }
      ss.getSheets().forEach(function (sh) {
        if (sh.getName().indexOf(base + '_') === 0) {
          years.push(sh.getName() + ' -> ' + alias + ' (' +
            Math.max(0, sh.getLastRow() - 1).toLocaleString() + ' rows)');
        }
      });
    });
    if (years.length) years.forEach(function (y) { found.push('   ' + y); });
    else lost.push('   ' + base + '  (and no year tabs either)');
  });
  const msg = 'TAB LOCATIONS\n\n' + found.join('\n') +
    (lost.length ? '\n\nNOT FOUND — these will fail at runtime:\n' + lost.join('\n') :
      '\n\nEvery expected tab was found.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return { found: found.length, lost: lost.length };
}

function onOpenRegistry() {
  SpreadsheetApp.getUi()
    .createMenu('🗂️ Workbooks')
    .addItem('Set up workbooks', 'setupAllBooks')
    .addItem('Where is every tab?', 'verifyMigration')
    .addItem('Status + cell counts', 'registryStatus')
    .addSeparator()
    .addItem('Move computed tabs to VT_Analytics', 'migratePlan')
    .addToUi();
}