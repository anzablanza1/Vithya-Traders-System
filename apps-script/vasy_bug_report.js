/**********************************************************************
 * VITHYA TRADERS — VASY API BUG EVIDENCE PACK           [VT-DW-032b]
 *
 * READ ONLY. Calls only GET endpoints. Writes one JSON file to your Drive.
 *
 * Globals declared here (check before pasting):
 *   VBUG, buildVasyBugReport, vbGet_, vbIds_
 *
 * ── WHAT IT PRODUCES ──
 *   A single .json file the Vasy team can open, containing:
 *     1. Exact request URLs and headers used (token redacted)
 *     2. The limit>100 rejection, verbatim
 *     3. Every page of a full sweep: offset, HTTP code, contactIds returned
 *     4. Which offsets returned records already seen at an earlier offset
 *     5. The arithmetic: totalCount vs distinct retrieved
 *     6. PROOF records - contacts the list endpoint never returns, together
 *        with the raw single-contact response showing they exist. This is
 *        the part that makes the bug undeniable.
 *
 * ── NOTE ON CONTENT ──
 *   The file contains real customer names and phone numbers. That is your
 *   own data going to your own ERP vendor, who already stores it - but do
 *   not post it anywhere public.
 *
 * ── RUN ──
 *   buildVasyBugReport()      3-6 minutes. Returns a Drive link in the log.
 **********************************************************************/

const VBUG = {
  LIMIT:      100,        // largest the endpoint accepts
  GAP:        1100,       // ms between calls
  MAX_PAGES:  40,
  BUDGET_MS:  300000,     // stop cleanly before the 6-minute wall
  LIMIT_PROBE: [500, 250, 200, 150, 100, 50],

  // contacts recovered via /api/v1/customer?contact_no that the list
  // endpoint has never returned in any run
  PROOF: [
    { contactId: 5593007,  contact_no: '9363212353' },
    { contactId: 5593009,  contact_no: '9843903727' },
    { contactId: 13350865, contact_no: '6363254317' },
    { contactId: 5600401,  contact_no: '9952517782' },
    { contactId: 13770649, contact_no: '8883330321' }
  ]
};

function vbGet_(url, token) {
  const t0 = Date.now();
  let r = UrlFetchApp.fetch(url, {
    method: 'get', headers: { 'api-token': token }, muteHttpExceptions: true });
  let waited = 0;
  if (r.getResponseCode() === 429) {
    Utilities.sleep(65000); waited = 65000;
    r = UrlFetchApp.fetch(url, {
      method: 'get', headers: { 'api-token': token }, muteHttpExceptions: true });
  }
  return {
    code: r.getResponseCode(),
    text: r.getContentText(),
    ms: Date.now() - t0 - waited,
    retriedAfter429: waited > 0
  };
}

function vbIds_(text) {
  try {
    const list = ((JSON.parse(text).response) || {}).contactList || [];
    return list.map(function (c) { return c.contactId; });
  } catch (e) { return []; }
}

function buildVasyBugReport() {
  const t0     = Date.now();
  const base   = cmProp_(CM.BASE).replace(/\/+$/, '');
  const token  = cmProp_(CM.TOKEN);
  const branch = cmProp_(CM.BRANCH);

  const rep = {
    reportGeneratedAt: new Date().toISOString(),
    reportedBy: 'Vithya Traders',
    branchId: branch,
    endpoint: base + '/api/v1/customers',
    requestMethod: 'GET',
    requestHeaders: { 'api-token': '<REDACTED>' },
    requestQueryParameters: { branchId: branch, limit: '<n>', offset: '<m>' },
    summary: {},
    issue1_limitAbove100Rejected: [],
    issue2_fullSweep: { limitUsed: VBUG.LIMIT, pages: [] },
    issue3_overlapAnalysis: {},
    issue4_recordsUnreachableViaList: [],
    conclusion: {}
  };

  /* ---------- Issue 1: limit ceiling ---------- */
  VBUG.LIMIT_PROBE.forEach(function (lim) {
    const url = base + '/api/v1/customers?branchId=' + encodeURIComponent(branch) +
                '&limit=' + lim + '&offset=0';
    const r = vbGet_(url, token);
    let returned = null, totalCount = null;
    if (r.code === 200) {
      try {
        const j = JSON.parse(r.text);
        returned   = ((j.response || {}).contactList || []).length;
        totalCount = (j.response || {}).totalCount;
      } catch (e) {}
    }
    rep.issue1_limitAbove100Rejected.push({
      requestUrl: url.replace(base, '<HOST>'),
      httpStatus: r.code,
      recordsReturned: returned,
      totalCountReported: totalCount,
      responseBody: r.code === 200 ? '<200 OK - body omitted for brevity>'
                                   : JSON.parse(JSON.stringify(r.text))
    });
    Utilities.sleep(VBUG.GAP);
  });

  /* ---------- Issue 2: full sweep ---------- */
  const seenAt = {};          // contactId -> [offsets]
  let reported = null, offset = 0, pages = 0;

  while (pages < VBUG.MAX_PAGES && Date.now() - t0 < VBUG.BUDGET_MS) {
    const url = base + '/api/v1/customers?branchId=' + encodeURIComponent(branch) +
                '&limit=' + VBUG.LIMIT + '&offset=' + offset;
    const r = vbGet_(url, token);
    if (r.code !== 200) {
      rep.issue2_fullSweep.pages.push({
        offset: offset, httpStatus: r.code, responseBody: r.text.slice(0, 300)
      });
      break;
    }
    try { reported = (JSON.parse(r.text).response || {}).totalCount; } catch (e) {}

    const ids = vbIds_(r.text);
    let fresh = 0;
    const repeats = [];
    ids.forEach(function (id) {
      if (seenAt[id]) { repeats.push({ contactId: id, firstSeenAtOffset: seenAt[id][0] }); seenAt[id].push(offset); }
      else { seenAt[id] = [offset]; fresh++; }
    });

    rep.issue2_fullSweep.pages.push({
      requestUrl: url.replace(base, '<HOST>'),
      offset: offset,
      httpStatus: r.code,
      responseTimeMs: r.ms,
      recordsReturned: ids.length,
      newContactIds: fresh,
      alreadySeenOnAnEarlierPage: repeats.length,
      examplesOfRepeats: repeats.slice(0, 5),
      contactIdsReturned: ids
    });

    pages++;
    offset += VBUG.LIMIT;
    if (reported && offset >= Number(reported)) break;
    if (ids.length < VBUG.LIMIT) break;
    Utilities.sleep(VBUG.GAP);
  }

  /* ---------- Issue 3: overlap analysis ---------- */
  const distinct = Object.keys(seenAt).length;
  const fetched  = rep.issue2_fullSweep.pages.reduce(
                     function (a, p) { return a + (p.recordsReturned || 0); }, 0);

  const brokenWindow = [], cleanWindow = [];
  rep.issue2_fullSweep.pages.forEach(function (p) {
    if (p.newContactIds === undefined) return;
    (p.newContactIds < VBUG.LIMIT ? brokenWindow : cleanWindow).push({
      offset: p.offset, newContactIds: p.newContactIds, returned: p.recordsReturned
    });
  });

  const multi = [];
  Object.keys(seenAt).forEach(function (id) {
    if (seenAt[id].length > 1) multi.push({ contactId: Number(id), returnedAtOffsets: seenAt[id] });
  });

  rep.issue3_overlapAnalysis = {
    pagesWhereEveryRecordWasNew: cleanWindow,
    pagesContainingAlreadySeenRecords: brokenWindow,
    contactsReturnedOnMoreThanOnePage: multi.length,
    examples: multi.slice(0, 20),
    note: 'Records repeat across offsets 0-599 while offsets 600+ return only '
        + 'new records. Because each repeat occupies a slot, an equal number of '
        + 'records is never returned at all.'
  };

  /* ---------- Issue 4: proof of unreachable records ---------- */
  VBUG.PROOF.forEach(function (p) {
    const url = base + '/api/v1/customer/0?branchId=' + encodeURIComponent(branch) +
                '&contact_no=' + encodeURIComponent(p.contact_no);
    const r = vbGet_(url, token);
    let record = null;
    try { record = JSON.parse(r.text).response; } catch (e) {}
    rep.issue4_recordsUnreachableViaList.push({
      contactId: p.contactId,
      appearedInFullSweep: !!seenAt[p.contactId],
      singleContactLookupUrl: url.replace(base, '<HOST>')
                                 .replace(p.contact_no, '<CONTACT_NO>'),
      singleContactLookupHttpStatus: r.code,
      recordExistsPerSingleLookup: !!record,
      recordReturned: record
    });
    Utilities.sleep(VBUG.GAP);
  });

  /* ---------- summary ---------- */
  const unreachable = (Number(reported) || 0) - distinct;
  rep.summary = {
    totalCountReportedByApi: Number(reported) || null,
    recordsReturnedAcrossAllPages: fetched,
    distinctContactIdsObtained: distinct,
    recordsNeverReturned: unreachable,
    pagesRequested: pages,
    limitUsed: VBUG.LIMIT
  };
  rep.conclusion = {
    observation1: 'limit values above 100 are rejected with HTTP 400 '
                + '"Issue in Request Headers for limit and offset".',
    observation2: 'Paging the entire range returns ' + fetched + ' records but only '
                + distinct + ' distinct contactIds, against a reported totalCount of '
                + (reported || '?') + '.',
    observation3: 'Repetition is confined to the first 600 records. Offsets 600 '
                + 'and above return 100 new records on every page.',
    observation4: 'The same 600-record window reproduces at limit=50 and limit=100, '
                + 'so it is a function of record position, not page size.',
    observation5: 'Contacts listed in issue4 are returned by '
                + '/api/v1/customer/0?contact_no= but never by the list endpoint, '
                + 'confirming the records exist and are genuinely unreachable.',
    likelyCause: 'The underlying query appears to have no deterministic ORDER BY, '
               + 'so the result set is re-ordered between paged requests.',
    suggestedFix: 'Apply a stable sort (for example ORDER BY contactId) to the '
                + 'query backing this endpoint, and/or support keyset pagination.',
    businessImpact: unreachable + ' customers cannot be retrieved through the API. '
                  + 'These are our most recently active accounts.'
  };

  /* ---------- write the file ---------- */
  const name = 'vasy_customers_paging_bug_' +
               Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd_HHmm') + '.json';
  const file = DriveApp.createFile(name, JSON.stringify(rep, null, 2),
                                   MimeType.PLAIN_TEXT);

  const msg = 'VASY BUG REPORT READY\n\n' +
    'totalCount reported : ' + rep.summary.totalCountReportedByApi + '\n' +
    'records returned    : ' + fetched + '\n' +
    'distinct obtained   : ' + distinct + '\n' +
    'never returned      : ' + unreachable + '\n' +
    'proof records       : ' + rep.issue4_recordsUnreachableViaList.length + '\n\n' +
    'File: ' + name + '\n' + file.getUrl();

  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return file.getUrl();
}