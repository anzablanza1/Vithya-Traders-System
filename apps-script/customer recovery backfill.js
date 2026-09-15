/**********************************************************************
 * VITHYA TRADERS — CUSTOMER RECOVERY BACKFILL            [VT-DW-033]
 *
 * Globals declared here (check before pasting):
 *   CMRB, recoverMissingCustomers, showRecoveryQueue,
 *   cmrbQueue_, cmrbLookup_, cmrbUpsert_, cmrbPick_
 *
 * ── WHY THIS EXISTS ──
 *   Vasy's /api/v1/customers list endpoint cannot return its first 600
 *   records (VT-DW-032). 47 customers with real sales history sit inside
 *   that blind spot. But /api/v1/customer/0?contact_no={phone} returns any
 *   one of them on demand — the id in the path is ignored, the phone number
 *   is what does the work.
 *
 * ── HOW IT WORKS ──
 *   1. Ask Supabase which customers are still missing, and what phone
 *      number to use. That list is the view v_customer_recovery_queue —
 *      it recomputes itself, so this shrinks to nothing as it succeeds.
 *   2. Look each one up by phone.
 *   3. Upsert into customer_master.
 *
 *   Safe to run repeatedly. Already-recovered customers drop out of the
 *   queue on their own. Nothing is ever deleted or overwritten with blanks.
 *
 * ── RUN ──
 *   showRecoveryQueue()        see what is outstanding, changes nothing
 *   recoverMissingCustomers()  do the work
 **********************************************************************/

const CMRB = {
  VIEW:  'v_customer_recovery_queue',
  TABLE: 'customer_master',
  GAP:   1200,      // the endpoint 429s easily
  MAX:   120        // sanity ceiling on lookups per run
};

/* ---------- read the queue out of Supabase ---------- */

function cmrbQueue_() {
  const base = cmsbProp_(CMSB.URL_PROP).replace(/\/+$/, '');
  const key  = cmsbProp_(CMSB.KEY_PROP);
  const res  = UrlFetchApp.fetch(
    base + '/rest/v1/' + CMRB.VIEW +
    '?select=contact_id,lookup_phone,phone_source,sales_rows,sales_value' +
    '&limit=500',
    { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
      muteHttpExceptions: true });

  if (res.getResponseCode() !== 200) {
    throw new Error('Could not read the queue: HTTP ' + res.getResponseCode() +
                    '  ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

/* ---------- one lookup by phone ---------- */

function cmrbLookup_(base, token, branch, phone) {
  const url = base + '/api/v1/customer/0?branchId=' + encodeURIComponent(branch) +
              '&contact_no=' + encodeURIComponent(phone);
  let r = UrlFetchApp.fetch(url, {
    method: 'get', headers: { 'api-token': token }, muteHttpExceptions: true });

  if (r.getResponseCode() === 429) {
    Utilities.sleep(65000);
    r = UrlFetchApp.fetch(url, {
      method: 'get', headers: { 'api-token': token }, muteHttpExceptions: true });
  }
  if (r.getResponseCode() !== 200) {
    return { ok: false, why: 'HTTP ' + r.getResponseCode() };
  }
  let j;
  try { j = JSON.parse(r.getContentText()); }
  catch (e) { return { ok: false, why: 'non-JSON' }; }
  if (j.status === false || !j.response) {
    return { ok: false, why: j.message || 'empty response' };
  }
  return { ok: true, c: j.response };
}

/** the detail endpoint spells some fields differently from the list endpoint */
function cmrbPick_(c, names) {
  for (let i = 0; i < names.length; i++) {
    const v = c[names[i]];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return null;
}

/* ---------- upsert a batch ---------- */

function cmrbUpsert_(rows) {
  const base = cmsbProp_(CMSB.URL_PROP).replace(/\/+$/, '');
  const key  = cmsbProp_(CMSB.KEY_PROP);
  const res  = UrlFetchApp.fetch(
    base + '/rest/v1/' + CMRB.TABLE + '?on_conflict=contact_id',
    { method: 'post', contentType: 'application/json',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
                 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      payload: JSON.stringify(rows), muteHttpExceptions: true });
  return { code: res.getResponseCode(), text: res.getContentText() };
}

/* ---------- read-only: what is outstanding ---------- */

function showRecoveryQueue() {
  const q = cmrbQueue_();
  let feed = 0, addr = 0, none = 0, rows = 0, value = 0;
  q.forEach(function (r) {
    if (r.phone_source === 'FEED') feed++;
    else if (r.phone_source === 'ADDRESS') addr++;
    else none++;
    rows  += Number(r.sales_rows)  || 0;
    value += Number(r.sales_value) || 0;
  });

  const msg = 'CUSTOMER RECOVERY QUEUE\n\n' +
    'still missing : ' + q.length + '\n' +
    '   phone from feed    : ' + feed + '\n' +
    '   phone from address : ' + addr + '\n' +
    '   no phone at all    : ' + none + '   (manual)\n\n' +
    'sales rows    : ' + rows.toLocaleString() + '\n' +
    'sales value   : Rs ' + Math.round(value).toLocaleString('en-IN');

  Logger.log(msg);
  q.slice(0, 60).forEach(function (r) {
    Logger.log('   ' + r.contact_id + '   ' + (r.lookup_phone || '(no phone)') +
               '   ' + r.phone_source + '   ' + r.sales_rows + ' rows');
  });
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ---------- the backfill ---------- */

function recoverMissingCustomers() {
  const t0     = Date.now();
  const base   = cmProp_(CM.BASE).replace(/\/+$/, '');
  const token  = cmProp_(CM.TOKEN);
  const branch = cmProp_(CM.BRANCH);

  const queue = cmrbQueue_();
  const work  = queue.filter(function (r) { return r.lookup_phone; })
                     .slice(0, CMRB.MAX);
  const noPhone = queue.length - queue.filter(function (r) {
                     return r.lookup_phone; }).length;

  if (!work.length) {
    const m = 'Nothing to recover — every customer with a phone number is ' +
              'already in the master.' +
              (noPhone ? '\n\n' + noPhone + ' remain with no phone number ' +
                         'anywhere; those need manual entry.' : '');
    Logger.log(m);
    try { SpreadsheetApp.getUi().alert(m); } catch (e) {}
    return 0;
  }

  const rows = [];
  const failed = [];
  const mismatched = [];
  const stamp = new Date().toISOString();

  Logger.log('Looking up ' + work.length + ' customers by phone...');

  for (let i = 0; i < work.length; i++) {
    const q = work[i];
    const r = cmrbLookup_(base, token, branch, q.lookup_phone);

    if (!r.ok) {
      failed.push(q.contact_id + ' (' + q.lookup_phone + ') ' + r.why);
      Utilities.sleep(CMRB.GAP);
      continue;
    }

    const c  = r.c;
    const id = Number(c.contactId);

    /* the phone is the key, not the id — so verify we got who we expected.
       A mismatch means two customers share a number; record the truth and
       flag it rather than silently attaching the wrong name to sales. */
    if (id !== Number(q.contact_id)) {
      mismatched.push('wanted ' + q.contact_id + ' but phone ' +
                      q.lookup_phone + ' returned ' + id);
      Utilities.sleep(CMRB.GAP);
      continue;
    }

    const first = cmrbPick_(c, ['firstName']) || '';
    const last  = cmrbPick_(c, ['lastName'])  || '';
    const disp  = (first + ' ' + last).trim() ||
                  cmrbPick_(c, ['companyName']) || '';

    rows.push({
      contact_id:       id,
      first_name:       first || null,
      last_name:        last  || null,
      company_name:     cmrbPick_(c, ['companyName']),
      display_name:     disp || null,
      lane:             disp.charAt(0) === '.' ? 'WO' : 'W',
      party_key:        disp ? (disp.charAt(0) === '.' ? 'wo:' : 'w:') +
                          disp.replace(/^\./, '').toUpperCase()
                               .replace(/[^A-Z0-9]/g, '') : null,
      mobile_no:        cmrbPick_(c, ['mobNo', 'mobileNo']),
      whatsapp_no:      cmrbPick_(c, ['whatsappNo', 'whatsAppNo']),
      telephone:        cmrbPick_(c, ['telephone']),
      email:            cmrbPick_(c, ['email']),
      gst_type:         cmrbPick_(c, ['gstType']),
      gstin:            cmrbPick_(c, ['gstin']),
      pan:              cmrbPick_(c, ['pan']),
      city_name:        cmrbPick_(c, ['cityName']),
      state_name:       cmrbPick_(c, ['stateName']),
      country_name:     cmrbPick_(c, ['countryName']),
      contact_type:     cmrbPick_(c, ['contactType']),
      branch_id:        Number(c.branchId) || null,
      branch_name:      cmrbPick_(c, ['branchName']),
      last_modified_by: cmrbPick_(c, ['lastModifiedBy']),
      source:           'API-RECOVERY',
      loaded_at:        stamp
    });

    if ((i + 1) % 10 === 0) Logger.log('   ' + (i + 1) + ' / ' + work.length);
    Utilities.sleep(CMRB.GAP);
  }

  let pushed = 0, pushErr = '';
  if (rows.length) {
    const up = cmrbUpsert_(rows);
    if (up.code >= 200 && up.code < 300) pushed = rows.length;
    else pushErr = 'HTTP ' + up.code + '  ' + up.text.slice(0, 250);
  }

  const msg = 'CUSTOMER RECOVERY  (' +
    Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'looked up    : ' + work.length + '\n' +
    'recovered    : ' + rows.length + '\n' +
    'written      : ' + pushed + '\n' +
    (failed.length     ? 'not found    : ' + failed.length + '\n' : '') +
    (mismatched.length ? 'id mismatch  : ' + mismatched.length + '\n' : '') +
    (noPhone           ? 'no phone     : ' + noPhone + '   (manual)\n' : '') +
    (pushErr ? '\nWRITE FAILED: ' + pushErr : '');

  Logger.log(msg);
  if (failed.length) {
    Logger.log('\nNOT FOUND:');
    failed.forEach(function (f) { Logger.log('   ' + f); });
  }
  if (mismatched.length) {
    Logger.log('\nID MISMATCH — two customers may share a phone number:');
    mismatched.forEach(function (m) { Logger.log('   ' + m); });
  }
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}

  if (pushErr) throw new Error(pushErr);
  return pushed;
}
