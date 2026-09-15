/**********************************************************************
 * VITHYA TRADERS — CUSTOMER PAGING PROBE                 [VT-DW-032]
 *
 * READ ONLY. Writes nothing. No sheet, no Supabase, no properties.
 * Everything goes to the execution log.
 *
 * Globals declared here (check before pasting):
 *   CMP_TARGETS, probeCustomerPaging, cmpFetch_
 *
 * ── WHY ──
 *   The list endpoint reports 2,158 customers but offset paging at 50/page
 *   only ever returns ~1,714 distinct ones. The same records reappear at
 *   offsets 0, 50, 100, 200, 400 — doubling — which is the signature of an
 *   unsorted query being re-planned on every call. The tail is unreachable.
 *
 *   Fewer pages means less room to drift. This probe finds the largest page
 *   size the endpoint accepts, then does a full pass at that size and counts
 *   how many DISTINCT customers come back, and how many of the 47 we actually
 *   need are among them.
 *
 * ── RUN ──
 *   probeCustomerPaging()      ~2-4 minutes
 **********************************************************************/

/* the 47 customers with sales history that no pull has ever returned */
const CMP_TARGETS = [
  5592741, 5592975, 5592976, 5593007, 5593009, 5593017, 5593022, 5593072,
  5593105, 5593111, 5593116, 5593125, 5593136, 5593144, 5600401, 5616779,
  7182863, 8647763, 8694097, 9292996, 9293353, 9767479, 10215322, 10354445,
  11001616, 11309193, 11485099, 11532997, 11760934, 13050309, 13196492,
  13350865, 13444916, 13770649, 13914682, 14404723, 14938646, 15467075,
  15646031, 16012925, 16653849, 17294691, 17391612, 17447278, 17863181,
  18016698, 18027470
];

function cmpFetch_(base, token, branch, limit, offset) {
  const url = base + '/api/v1/customers?branchId=' + encodeURIComponent(branch) +
              '&limit=' + limit + '&offset=' + offset;
  const r = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'api-token': token },
    muteHttpExceptions: true
  });
  return { code: r.getResponseCode(), text: r.getContentText() };
}

function probeCustomerPaging() {
  const base   = cmProp_(CM.BASE).replace(/\/+$/, '');
  const token  = cmProp_(CM.TOKEN);
  const branch = cmProp_(CM.BRANCH);

  Logger.log('════════ STEP 1 — how big a page will it accept? ════════');

  const candidates = [2500, 1000, 500, 250, 200, 150, 100, 50];
  let best = 0, reported = 0;

  for (let i = 0; i < candidates.length; i++) {
    const lim = candidates[i];
    const r = cmpFetch_(base, token, branch, lim, 0);
    let got = '-', total = '-';
    if (r.code === 200) {
      try {
        const j = JSON.parse(r.text);
        const resp = j.response || {};
        got   = (resp.contactList || []).length;
        total = resp.totalCount;
        if (!reported) reported = Number(total) || 0;
        if (!best && got > 0) best = lim;
      } catch (e) { got = 'unparseable'; }
    }
    Logger.log('   limit ' + lim + '  ->  HTTP ' + r.code +
               '   returned ' + got + '   totalCount ' + total +
               (r.code !== 200 ? '   ' + r.text.slice(0, 120) : ''));
    Utilities.sleep(1200);
  }

  if (!best) {
    Logger.log('\nNo page size returned rows. Token or branch may have changed.');
    return;
  }

  Logger.log('\n   largest working page size: ' + best);
  Logger.log('   endpoint reports ' + reported + ' customers in total');

  Logger.log('\n════════ STEP 2 — full pass at ' + best + ' per page ════════');

  const seen  = {};
  let unique = 0, fetched = 0, pages = 0, offset = 0;
  const t0 = Date.now();

  while (pages < 200 && Date.now() - t0 < 240000) {
    const r = cmpFetch_(base, token, branch, best, offset);

    if (r.code === 429) {
      Logger.log('   rate limited at offset ' + offset + ' — waiting 65s');
      Utilities.sleep(65000);
      continue;
    }
    if (r.code !== 200) {
      Logger.log('   HTTP ' + r.code + ' at offset ' + offset + ' — stopping');
      break;
    }

    let list;
    try { list = (JSON.parse(r.text).response || {}).contactList || []; }
    catch (e) { Logger.log('   non-JSON at offset ' + offset); break; }

    if (!list.length) { Logger.log('   empty page at offset ' + offset); break; }

    let fresh = 0;
    list.forEach(function (c) {
      const id = Number(c.contactId);
      if (!id) return;
      fetched++;
      if (!seen[id]) { seen[id] = true; unique++; fresh++; }
    });

    pages++;
    Logger.log('   offset ' + offset + '  got ' + list.length +
               '   new ' + fresh + '   running unique ' + unique);

    offset += best;
    if (reported && offset >= reported) break;
    if (list.length < best) break;
    Utilities.sleep(900);
  }

  Logger.log('\n════════ STEP 3 — verdict ════════');
  Logger.log('   rows fetched     : ' + fetched);
  Logger.log('   DISTINCT customers: ' + unique);
  Logger.log('   endpoint reported : ' + reported);
  Logger.log('   still unreachable : ' + Math.max(0, reported - unique));

  let hits = 0;
  const misses = [];
  CMP_TARGETS.forEach(function (id) {
    if (seen[id]) hits++; else misses.push(id);
  });

  Logger.log('\n   OF THE 47 CUSTOMERS WE NEED:');
  Logger.log('   found   : ' + hits);
  Logger.log('   missing : ' + misses.length);
  if (misses.length && misses.length <= 47) {
    Logger.log('   still missing ids: ' + misses.join(','));
  }

  Logger.log('\n   ' + (unique >= reported * 0.99
    ? 'COMPLETE at page size ' + best + '. Set CM.LIMIT_STEPS to start at ' +
      best + ' and re-run the real pull.'
    : 'STILL INCOMPLETE at page size ' + best + '. The endpoint cannot be ' +
      'paged reliably — we fall back to per-customer lookup.'));
}