/**********************************************************************
 * VITHYA TRADERS — SALES & ANALYTICS AUTOMATION
 *
 * Globals declared here (check before pasting):
 *   SAUT, refreshSalesRecent, refreshInvoicesRecent, nightlyAnalytics,
 *   nightlyRollup, nightlyCustomers, nightlyStock, nightlyModels,
 *   diagnoseSalesDates, fixSalesDateColumns,
 *   installSalesTriggers, removeSalesTriggers, salesAutoStatus,
 *   sautLog_, sautRun_, sautNum_, sautDate_, sautWindow_, sautPost_, sautPurge_
 *
 * ── THE PROBLEM THIS SOLVES ──
 *   Everything built so far runs by hand. Product_Analytics would go stale
 *   within days and the dashboard would quietly show last week's numbers —
 *   the worst kind of failure, because nothing looks broken.
 *
 *   But re-pulling 192,057 sales lines nightly is not possible: 385 calls at
 *   20s is over two hours, every night, against a rate-limited endpoint.
 *
 * ── THE APPROACH: A ROLLING WINDOW ──
 *   Only the last N days are refreshed (7 by default). Those rows are deleted
 *   and re-pulled, so late entries and edits inside the window are picked up.
 *   Roughly 4,000 lines = 8 calls = under three minutes.
 *
 *   Anything older than the window is treated as settled. If a bill is edited
 *   two months back it will not be noticed — run a wider refresh occasionally
 *   (refreshSalesRecent(60)) or a full re-pull if you ever need certainty.
 *   That trade-off is deliberate: nightly certainty would cost two hours a day.
 *
 * ── NIGHTLY CHAIN ──
 *   05:30  refreshInvoicesRecent   invoice level, for outstanding
 *   06:00  refreshSalesRecent      line level, for demand
 *   22:00  nightlyRollup           rollup -> product analytics
 *   22:20  nightlyCustomers        outstanding, contacts, prices
 *   22:40  nightlyStock            live stock, PO status
 *   23:00  nightlyModels           digest snapshot, read models
 *   23:00  snapshotStock           (already installed by StockHistory.gs)
 *   23:30  detectCounts            confirm stock corrections made in Vasy
 *
 * ── RUN ──
 *   installSalesTriggers()     once
 *   salesAutoStatus()          what ran and when
 *   refreshSalesRecent(30)     wider catch-up, by hand
 **********************************************************************/

const SAUT = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',

  ITEM_PATH: '/api/v1/report/sales-item-register/invoice',
  INV_PATH: '/api/v1/sales/get-all-sales-orders',

  ITEMS: 'Sales_Items',
  INVOICES: 'Sales_Invoices',
  LOG: 'Automation_Log',

  WINDOW_DAYS: 7,
  /* a 7-day window is ~2% of a year's rows. 25% is already absurd — anything
     above it means the dates or the tab are wrong, not that trade boomed. */
  MAX_PURGE_PCT: 0.25,
  ITEM_PAGE: 500,
  INV_PAGE: 100,
  GAP: 20000,
  BACKOFF: [45000, 90000, 150000],
  MAX_RUN_MS: 260000,
};

function sautNum_(v) { const n = Number(v); return isFinite(n) ? n : 0; }

/**
 * Every date shape this system has actually produced, normalised to
 * yyyy-MM-dd. Anything unrecognised returns '' — and '' means NEVER DELETE.
 *
 * This matters more than it looks. The year split copied Date objects into a
 * column formatted as plain text, so Sheets wrote them as
 * "Fri Aug 07 2026 00:00:00 GMT+0530". The old parser fell back to
 * slice(0,10) = "Fri Aug 07", and "F" sorts above "2", so EVERY row compared
 * as inside the refresh window. The purge guard caught it; without that guard
 * it would have deleted 62,396 sales lines.
 */
const SAUT_MON = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                   jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };

function sautDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  if (!s) return '';

  /* 2026-08-07 or 2026-08-07T… or 2026-08-07 15:14 */
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];

  /* Fri Aug 07 2026 …  — a Date that was stringified into a text cell */
  m = s.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  if (m) {
    const mo = SAUT_MON[m[1].toLowerCase()];
    if (mo) return m[3] + '-' + mo + '-' + ('0' + m[2]).slice(-2);
  }

  /* 07/08/2026 or 07-08-2026 — day first, as the registers export it */
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);

  /* 2026/08/07 */
  m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);

  return '';                      // unreadable — the caller must not delete it
}

/* the refresh window, as ISO strings */
function sautWindow_(days) {
  /* Apps Script passes an EVENT OBJECT to every trigger handler, so a
     triggered refreshSalesRecent() receives {triggerUid, authMode, ...} as
     `days`. An object is truthy, so `days || 7` kept the object, object *
     86400000 was NaN, and formatDate rendered NaN as 1970-01-01 — after
     which every row in the tab compared as inside the window and the purge
     guard refused 100% of them, every night, for a week.

     Manual runs always worked because nothing was passed. That difference
     is exactly what made it look like a data problem. */
  const n = Number(days);
  const d = (isFinite(n) && n > 0) ? n : SAUT.WINDOW_DAYS;
  const to = new Date();
  const from = new Date(to.getTime() - d * 86400000);
  const iso = x => Utilities.formatDate(x, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  const day = x => Utilities.formatDate(x, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new Error('Bad refresh window (days=' + JSON.stringify(days) + '). ' +
      'Nothing was touched.');
  }
  return { fromIso: iso(from), toIso: iso(to), fromDay: day(from), toDay: day(to) };
}

function sautProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function sautPost_(path, body) {
  const url = sautProp_(SAUT.BASE).replace(/\/+$/, '') + path;
  for (let a = 0; a <= SAUT.BACKOFF.length; a++) {
    const r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'api-token': sautProp_(SAUT.TOKEN) },
      payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    const code = r.getResponseCode(), txt = r.getContentText();
    if (code === 200) {
      const j = JSON.parse(txt);
      if (j.status === false) throw new Error('API: ' + (j.message || ''));
      return j.response || {};
    }
    if (code === 429) {
      if (a === SAUT.BACKOFF.length) return { __rate: true };
      Utilities.sleep(SAUT.BACKOFF[a]);
      continue;
    }
    throw new Error('HTTP ' + code + ' :: ' + txt.slice(0, 200));
  }
  return { __rate: true };
}

/* ---------- logging, shared with Automation.gs ---------- */

function sautLog_(job, status, detail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SAUT.LOG);
  if (!sh) {
    sh = ss.insertSheet(SAUT.LOG);
    sh.getRange(1, 1, 1, 4).setValues([['when', 'job', 'status', 'detail']]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 4).setFontWeight('bold')
      .setBackground('#CC3018').setFontColor('#FFFFFF');
  }
  sh.appendRow([Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'), job, status, String(detail || '').slice(0, 400)]);
  if (sh.getLastRow() > 800) sh.deleteRows(2, 300);
}

function sautRun_(job, fn) {
  const t0 = Date.now();
  try {
    const res = fn();
    sautLog_(job, 'ok', (res === undefined ? '' : res) +
      '  (' + Math.round((Date.now() - t0) / 1000) + 's)');
  } catch (e) {
    sautLog_(job, 'FAILED', e.message);
    Logger.log(job + ' FAILED: ' + e.message);
  }
}

/* ---------- the year tab a refresh should write into ---------- */

/**
 * After the year split, a nightly refresh must write into the tab for the
 * financial year it is refreshing — otherwise the split silently undoes
 * itself, one night at a time.
 * Falls back to the un-split tab when the split has not been run.
 */
function sautTargets_(base, fromDay, toDay) {
  const out = [];
  try {
    const fys = {};
    fys[syFY(fromDay)] = 1;
    fys[syFY(toDay)] = 1;      // a window can straddle 31 March
    Object.keys(fys).forEach(function (fy) {
      if (!fy) return;
      const name = syTabName(base, fy);
      let sh = vtSheet(name);
      if (!sh) {
        const book = ensureYearBook(fy);
        /* headers come from the base tab if it still exists, otherwise from
           ANY existing year tab — after a split the base tab is gone, which
           is why the nightly jobs were failing with "does not exist" */
        let src = vtSheet(base);
        if (!src) {
          const existing = salesYearTabs(base).filter(function (t) { return t.fy; });
          if (existing.length) src = existing[0].sh;
        }
        if (!src) return;
        const hdr = src.getRange(1, 1, 1, src.getLastColumn()).getValues()[0];
        sh = book.insertSheet(name);
        const w = hdr.length;
        if (sh.getMaxColumns() < w) sh.insertColumnsAfter(sh.getMaxColumns(), w - sh.getMaxColumns());
        sh.getRange(1, 1, 1, w).setValues([hdr]);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, w).setFontWeight('bold')
          .setBackground('#CC3018').setFontColor('#FFFFFF');
      }
      out.push({ fy: fy, sh: sh });
    });
  } catch (e) { /* split not installed */ }
  if (!out.length) {
    const legacy = vtSheet(base);
    if (legacy) out.push({ fy: '', sh: legacy });
  }
  return out;
}

/* ---------- delete rows inside the window, so a re-pull cannot duplicate ---------- */

/**
 * Delete rows inside the refresh window so a re-pull cannot duplicate them.
 *
 * THIS FUNCTION DESTROYED 188,000 ROWS. What went wrong: it deleted every row
 * whose date fell inside the window, trusting that the re-pull would put them
 * back. When the tab it purged was not the tab the pull then wrote to, the
 * delete happened and the restore did not.
 *
 * Three guards now, and it refuses rather than guesses:
 *
 *   1. NEVER remove more than MAX_PURGE_PCT of the tab. A 7-day window cannot
 *      legitimately contain most of a year's sales. If it looks like it does,
 *      something is wrong with the dates or the tab, and deleting is the worst
 *      possible response.
 *   2. NEVER remove rows outside the window, even by rounding — a row with an
 *      unreadable date is KEPT, not dropped.
 *   3. Return what it would remove without removing it, so callers can check
 *      before committing.
 */
function sautPurge_(sheetName, dateField, fromDay, targetSheet, dryRun) {
  const sh = targetSheet || vtSheet(sheetName);
  if (!sh || sh.getLastRow() < 2) return 0;
  const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const H = {};
  hdr.forEach(function (h, i) { const k = String(h).trim(); if (k) H[k] = i; });
  if (H[dateField] === undefined) throw new Error(sheetName + ': no ' + dateField);

  const n = sh.getLastRow() - 1, w = sh.getLastColumn();
  const v = sh.getRange(2, 1, n, w).getValues();

  /* keep anything before the window AND anything whose date cannot be read */
  const keep = v.filter(function (r) {
    const d = sautDate_(r[H[dateField]]);
    if (!d) return true;                       // unreadable date: never delete
    return d < fromDay;
  });
  /* if almost nothing parsed, the column is not what we think it is and no
     comparison below can be trusted */
  let readable = 0;
  for (let i = 0; i < Math.min(n, 200); i++) {
    if (sautDate_(v[i][H[dateField]])) readable++;
  }
  const sample = Math.min(n, 200);
  if (sample > 0 && readable < sample * 0.9) {
    throw new Error('REFUSING TO PURGE ' + sheetName + '.\n\nOnly ' + readable +
      ' of ' + sample + ' sampled dates could be read from "' + dateField +
      '".\n\nThe column is probably storing Date objects in a text-formatted ' +
      'cell. Run fixSalesDateColumns() to normalise it. Nothing was deleted.');
  }

  const dropped = n - keep.length;
  if (!dropped) return 0;

  /* a window that reaches back before the business started is a bug in the
     caller, not a big refresh */
  if (fromDay < '2020-01-01') {
    throw new Error('REFUSING TO PURGE ' + sheetName + '.\n\nThe window starts ' +
      fromDay + ', which is not a real date. Nothing was touched.');
  }

  const pct = dropped / n;
  if (pct > SAUT.MAX_PURGE_PCT) {
    /* Show what the dates actually look like. "100% would be removed" says
       nothing about WHY, and four nights have been lost to guessing. */
    const peek = [];
    for (let i = 0; i < Math.min(n, 6); i++) {
      const raw = v[i][H[dateField]];
      peek.push('      ' + JSON.stringify(String(raw)).slice(0, 40) +
        '  ->  ' + (sautDate_(raw) || '(unreadable)'));
    }
    throw new Error('REFUSING TO PURGE ' + sheetName + '.\n\n' +
      'It would remove ' + dropped.toLocaleString() + ' of ' + n.toLocaleString() +
      ' rows (' + Math.round(pct * 100) + '%) for a ' + SAUT.WINDOW_DAYS +
      '-day window. Nothing was deleted.\n\n' +
      'window starts ' + fromDay + '\n' +
      'column "' + dateField + '" is index ' + H[dateField] + '\n\n' +
      'first rows as they read:\n' + peek.join('\n'));
  }
  if (dryRun) return dropped;

  sh.getRange(2, 1, n, w).clearContent();
  const B = 5000;
  for (let i = 0; i < keep.length; i += B) {
    const blk = keep.slice(i, i + B);
    sh.getRange(2 + i, 1, blk.length, w).setValues(blk);
  }
  return dropped;
}

/**
 * Rewrites the date column of every sales tab as plain yyyy-MM-dd text.
 *
 * The split left Date objects in text-formatted cells. Reading them back
 * gives "Fri Aug 07 2026 …", which no comparison handles. This normalises
 * them once. It changes nothing but the date column, and it will not run if
 * the dates cannot be parsed.
 */
function fixSalesDateColumns() {
  const report = [];
  [SAUT.ITEMS, SAUT.INVOICES].forEach(function (base) {
    let tabs = [];
    try {
      tabs = salesYearTabs(base);
    } catch (e) {
      const sh = vtSheet(base);
      if (sh) tabs = [{ tab: base, sh: sh }];
    }
    tabs.forEach(function (t) {
      const sh = t.sh;
      if (!sh || sh.getLastRow() < 2) return;
      const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
        .map(function (x) { return String(x).trim(); });
      const ci = hdr.indexOf('salesDate');
      if (ci < 0) { report.push('   ' + t.tab + ': no salesDate column'); return; }
      const n = sh.getLastRow() - 1;
      const col = sh.getRange(2, ci + 1, n, 1).getValues();

      let ok = 0, bad = 0;
      const out = col.map(function (r) {
        const d = sautDate_(r[0]);
        if (d) ok++; else bad++;
        return [d || r[0]];
      });
      if (bad > n * 0.1) {
        report.push('   ' + t.tab + ': ' + bad + ' of ' + n +
          ' unreadable — NOT touched');
        return;
      }
      sh.getRange(2, ci + 1, n, 1).setNumberFormat('@');
      sh.getRange(2, ci + 1, n, 1).setValues(out);
      report.push('   ' + t.tab + ': ' + ok.toLocaleString() + ' dates normalised' +
        (bad ? ', ' + bad + ' left alone' : ''));
    });
  });
  const msg = 'SALES DATE COLUMNS\n\n' + (report.length ? report.join('\n') : 'nothing found') +
    '\n\nThe nightly refresh compares these as text, so they must be\n' +
    'yyyy-MM-dd and not Date objects sitting in text cells.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/**
 * READ ONLY. What is actually in the salesDate column of every sales tab.
 *
 * Four nights lost to "it would remove 100%" without knowing why. The
 * readability guard passes, so the dates DO parse — which means either they
 * all genuinely fall inside the window (impossible for a tab spanning April
 * to August) or the column being read is not the one we think.
 *
 * This prints the header, which index salesDate resolved to, and how the
 * first rows parse. One run, no API calls, nothing written.
 */
function diagnoseSalesDates() {
  const L = ['WHAT IS IN THE SALES DATE COLUMNS', ''];
  const win = sautWindow_();
  L.push('the 7-day window starts ' + win.fromDay + ' and ends ' + win.toDay);
  L.push('');

  [SAUT.ITEMS, SAUT.INVOICES].forEach(function (base) {
    let tabs = [];
    try { tabs = salesYearTabs(base).filter(function (t) { return t.sh; }); }
    catch (e) { tabs = []; }
    if (!tabs.length) {
      const sh = vtSheet(base);
      if (sh) tabs = [{ tab: base, sh: sh }];
    }
    tabs.forEach(function (t) {
      const sh = t.sh;
      L.push('── ' + t.tab + '  (' + Math.max(0, sh.getLastRow() - 1).toLocaleString() +
        ' rows) ──');
      if (sh.getLastRow() < 2) { L.push('   empty'); L.push(''); return; }
      const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
        .map(function (x) { return String(x).trim(); });
      const ix = hdr.indexOf('salesDate');
      L.push('   salesDate is column ' + ix + ' of ' + hdr.length +
        (ix < 0 ? '   NOT FOUND' : '   header reads "' + hdr[ix] + '"'));
      if (ix < 0) {
        L.push('   headers: ' + hdr.join(', ').slice(0, 300));
        L.push('');
        return;
      }
      const take = Math.min(8, sh.getLastRow() - 1);
      const rows = sh.getRange(2, ix + 1, take, 1).getValues();
      rows.forEach(function (r) {
        const parsed = sautDate_(r[0]);
        L.push('      ' + JSON.stringify(String(r[0])).slice(0, 42).padEnd(44) +
          ' -> ' + (parsed || '(unreadable)') +
          (parsed ? (parsed < win.fromDay ? '   keep' : '   DROP') : '   keep'));
      });
      /* and how the whole tab splits */
      const n = sh.getLastRow() - 1;
      const all = sh.getRange(2, ix + 1, n, 1).getValues();
      let keep = 0, drop = 0, bad = 0;
      const months = {};
      all.forEach(function (r) {
        const d = sautDate_(r[0]);
        if (!d) { bad++; return; }
        months[d.slice(0, 7)] = (months[d.slice(0, 7)] || 0) + 1;
        if (d < win.fromDay) keep++; else drop++;
      });
      L.push('   of ' + n.toLocaleString() + ': keep ' + keep.toLocaleString() +
        ', drop ' + drop.toLocaleString() + ', unreadable ' + bad.toLocaleString());
      const ms = Object.keys(months).sort();
      L.push('   months present: ' + (ms.length ? ms[0] + ' .. ' + ms[ms.length - 1] +
        '  (' + ms.length + ')' : 'none'));
      L.push('');
    });
  });
  const msg = L.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 1400)); } catch (e) {}
  return msg;
}

/* ================= 1. sales lines ================= */

function refreshSalesRecent(days) {
  sautRun_('Sales_Items', function () {
    const win = sautWindow_(days);
    /* after the year split the base tab is gone and the data lives in
       Sales_Items_2526 / _2627. sautTargets_ resolves the right tab(s) for
       this window and creates one if a new financial year has just begun. */
    const targets = sautTargets_(SAUT.ITEMS, win.fromDay, win.toDay);
    if (!targets.length) {
      throw new Error('No Sales_Items tab found (base or year). Run the first pull.');
    }
    let removed = 0;
    targets.forEach(function (t) {
      removed += sautPurge_(SAUT.ITEMS, 'salesDate', win.fromDay, t.sh);
    });
    const sh = targets[targets.length - 1].sh;
    const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(x => String(x).trim());

    const t0 = Date.now();
    let offset = 0, total = 0, wrote = 0;
    while (true) {
      if (Date.now() - t0 > SAUT.MAX_RUN_MS) {
        return 'partial — stopped at ' + offset + ' of ' + total +
          '; the next run refreshes the window again';
      }
      const r = sautPost_(SAUT.ITEM_PATH, {
        branch_list: sautProp_(SAUT.BRANCH),
        from_date: win.fromIso, to_date: win.toIso,
        limit: SAUT.ITEM_PAGE, offset: offset,
      });
      if (r.__rate) return 'rate limited at ' + offset;
      if (!total) total = sautNum_(r.totalCount);
      const rows = (r.salesItemRegisterData || []);
      if (!rows.length) break;

      const vals = rows.map(o => hdr.map(h => {
        switch (h) {
          case 'salesDate': return sautDate_(o.salesDate);
          case 'discount': return sautNum_(o.totalDiscount);
          default:
            const v = o[h];
            if (v === null || v === undefined) return '';
            return (typeof v === 'number') ? (isFinite(v) ? v : '') : v;
        }
      }));
      sautWriteByYear_(targets, sh, vals, hdr, 'salesDate');
      wrote += vals.length;
      offset += rows.length;
      if (offset >= total) break;
      Utilities.sleep(SAUT.GAP);
    }
    return 'window ' + win.fromDay + '..' + win.toDay +
      ' — removed ' + removed + ', added ' + wrote;
  });
}

/** send each row to the tab for its own financial year */
function sautWriteByYear_(targets, fallback, vals, hdr, dateField) {
  if (targets.length <= 1) {
    fallback.getRange(fallback.getLastRow() + 1, 1, vals.length, hdr.length).setValues(vals);
    return;
  }
  const di = hdr.indexOf(dateField);
  const byFy = {};
  vals.forEach(function (v) {
    const fy = (di >= 0) ? syFY(sautDate_(v[di])) : '';
    (byFy[fy] = byFy[fy] || []).push(v);
  });
  targets.forEach(function (t) {
    const rows = byFy[t.fy];
    if (!rows || !rows.length) return;
    t.sh.getRange(t.sh.getLastRow() + 1, 1, rows.length, hdr.length).setValues(rows);
  });
}

/* ================= 2. invoices ================= */

function refreshInvoicesRecent(days) {
  sautRun_('Sales_Invoices', function () {
    const win = sautWindow_(days);
    const targets = sautTargets_(SAUT.INVOICES, win.fromDay, win.toDay);
    if (!targets.length) {
      throw new Error('No Sales_Invoices tab found (base or year). Run the first pull.');
    }
    let removed = 0;
    targets.forEach(function (t) {
      removed += sautPurge_(SAUT.INVOICES, 'salesDate', win.fromDay, t.sh);
    });
    const sh = targets[targets.length - 1].sh;
    const hdr = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
      .map(x => String(x).trim());

    const t0 = Date.now();
    let offset = 0, total = 0, wrote = 0;
    while (true) {
      if (Date.now() - t0 > SAUT.MAX_RUN_MS) {
        return 'partial — stopped at ' + offset + ' of ' + total;
      }
      const r = sautPost_(SAUT.INV_PATH, {
        branch_list: sautProp_(SAUT.BRANCH),
        from_date: win.fromIso, to_date: win.toIso,
        limit: SAUT.INV_PAGE, offset: offset,
      });
      if (r.__rate) return 'rate limited at ' + offset;
      if (!total) total = sautNum_(r.totalCount);
      const rows = (r.salesDataListDTOList || []);
      if (!rows.length) break;

      const vals = rows.map(o => {
        const tot = sautNum_(o.total), paid = sautNum_(o.paidAmount);
        const map = {
          salesId: o.salesId, prefix: o.prefix || '', salesNo: o.salesNo,
          orderNo: o.orderNo || '', salesDate: sautDate_(o.salesDate),
          dueDate: sautDate_(o.dueDate), type: o.type || '',
          channelName: o.channelName || '', status: o.status || '',
          paymentType: o.paymentType || '',
          contactId: (o.contactId === undefined || o.contactId === null) ? '' : o.contactId,
          customerName: o.customerName || '', total: tot, paidAmount: paid,
          balance: Math.round((tot - paid) * 100) / 100,
        };
        return hdr.map(h => (map[h] === undefined ? '' : map[h]));
      });
      sautWriteByYear_(targets, sh, vals, hdr, 'salesDate');
      wrote += vals.length;
      offset += rows.length;
      if (offset >= total) break;
      Utilities.sleep(SAUT.GAP);
    }
    return 'window ' + win.fromDay + '..' + win.toDay +
      ' — removed ' + removed + ', added ' + wrote;
  });
}

/* ================= 3. rebuild everything downstream ================= */

/**
 * THE NIGHTLY CHAIN, SPLIT.
 *
 * This used to be one function doing everything. Measured, the work is about
 * 16.5 minutes; a triggered run gets 6. So it died part way every night,
 * silently, and whichever step it reached last simply never ran — which is
 * why Read models and Count detection were the ones missing.
 *
 * Each part below is under five minutes on its own and gets its own trigger,
 * fifteen minutes apart. The order still matters — analytics reads the
 * rollup, read models read analytics — and the spacing guarantees it.
 *
 *   22:00  nightlyRollup      sales rollup, analytics          ~4 min
 *   22:20  nightlyCustomers   outstanding, contacts, prices    ~3 min
 *   22:40  nightlyStock       live stock, PO status            ~5 min
 *   23:00  nightlyModels      digest snapshot, read models     ~5 min
 *
 * nightlyAnalytics() still exists and still runs all four, for when you want
 * to force the whole thing by hand — a manual run gets thirty minutes.
 */
function nightlyRollup() {
  sautRun_('Sales_Monthly', function () {
    buildSalesMonthly();
    const sh = vtSheet('Sales_Monthly');
    return (sh ? sh.getLastRow() - 1 : 0) + ' rows';
  });
  sautRun_('Product_Analytics', function () {
    const n = buildProductAnalytics();
    return n + ' products';
  });
}

function nightlyCustomers() {
  sautRun_('Customer_Outstanding', function () {
    buildOutstanding();
    const sh = vtSheet('Customer_Outstanding');
    return (sh ? sh.getLastRow() - 1 : 0) + ' customers';
  });
  sautRun_('Customer master', function () {
    const n = pullCustomers();
    return n + ' contacts';
  });
  sautRun_('Customer prices', function () {
    const n = buildCustomerPrices();
    return n + ' customer x product rows';
  });
}

function nightlyStock() {
  sautRun_('Live stock', function () {
    /* resumable — a part-way run stages and carries on next time */
    const n = pullStock();
    return n + ' products';
  });
  sautRun_('PO status', function () {
    const n = buildPoStatus();
    return n + ' products on order';
  });
}

function nightlyModels() {
  sautRun_('Digest snapshot', function () {
    const n = snapshotDigest();
    return n + ' products recorded';
  });
  sautRun_('Read models', function () {
    const n = buildReadModels();
    return n + ' cells written';
  });
}

/** all four, for a deliberate manual run */
function nightlyAnalytics() {
  nightlyRollup();
  nightlyCustomers();
  nightlyStock();
  nightlyModels();
}

/* confirm stock corrections made in Vasy during the day */
function nightlyDetectCounts() {
  sautRun_('Count detection', function () {
    const n = detectCounts();
    return n + ' confirmed';
  });
}

/* ================= 4. triggers ================= */

function installSalesTriggers() {
  /* Spread out because the whole chain is ~16 minutes of work and a
     triggered run gets 6. Each job below is under five minutes on its own,
     and the spacing preserves the order they depend on. */
  const jobs = [
    ['refreshInvoicesRecent', 5, 30],
    ['refreshSalesRecent', 6, 0],
    ['nightlyRollup', 22, 0],       // rollup -> analytics
    ['nightlyCustomers', 22, 20],   // outstanding, contacts, prices
    ['nightlyStock', 22, 40],       // live stock, PO status
    ['nightlyModels', 23, 0],       // digest snapshot, read models
    ['nightlyDetectCounts', 23, 30],
  ];
  const names = {};
  jobs.forEach(j => names[j[0]] = 1);
  ScriptApp.getProjectTriggers().forEach(t => {
    if (names[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
  jobs.forEach(j => {
    const b = ScriptApp.newTrigger(j[0]).timeBased().everyDays(1).atHour(j[1]);
    if (j[2]) b.nearMinute(j[2]);
    b.create();
  });
  const msg = 'SALES AUTOMATION INSTALLED\n\n' +
    '05:30  invoices, last ' + SAUT.WINDOW_DAYS + ' days\n' +
    '06:00  sales lines, last ' + SAUT.WINDOW_DAYS + ' days\n' +
    '22:00  monthly rollup, product analytics\n' +
    '22:20  outstanding, customer contacts, customer prices\n' +
    '22:40  live stock, PO status\n' +
    '23:00  digest snapshot, read models\n' +
    '23:30  confirm stock counts from Vasy\n\n' +
    'Split into four because the chain is about 16 minutes of work and a\n' +
    'triggered run only gets 6 — it used to die part way, silently.\n\n' +
    'Only the last ' + SAUT.WINDOW_DAYS + ' days are re-pulled. Older rows are\n' +
    'treated as settled. If a bill is edited further back, run\n' +
    'refreshSalesRecent(60) by hand to catch it.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function removeSalesTriggers() {
  const names = { refreshInvoicesRecent: 1, refreshSalesRecent: 1,
    nightlyAnalytics: 1, nightlyRollup: 1, nightlyCustomers: 1,
    nightlyStock: 1, nightlyModels: 1, nightlyDetectCounts: 1 };
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (names[t.getHandlerFunction()]) { ScriptApp.deleteTrigger(t); n++; }
  });
  try { SpreadsheetApp.getUi().alert('Removed ' + n + ' trigger(s).'); } catch (e) {}
}

function salesAutoStatus() {
  const trig = ScriptApp.getProjectTriggers()
    .map(t => t.getHandlerFunction()).sort();
  const counts = {};
  trig.forEach(h => counts[h] = (counts[h] || 0) + 1);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SAUT.LOG);
  let recent = '(no log yet)';
  if (sh && sh.getLastRow() > 1) {
    const n = Math.min(12, sh.getLastRow() - 1);
    recent = sh.getRange(sh.getLastRow() - n + 1, 1, n, 4).getValues()
      .map(r => '   ' + r[0] + '  ' + r[1] + '  ' + r[2] + '  ' +
        String(r[3]).slice(0, 60)).join('\n');
  }
  let rows = '';
  try {
    const t = txnBook_();
    ['Sales_Items', 'Sales_Invoices', 'Sales_Monthly', 'Product_Analytics',
     'Customer_Outstanding', 'Stock_History'].forEach(nm => {
      const s = t.getSheetByName(nm);
      rows += '   ' + nm + ': ' + (s ? Math.max(0, s.getLastRow() - 1) : 0) + '\n';
    });
  } catch (e) {}
  const msg = 'SALES AUTOMATION\n\n── triggers ──\n' +
    Object.keys(counts).sort().map(k => '   ' + k + ' x' + counts[k]).join('\n') +
    '\n\n── row counts ──\n' + rows +
    '\n── recent runs ──\n' + recent;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenSalesAuto() {
  SpreadsheetApp.getUi()
    .createMenu('🌙 Sales Automation')
    .addItem('Install nightly triggers', 'installSalesTriggers')
    .addItem('Status', 'salesAutoStatus')
    .addSeparator()
    .addItem('Refresh sales now', 'refreshSalesRecent')
    .addItem('Refresh invoices now', 'refreshInvoicesRecent')
    .addItem('Rebuild analytics now', 'nightlyAnalytics')
    .addSeparator()
    .addItem('Remove triggers', 'removeSalesTriggers')
    .addToUi();
}