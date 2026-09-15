/**********************************************************************
 * VITHYA TRADERS — CUSTOMER MASTER → SUPABASE          [VT-DW-002]
 *
 * Pushes the Customers sheet (written by pullCustomers) into the
 * Supabase table public.customer_master.
 *
 * Globals declared here (check before pasting):
 *   CMSB, pushCustomersToSupabase, customerSupabaseStatus,
 *   syncCustomersToSupabase, cmsbVal_, cmsbInt_, cmsbTs_, cmsbPost_
 *
 * ── WHAT IT TOUCHES ──
 *   Reads  : the 'Customers' sheet          (never writes to it)
 *   Writes : public.customer_master only    (never sales_data)
 *   Upsert on contact_id — safe to run any number of times.
 *
 * ── SETUP (once) ──
 *   Script Properties:
 *     SUPABASE_URL          https://kssydapdfmkfufrqhwzp.supabase.co
 *     SUPABASE_SERVICE_KEY  <service_role key from Supabase settings>
 *
 * ── RUN ──
 *   pushCustomersToSupabase()   push what is already in the sheet
 *   syncCustomersToSupabase()   pullCustomers() then push  ← use for triggers
 *   customerSupabaseStatus()    row count + coverage against sales_data
 **********************************************************************/

const CMSB = {
  URL_PROP:   'SUPABASE_URL',
  KEY_PROP:   'SUPABASE_SERVICE_KEY',
  TABLE:      'customer_master',
  CONFLICT:   'contact_id',
  CHUNK:      500,      // rows per POST — 2,158 contacts is 5 calls
  GAP:        300       // ms between chunks
};

/* ---------- helpers ---------- */

/** '' and null both become null; everything else a trimmed string */
function cmsbVal_(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function cmsbInt_(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10);
  return isFinite(n) ? n : null;
}

/**
 * Dates are the one thing that has bitten this project before.
 * The sheet may hold either the 'yyyy-MM-dd' string cmDate_() wrote, or a
 * Date object if Sheets silently coerced the cell. Normalise both to ISO
 * before they leave — Postgres never sees an ambiguous dd/mm vs mm/dd string.
 */
function cmsbTs_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'UTC', 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;   // anything not already ISO is dropped, not guessed
}

function cmsbProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

/** one upsert POST; returns the response so the caller can report failures */
function cmsbPost_(url, key, payload) {
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey':        key,
      'Authorization': 'Bearer ' + key,
      'Prefer':        'resolution=merge-duplicates,return=minimal'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return { code: res.getResponseCode(), text: res.getContentText() };
}

/* ---------- the push ---------- */

function pushCustomersToSupabase() {
  const t0 = Date.now();

  const sh = cmSheet_();
  if (!sh || sh.getLastRow() < 2) {
    throw new Error('The Customers sheet is empty. Run pullCustomers() first.');
  }

  const base = cmsbProp_(CMSB.URL_PROP).replace(/\/+$/, '');
  const key  = cmsbProp_(CMSB.KEY_PROP);
  const url  = base + '/rest/v1/' + CMSB.TABLE +
               '?on_conflict=' + CMSB.CONFLICT;

  const values = sh.getRange(2, 1, sh.getLastRow() - 1, CM_COLS.length).getValues();

  /* CM_COLS order:
     0 contact_id  1 name       2 lane      3 party_key  4 company
     5 mobile      6 whatsapp   7 telephone 8 email      9 gst_type
    10 gstin      11 pan       12 city     13 state     14 contact_type
    15 branch_id  16 last_modified        17 pulled_at                     */

  const rows = [];
  let skipped = 0;

  values.forEach(function (r) {
    const id = cmsbInt_(r[0]);
    if (id === null) { skipped++; return; }   // no id means no join key — useless
    rows.push({
      contact_id:       id,
      display_name:     cmsbVal_(r[1]),
      lane:             cmsbVal_(r[2]),
      party_key:        cmsbVal_(r[3]),
      company_name:     cmsbVal_(r[4]),
      mobile_no:        cmsbVal_(r[5]),
      whatsapp_no:      cmsbVal_(r[6]),
      telephone:        cmsbVal_(r[7]),
      email:            cmsbVal_(r[8]),
      gst_type:         cmsbVal_(r[9]),
      gstin:            cmsbVal_(r[10]),
      pan:              cmsbVal_(r[11]),
      city_name:        cmsbVal_(r[12]),
      state_name:       cmsbVal_(r[13]),
      contact_type:     cmsbVal_(r[14]),
      branch_id:        cmsbInt_(r[15]),
      last_modified_on: cmsbTs_(r[16]),
      source:           'API',
      loaded_at:        new Date().toISOString()
    });
  });

  if (!rows.length) throw new Error('Nothing to push — no rows had a contact_id.');

  /* de-duplicate within the payload: Postgres rejects an upsert batch that
     names the same conflict key twice. Last one in the sheet wins. */
  const seen = {};
  const clean = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (seen[rows[i].contact_id]) continue;
    seen[rows[i].contact_id] = true;
    clean.unshift(rows[i]);
  }
  const dupes = rows.length - clean.length;

  let sent = 0;
  const failures = [];

  for (let i = 0; i < clean.length; i += CMSB.CHUNK) {
    const batch = clean.slice(i, i + CMSB.CHUNK);
    const res = cmsbPost_(url, key, batch);

    if (res.code >= 200 && res.code < 300) {
      sent += batch.length;
    } else {
      failures.push('rows ' + (i + 1) + '-' + (i + batch.length) +
                    '  HTTP ' + res.code + '  ' + res.text.slice(0, 200));
      /* stop on the first failure — a half-written master is worse than none,
         and the upsert means a corrected re-run costs nothing */
      break;
    }
    if (i + CMSB.CHUNK < clean.length) Utilities.sleep(CMSB.GAP);
  }

  const msg =
    (failures.length ? 'CUSTOMER PUSH — FAILED' : 'CUSTOMER PUSH — OK') +
    '  (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'sheet rows   : ' + values.length.toLocaleString() + '\n' +
    'pushed       : ' + sent.toLocaleString() + '\n' +
    (skipped ? 'no contact_id: ' + skipped + '\n' : '') +
    (dupes   ? 'duplicate ids: ' + dupes + '  (last one kept)\n' : '') +
    (failures.length ? '\nFAILED:\n' + failures.join('\n') +
      '\n\nNothing after this point was sent. Fix and run again — ' +
      'the upsert makes a re-run safe.' : '');

  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}

  if (failures.length) throw new Error(failures[0]);
  return sent;
}

/** pull then push — this is the one to put on a trigger */
function syncCustomersToSupabase() {
  pullCustomers();
  return pushCustomersToSupabase();
}

/* ---------- verification [VT-DW-005] ---------- */

function customerSupabaseStatus() {
  const base = cmsbProp_(CMSB.URL_PROP).replace(/\/+$/, '');
  const key  = cmsbProp_(CMSB.KEY_PROP);

  const res = UrlFetchApp.fetch(
    base + '/rest/v1/' + CMSB.TABLE + '?select=contact_id&limit=1',
    { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
                 'Prefer': 'count=exact', 'Range': '0-0' },
      muteHttpExceptions: true });

  const range = res.getHeaders()['content-range'] ||
                res.getHeaders()['Content-Range'] || '?/?';
  const total = String(range).split('/')[1];

  const sh = cmSheet_();
  const n  = sh ? Math.max(0, sh.getLastRow() - 1) : 0;

  const msg = 'CUSTOMER MASTER → SUPABASE\n\n' +
    'sheet rows      : ' + n.toLocaleString() + '\n' +
    'supabase rows   : ' + total + '   (includes the synthetic Walk-in row)\n' +
    'http            : ' + res.getResponseCode();

  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}