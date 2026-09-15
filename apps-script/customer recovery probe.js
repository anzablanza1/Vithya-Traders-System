/**********************************************************************
 * VITHYA TRADERS — CUSTOMER RECOVERY PROBE               [VT-DW-033]
 *
 * READ ONLY. Writes nothing anywhere. Log output only.
 *
 * Globals declared here (check before pasting):
 *   CMR, probeCustomerRecovery, cmrGet_, cmrIds_, cmrReport_
 *
 * ── WHAT WE KNOW ──
 *   offset 0-599   : broken, 600 records collapse to ~188 distinct
 *   offset 600+    : clean, every page returns 100 new
 *   limit > 100    : HTTP 400
 *   47 customers with real sales history live inside the broken window.
 *
 * ── WHAT THIS TRIES, cheapest door first ──
 *   A. a different pagination parameter  (page / pageNo / start / skip)
 *   B. a sort parameter — reversing the order turns the broken head into
 *      the working tail, which would fix everything with one extra param
 *   C. a search / filter on the list endpoint
 *   D. the single-customer lookup the first probe hinted at
 *      ("contact_no field is required")
 *
 * ── TEST SUBJECT ──
 *   contactId 5593007, mobile 9363212353 — your largest unresolved
 *   customer at 552 sales rows. If a door returns this record, it works.
 *
 * ── RUN ──
 *   probeCustomerRecovery()      ~3 minutes
 **********************************************************************/

const CMR = {
  TARGET_ID:  '5593007',
  TARGET_MOB: '9363212353',
  GAP:        1500,     // the endpoint 429s easily — be polite
  BASELINE_FIRST: null  // filled in at run time
};

/** one GET, with a single 429 wait-and-retry */
function cmrGet_(url, token) {
  let r = UrlFetchApp.fetch(url, {
    method: 'get', headers: { 'api-token': token }, muteHttpExceptions: true
  });
  if (r.getResponseCode() === 429) {
    Utilities.sleep(65000);
    r = UrlFetchApp.fetch(url, {
      method: 'get', headers: { 'api-token': token }, muteHttpExceptions: true
    });
  }
  return { code: r.getResponseCode(), text: r.getContentText() };
}

/** pull the contactList out of a response, whatever shape it arrives in */
function cmrIds_(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return null; }
  const resp = j.response;
  if (!resp) return [];
  let list = resp.contactList || resp.contact || resp.data || resp;
  if (list && !Array.isArray(list) && list.contactId) list = [list];
  if (!Array.isArray(list)) return [];
  return list.map(function (c) { return String(c.contactId || ''); })
             .filter(function (s) { return s; });
}

function cmrReport_(label, res) {
  if (res.code !== 200) {
    Logger.log('   ' + label + '\n        HTTP ' + res.code + '   ' +
               res.text.slice(0, 110).replace(/\s+/g, ' '));
    return { ok: false, hit: false, first: '' };
  }
  const ids = cmrIds_(res.text);
  if (ids === null) {
    Logger.log('   ' + label + '\n        HTTP 200 but unparseable');
    return { ok: false, hit: false, first: '' };
  }
  const hit = ids.indexOf(CMR.TARGET_ID) >= 0;
  const first = ids.length ? ids[0] : '';
  const moved = CMR.BASELINE_FIRST && first && first !== CMR.BASELINE_FIRST;
  Logger.log('   ' + label + '\n        HTTP 200   ' + ids.length + ' records' +
             '   first=' + (first || '-') +
             (moved ? '   ORDER CHANGED' : '') +
             (hit ? '   *** TARGET FOUND ***' : ''));
  return { ok: true, hit: hit, first: first, moved: moved, n: ids.length };
}

function probeCustomerRecovery() {
  const base   = cmProp_(CM.BASE).replace(/\/+$/, '');
  const token  = cmProp_(CM.TOKEN);
  const branch = cmProp_(CM.BRANCH);
  const L      = '/api/v1/customers?branchId=' + encodeURIComponent(branch);

  const wins = [];

  Logger.log('════════ BASELINE ════════');
  const b = cmrGet_(base + L + '&limit=100&offset=0', token);
  const bIds = cmrIds_(b.text) || [];
  CMR.BASELINE_FIRST = bIds.length ? bIds[0] : '';
  Logger.log('   limit=100 offset=0  ->  ' + bIds.length +
             ' records, first=' + CMR.BASELINE_FIRST);
  Utilities.sleep(CMR.GAP);

  /* ---------- A. alternate pagination parameters ---------- */
  Logger.log('\n════════ A — ALTERNATE PAGINATION ════════');
  Logger.log('Looking for a param that reaches the broken head properly.');
  [ ['page=2',        '&limit=100&page=2'],
    ['pageNo=2',      '&limit=100&pageNo=2'],
    ['pageNumber=2',  '&limit=100&pageNumber=2'],
    ['start=100',     '&limit=100&start=100'],
    ['skip=100',      '&limit=100&skip=100'],
    ['from=100',      '&limit=100&from=100']
  ].forEach(function (t) {
    const r = cmrReport_(t[0], cmrGet_(base + L + t[1], token));
    if (r.moved) wins.push('pagination: ' + t[0]);
    Utilities.sleep(CMR.GAP);
  });

  /* ---------- B. sort parameters ---------- */
  Logger.log('\n════════ B — SORT ════════');
  Logger.log('If the order can be reversed, the broken head becomes the');
  Logger.log('working tail and the whole problem goes away.');
  [ ['sort=contactId desc',   '&limit=100&offset=0&sort=contactId&order=desc'],
    ['sortBy=contactId desc', '&limit=100&offset=0&sortBy=contactId&sortOrder=desc'],
    ['orderBy=contactId',     '&limit=100&offset=0&orderBy=contactId&direction=desc'],
    ['order_by=contact_id',   '&limit=100&offset=0&order_by=contact_id&order=desc'],
    ['sort=firstName asc',    '&limit=100&offset=0&sort=firstName&order=asc'],
    ['sort=-lastModifiedOn',  '&limit=100&offset=0&sort=-lastModifiedOn']
  ].forEach(function (t) {
    const r = cmrReport_(t[0], cmrGet_(base + L + t[1], token));
    if (r.moved) wins.push('sort: ' + t[0]);
    Utilities.sleep(CMR.GAP);
  });

  /* ---------- C. search / filter on the list endpoint ---------- */
  Logger.log('\n════════ C — SEARCH / FILTER ════════');
  Logger.log('Target: contactId ' + CMR.TARGET_ID + ', mobile ' + CMR.TARGET_MOB);
  [ ['search=mobile',      '&limit=50&offset=0&search='      + CMR.TARGET_MOB],
    ['keyword=mobile',     '&limit=50&offset=0&keyword='     + CMR.TARGET_MOB],
    ['q=mobile',           '&limit=50&offset=0&q='           + CMR.TARGET_MOB],
    ['contact_no=mobile',  '&limit=50&offset=0&contact_no='  + CMR.TARGET_MOB],
    ['mobNo=mobile',       '&limit=50&offset=0&mobNo='       + CMR.TARGET_MOB],
    ['mobile_no=mobile',   '&limit=50&offset=0&mobile_no='   + CMR.TARGET_MOB],
    ['contactId=target',   '&limit=50&offset=0&contactId='   + CMR.TARGET_ID],
    ['contact_id=target',  '&limit=50&offset=0&contact_id='  + CMR.TARGET_ID]
  ].forEach(function (t) {
    const r = cmrReport_(t[0], cmrGet_(base + L + t[1], token));
    if (r.hit) wins.push('search: ' + t[0]);
    Utilities.sleep(CMR.GAP);
  });

  /* ---------- D. single-customer lookup ---------- */
  Logger.log('\n════════ D — SINGLE CUSTOMER LOOKUP ════════');
  const S = '/api/v1/customer';
  [ ['/customer/{id}?branchId&contact_no',
     S + '/' + CMR.TARGET_ID + '?branchId=' + encodeURIComponent(branch) +
     '&contact_no=' + CMR.TARGET_MOB],
    ['/customer/{id}?contact_no',
     S + '/' + CMR.TARGET_ID + '?contact_no=' + CMR.TARGET_MOB],
    ['/customer?contact_no&branchId',
     S + '?contact_no=' + CMR.TARGET_MOB + '&branchId=' + encodeURIComponent(branch)],
    ['/customer/0?branchId&contact_no',
     S + '/0?branchId=' + encodeURIComponent(branch) + '&contact_no=' + CMR.TARGET_MOB],
    ['/customers/{id}?branchId',
     '/api/v1/customers/' + CMR.TARGET_ID + '?branchId=' + encodeURIComponent(branch)]
  ].forEach(function (t) {
    const res = cmrGet_(base + t[1], token);
    const found = res.code === 200 && res.text.indexOf(CMR.TARGET_ID) >= 0;
    Logger.log('   ' + t[0] + '\n        HTTP ' + res.code +
               (found ? '   *** TARGET FOUND ***' : '') +
               '\n        ' + res.text.slice(0, 220).replace(/\s+/g, ' '));
    if (found) wins.push('lookup: ' + t[0]);
    Utilities.sleep(CMR.GAP);
  });

  /* ---------- verdict ---------- */
  Logger.log('\n════════ VERDICT ════════');
  if (wins.length) {
    Logger.log('   Doors that opened:');
    wins.forEach(function (w) { Logger.log('      ' + w); });
    Logger.log('\n   Send me this log — one of these becomes the recovery path.');
  } else {
    Logger.log('   Every door is shut. The 47 customers cannot be reached');
    Logger.log('   through this API. Recovery falls to Vasy fixing the offset');
    Logger.log('   bug, a CSV export from the Vasy UI, or manual entry.');
  }
}
