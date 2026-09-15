/**********************************************************************
 * VITHYA TRADERS — CUSTOMER MASTER
 *
 * Globals declared here (check before pasting):
 *   CM, CM_COLS, pullCustomers, customerStatus, cmFind, cmByKey,
 *   resetCustomerLimit, cmNum_, cmDate_, cmName_, cmKey_, cmSheet_,
 *   cmBook_, cmProp_, onOpenCustomers
 *
 * ─ THE ENDPOINT, CONFIRMED 
 *   GET /api/v1/customers?branchId={branch}&limit=&offset=
 *
 *   The probe found three parameter spellings that answer, and they do NOT
 *   agree: branch_id returns 2,055 and branchId / branch_list return 2,158.
 *   Only branch_id is parsed as a filter; the other two are ignored and hand
 *   back every branch.
 *
 *   [VT-DW-031] We now use branchId — the UNFILTERED superset. A dimension
 *   table must never be narrower than the fact table that joins to it: a
 *   filtered pull turns an out-of-branch customer into an unresolvable ID
 *   that looks like a customer with no history. branchId is kept as a column
 *   so any consumer that wants one branch can filter downstream.
 *
 * ─ WHY IT MATTERS 
 *   contactId is the stable join key to Sales_Invoices, so a customer's price
 *   history stops depending on their name being spelled the same way twice.
 *   whatsAppNo and mobNo are what a "send this quote" button will need.
 *
 * ─ THE LEADING DOT 
 *   firstName "." with lastName "AADHI PUMPS" is the non-GST ledger for the
 *   same firm. That dot is meaning, not a typo, and the two must never be
 *   merged — so the lane is recorded explicitly.
 *
 * ─ RUN 
 *   pullCustomers()     ~2,000 contacts in a handful of paged calls
 *   customerStatus()
 *   cmFind('aadhi')
 **********************************************************************/

const CM = {
  BASE: 'VASY_BASE_URL',
  TOKEN: 'VASY_API_TOKEN',
  BRANCH: 'VASY_BRANCH_ID',
  PATH: '/api/v1/customers',
  SHEET: 'Customers',
  /* The probe worked at limit=5 but 200 returns
     "Issue in Request Headers for limit and offset" — the endpoint caps it
     and does not say where. Rather than guess, the pull negotiates: it tries
     the largest first and steps down until one is accepted, then keeps it. */
  /* 100 works but trips the limiter around offset 500-700. 50 halves the
     request rate for the same data and has been stable. */
  LIMIT_STEPS: [50, 25, 10, 5],
  LIMIT_PROP: 'CM_LIMIT',
  /* a light list endpoint, not a report — 1.2s between pages made the worst
     case 488s, past the 360s a triggered run gets. 400ms brings it to ~165s
     and backs off on its own if the endpoint objects. */
  /* the endpoint says "try after 60 seconds" on a 429, so a 5s retry was
     never going to clear it. Wait properly, and remember where we were so a
     run that still gets throttled resumes instead of starting over. */
  GAP: 900,
  BACKOFF: [20000, 45000, 65000],
  CURSOR: 'CM_CURSOR',
  /* Partial rows go to a SHEET, not a Script Property. 2,034 contacts is
     ~429KB of JSON and a property holds 9KB — the collection-in-a-property
     mistake that blew the quota once already. Properties hold scalars. */
  STAGE: 'Customers_Staging',
  RUN_MS: 250000,
  MANUAL_RUN_MS: 1500000,
  MANUAL: 'CM_MANUAL',
  /* 2,034 contacts at the smallest page size is 407 pages — a lower ceiling
     would silently truncate the pull, which is worse than failing */
  MAX_PAGES: 600,
};

const CM_COLS = ['contact_id', 'name', 'lane', 'party_key', 'company',
  'mobile', 'whatsapp', 'telephone', 'email',
  'gst_type', 'gstin', 'pan', 'city', 'state', 'contact_type',
  'branch_id', 'last_modified', 'pulled_at'];

function cmNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }

function cmDate_(v) {
  if (!v) return '';
  const m = String(v).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : '';
}

/** Vasy splits the name; the leading dot on firstName marks the non-GST ledger */
function cmName_(c) {
  const f = String(c.firstName || '').trim();
  const l = String(c.lastName || '').trim();
  const joined = (f + ' ' + l).trim().replace(/\s+/g, ' ');
  return joined || String(c.companyName || '').trim();
}

function cmKey_(name) {
  let s = String(name || '').trim();
  if (!s) return '';
  const wo = s.charAt(0) === '.';
  if (wo) s = s.slice(1);
  return (wo ? 'wo:' : 'w:') + s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cmProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function cmBook_() {
  try { return anaBook_(); } catch (e) { return txnBook_(); }
}

function pullCustomers() {
  const t0 = Date.now();
  const base = cmProp_(CM.BASE).replace(/\/+$/, '');
  const branch = cmProp_(CM.BRANCH);
  const token = cmProp_(CM.TOKEN);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm');

  const props = PropertiesService.getScriptProperties();

  const fetchPage = function (limit, offset) {
    const url = base + CM.PATH + '?branchId=' + encodeURIComponent(branch) +
      '&limit=' + limit + '&offset=' + offset;
    const r = UrlFetchApp.fetch(url, {
      method: 'get', headers: { 'api-token': token }, muteHttpExceptions: true,
    });
    return { code: r.getResponseCode(), text: r.getContentText() };
  };

  /* find the largest page size the endpoint will accept, once */
  let LIMIT = parseInt(props.getProperty(CM.LIMIT_PROP) || '0', 10);
  if (!LIMIT) {
    const tried = [];
    for (let i = 0; i < CM.LIMIT_STEPS.length; i++) {
      const cand = CM.LIMIT_STEPS[i];
      const t = fetchPage(cand, 0);
      tried.push(cand + '→' + t.code);
      if (t.code === 200) { LIMIT = cand; break; }
      Utilities.sleep(600);
    }
    if (!LIMIT) {
      throw new Error('No page size was accepted.\n\ntried: ' + tried.join(', ') +
        '\n\nThe endpoint answered the probe at limit=5, so if even that fails ' +
        'now the token or branch may have changed.');
    }
    props.setProperty(CM.LIMIT_PROP, String(LIMIT));
    Logger.log('page size negotiated: ' + LIMIT + '   (tried ' + tried.join(', ') + ')');
  }

  /* resume a run that was throttled part way */
  const manual = props.getProperty(CM.MANUAL) === '1';
  const budget = manual ? CM.MANUAL_RUN_MS : CM.RUN_MS;
  let rows = [];
  let offset = parseInt(props.getProperty(CM.CURSOR) || '0', 10);
  if (offset > 0) {
    rows = cmStageRead_();
    if (!rows.length) { offset = 0; }
    else Logger.log('resuming at offset ' + offset + ' with ' + rows.length + ' held');
  }
  let total = null, pages = 0, hit429 = false;

  while (pages < CM.MAX_PAGES) {
    if (Date.now() - t0 > budget) {
      props.setProperty(CM.CURSOR, String(offset));
      cmStageWrite_(rows);
      const m = 'Time budget reached at offset ' + offset + '. Run again to continue.';
      Logger.log(m);
      try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
      return rows.length;
    }
    let res = fetchPage(LIMIT, offset);
    for (let b = 0; res.code === 429 && b < CM.BACKOFF.length; b++) {
      Utilities.sleep(CM.BACKOFF[b]);
      res = fetchPage(LIMIT, offset);
    }
    if (res.code === 429) {
      hit429 = true;
      /* still throttled — save what we have and stop cleanly. The next run
         picks up from this offset rather than hammering the same pages. */
      props.setProperty(CM.CURSOR, String(offset));
      cmStageWrite_(rows);
      const m = 'Rate limited at offset ' + offset + ' with ' +
        rows.length.toLocaleString() + ' contacts held.\n\n' +
        'Nothing was overwritten. Run pullCustomers() again in a few minutes ' +
        'and it will carry on from here.';
      Logger.log(m);
      try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
      return rows.length;
    }
    if (res.code !== 200) {
      throw new Error('HTTP ' + res.code + ' at offset ' + offset +
        ' with limit ' + LIMIT + '\n\n' + res.text.slice(0, 300) +
        '\n\nRun resetCustomerLimit() and try again — the cap may have moved.');
    }
    let j;
    try { j = JSON.parse(res.text); }
    catch (e) { throw new Error('Non-JSON at offset ' + offset); }
    if (j.status === false) throw new Error(j.message || 'status false');

    const resp = j.response || {};
    if (total === null) total = cmNum_(resp.totalCount) || 0;
    const list = resp.contactList || [];
    if (!list.length) break;

    list.forEach(function (c) {
      const name = cmName_(c);
      if (!name) return;
      rows.push([
        cmNum_(c.contactId), name,
        name.charAt(0) === '.' ? 'WO' : 'W',
        cmKey_(name),
        String(c.companyName || ''),
        String(c.mobNo || ''), String(c.whatsAppNo || ''),
        String(c.telephone || ''), String(c.email || ''),
        String(c.gstType || ''), String(c.gstin || ''), String(c.pan || ''),
        String(c.cityName || ''), String(c.stateName || ''),
        String(c.contactType || ''),
        cmNum_(c.branchId),
        cmDate_(c.lastModifiedOn), stamp,
      ]);
    });

    pages++;
    offset += LIMIT;
    if (total && offset >= total) break;
    if (list.length < LIMIT) break;        // short page means the end
    Utilities.sleep(CM.GAP);
  }

  const complete = !hit429 && (!total || rows.length >= total * 0.98);
  if (complete) props.deleteProperty(CM.CURSOR);

  if (!complete && !rows.length) {
    throw new Error('Rate limited before anything was fetched. Nothing written. ' +
      'Try again in a minute.');
  }

  if (pages >= CM.MAX_PAGES && total && rows.length < total) {
    throw new Error('Stopped at ' + CM.MAX_PAGES + ' pages with only ' +
      rows.length + ' of ' + total + ' contacts.\n\nNothing was written — a ' +
      'partial customer list is worse than none, because the missing ones ' +
      'would look like customers with no history.');
  }

  const ss = cmBook_();
  let sh = ss.getSheetByName(CM.SHEET);
  if (!sh) sh = ss.insertSheet(CM.SHEET);
  sh.clear();
  if (sh.getMaxColumns() < CM_COLS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), CM_COLS.length - sh.getMaxColumns());
  }
  if (sh.getMaxRows() < rows.length + 10) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length + 10 - sh.getMaxRows());
  }
  sh.getRange(1, 1, 1, CM_COLS.length).setValues([CM_COLS]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, CM_COLS.length).setFontWeight('bold')
    .setBackground('#CC3018').setFontColor('#FFFFFF');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, CM_COLS.length).setValues(rows);
  }

  /* a complete pass — clear the resume state */
  props.deleteProperty(CM.CURSOR);
  cmStageClear_();
  try { regSet_(REG.MAP, {}); } catch (e) {}
  try { vtInvalidate(); } catch (e) {}

  let wa = 0, mob = 0, wo = 0, gst = 0;
  rows.forEach(function (r) {
    if (r[6]) wa++;
    if (r[5]) mob++;
    if (r[2] === 'WO') wo++;
    if (r[10]) gst++;
  });

  const msg = (complete ? 'CUSTOMERS PULLED' : 'CUSTOMERS — PAUSED, resumable') +
    '  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    (complete ? '' : 'Rate limited at offset ' + offset + '. What was fetched is ' +
      'saved; run pullCustomers() again to carry on.\n\n') +
    'contacts: ' + rows.length.toLocaleString() +
      (total ? ' of ' + total.toLocaleString() + ' reported' : '') + '\n' +
    'pages: ' + pages + ' at ' + LIMIT + ' per page\n\n' +
    '   with a mobile   : ' + mob.toLocaleString() + '\n' +
    '   with WhatsApp   : ' + wa.toLocaleString() + '\n' +
    '   with a GSTIN    : ' + gst.toLocaleString() + '\n' +
    '   non-GST ledgers : ' + wo.toLocaleString() + '   (name starts with a dot)\n\n' +
    (wa < rows.length * 0.2
      ? 'Few WhatsApp numbers are filled in. A send button will only reach\n' +
        'the customers who have one — worth filling those in Vasy first.'
      : 'Enough WhatsApp coverage for a send button to be useful.');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return rows.length;
}

/** forget the negotiated page size, so the next pull works it out again */
function pullCustomersManual() {
  PropertiesService.getScriptProperties().setProperty(CM.MANUAL, '1');
  try { return pullCustomers(); }
  finally { PropertiesService.getScriptProperties().deleteProperty(CM.MANUAL); }
}

function resetCustomerPull() {
  const p = PropertiesService.getScriptProperties();
  p.deleteProperty(CM.CURSOR);
  cmStageClear_();
  try { SpreadsheetApp.getUi().alert('Resume point cleared — the next pull ' +
    'starts from the beginning.'); } catch (e) {}
}

function resetCustomerLimit() {
  PropertiesService.getScriptProperties().deleteProperty(CM.LIMIT_PROP);
  try { SpreadsheetApp.getUi().alert('Page size forgotten. The next pull will ' +
    'find the largest one the endpoint accepts.'); } catch (e) {}
}

/* ---------- staging, for a resumable pull ---------- */

function cmStageSheet_(create) {
  const ss = cmBook_();
  let sh = ss.getSheetByName(CM.STAGE);
  if (!sh && create) {
    sh = ss.insertSheet(CM.STAGE);
    if (sh.getMaxColumns() < CM_COLS.length) {
      sh.insertColumnsAfter(sh.getMaxColumns(), CM_COLS.length - sh.getMaxColumns());
    }
    sh.getRange(1, 1, 1, CM_COLS.length).setValues([CM_COLS]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function cmStageWrite_(rows) {
  const sh = cmStageSheet_(true);
  sh.clear();
  sh.getRange(1, 1, 1, CM_COLS.length).setValues([CM_COLS]);
  if (!rows.length) return;
  if (sh.getMaxRows() < rows.length + 10) {
    sh.insertRowsAfter(sh.getMaxRows(), rows.length + 10 - sh.getMaxRows());
  }
  sh.getRange(2, 1, rows.length, CM_COLS.length).setValues(rows);
}
function cmStageRead_() {
  const sh = cmStageSheet_(false);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, CM_COLS.length).getValues();
}
function cmStageClear_() {
  const sh = cmStageSheet_(false);
  if (sh) { try { cmBook_().deleteSheet(sh); } catch (e) { sh.clear(); } }
}

function cmSheet_() {
  let sh = null;
  try { sh = vtSheet(CM.SHEET); } catch (e) {}
  if (!sh) { try { sh = cmBook_().getSheetByName(CM.SHEET); } catch (e) {} }
  return sh;
}

/** contact details by party key — what a WhatsApp button will call */
function cmByKey() {
  const sh = cmSheet_();
  if (!sh || sh.getLastRow() < 2) return {};
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, CM_COLS.length).getValues();
  const out = {};
  v.forEach(function (r) {
    const k = String(r[3] || '');
    if (!k) return;
    out[k] = { id: r[0], name: String(r[1] || ''),
      mobile: String(r[5] || ''), whatsapp: String(r[6] || ''),
      phone: String(r[7] || ''), gstin: String(r[10] || ''),
      city: String(r[12] || '') };
  });
  return out;
}

function cmFind(q) {
  const term = String(q || '').toLowerCase().trim();
  if (!term) throw new Error("cmFind('aadhi')");
  const sh = cmSheet_();
  if (!sh || sh.getLastRow() < 2) throw new Error('Run pullCustomers() first.');
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, CM_COLS.length).getValues();
  const hits = v.filter(function (r) {
    return String(r[1]).toLowerCase().indexOf(term) >= 0;
  }).slice(0, 20);
  Logger.log('MATCHES FOR "' + q + '"  (' + hits.length + ')');
  hits.forEach(function (r) {
    Logger.log('   [' + r[2] + '] ' + r[1] + '   id ' + r[0] +
      (r[5] ? '   mob ' + r[5] : '') + (r[6] ? '   wa ' + r[6] : '') +
      (r[10] ? '   gst ' + r[10] : ''));
  });
}

function customerStatus() {
  const sh = cmSheet_();
  const n = sh ? Math.max(0, sh.getLastRow() - 1) : 0;
  const msg = 'CUSTOMER MASTER\n\ncontacts: ' + n.toLocaleString() +
    (n ? '' : '\n\nEmpty — run pullCustomers().');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

function onOpenCustomers() {
  SpreadsheetApp.getUi()
    .createMenu('📇 Customers')
    .addItem('Pull from Vasy', 'pullCustomers')
    .addItem('Status', 'customerStatus')
    .addItem('Pull (long run)', 'pullCustomersManual')
    .addItem('Reset resume point', 'resetCustomerPull')
    .addItem('Reset page size', 'resetCustomerLimit')
    .addToUi();
}