/**********************************************************************
 * VITHYA TRADERS — RECONCILIATION API                   [VT-052]
 *
 * Globals declared here (check before pasting):
 *   RCA, doGetRecon, rcaRows, rcaInvoices, rcaSave, rcaSummary,
 *   rcaGet_, rcaPatch_, rcaProp_, rcaCache_, rcaInvalidate
 *
 * ── WHAT IT IS ──
 *   The back end for the reconciliation screen. Reads Supabase, writes ONLY
 *   customer_opening_balance — the sign-off table. Never touches an invoice,
 *   never touches sales_data.
 *
 * ── WHY IT GOES THROUGH APPS SCRIPT ──
 *   The service key can delete every table, so it cannot live in a browser.
 *   This holds the key server-side and hands the page only what it asked
 *   for. Decided as VT-050.
 *
 * ── SPEED ──
 *   687 customers is small. The whole list is fetched once, cached for ten
 *   minutes, and the page filters locally — so every click after the first
 *   is instant. The cache is dropped the moment anything is saved.
 *
 * ── SETUP ──
 *   Script Properties: SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   Deploy > New deployment > Web app > Execute as ME > Access: Anyone
 *
 * ── RUN ──
 *   rcaSummary()   check it can reach Supabase before deploying
 **********************************************************************/

const RCA = {
  URL_PROP: 'SUPABASE_URL',
  KEY_PROP: 'SUPABASE_SERVICE_KEY',
  CACHE_KEY: 'RCA_ROWS_V1',
  CACHE_SEC: 600,
};

function rcaProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function rcaGet_(path) {
  const res = UrlFetchApp.fetch(
    rcaProp_(RCA.URL_PROP).replace(/\/+$/, '') + '/rest/v1/' + path,
    { headers: { 'apikey': rcaProp_(RCA.KEY_PROP),
                 'Authorization': 'Bearer ' + rcaProp_(RCA.KEY_PROP) },
      muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('HTTP ' + res.getResponseCode() + ' on ' + path +
      '\n' + res.getContentText().slice(0, 250));
  }
  return JSON.parse(res.getContentText());
}

/** upsert one row into the sign-off table */
function rcaPatch_(row) {
  const url = rcaProp_(RCA.URL_PROP).replace(/\/+$/, '') +
    '/rest/v1/customer_opening_balance?on_conflict=customer_name';
  const key = rcaProp_(RCA.KEY_PROP);
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key,
               'Prefer': 'resolution=merge-duplicates,return=minimal' },
    payload: JSON.stringify([row]), muteHttpExceptions: true });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error('Save failed: HTTP ' + res.getResponseCode() + '  ' +
      res.getContentText().slice(0, 250));
  }
  return true;
}

function rcaInvalidate() {
  try { CacheService.getScriptCache().remove(RCA.CACHE_KEY); } catch (e) {}
}

/** the whole list, cached — 687 rows is nothing, so send it all at once */
function rcaRows() {
  const c = CacheService.getScriptCache();
  const hit = c.get(RCA.CACHE_KEY);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) {}
  }
  const rows = rcaGet_('v_reconciliation?select=*&order=to_write_off.desc&limit=2000');
  const out = rows.filter(function (r) {
    /* a customer with nothing on either side is not part of this exercise */
    return Math.abs(Number(r.ledger_closing) || 0) > 0.5
        || Math.abs(Number(r.invoice_outstanding) || 0) > 0.5;
  });
  try { c.put(RCA.CACHE_KEY, JSON.stringify(out), RCA.CACHE_SEC); }
  catch (e) { /* over 100KB — the page still works, just uncached */ }
  return out;
}

/**
 * The full ledger for one customer: EVERY invoice (open and closed) plus
 * EVERY receipt and what it was applied to. This is what lets you decide a
 * write-off safely — you can see the closed ones and the on-account money,
 * not just the open balance.
 */
function rcaInvoices(customer) {
  const q = encodeURIComponent(String(customer || ''));
  const invoices = rcaGet_('v_customer_invoices?customer=eq.' + q +
    '&select=sales_id,invoice_no,order_no,sales_date,age_days,inv_type,' +
    'payment_type,total,paid_amount,balance,status,period,receipts,' +
    'receipted_here&order=sales_date&limit=2000');
  const receipts = rcaGet_('v_customer_receipts?customer=eq.' + q +
    '&select=receipt_no,mode,receipt_date,amount,split_receipt,invoices_named,' +
    'against_invoices,applied_to&order=receipt_date&limit=2000');
  return { invoices: invoices, receipts: receipts };
}

/**
 * Record a decision.
 *
 * Writes ONLY to customer_opening_balance. Nothing here closes an invoice in
 * Vasy — that stays a human action, because a write-off is an accounting
 * decision and this tool has no business making it.
 */
function rcaSave(p) {
  if (!p || !p.customer) throw new Error('No customer given.');
  const ok = ['NOT CHECKED', 'CONFIRMED WITH CUSTOMER', 'DISPUTED', 'WRITTEN OFF'];
  if (ok.indexOf(p.status) < 0) {
    throw new Error('Unknown status: ' + p.status);
  }
  const row = {
    customer_name: String(p.customer),
    as_at: '2026-04-01',
    opening_agreed: (p.opening === '' || p.opening === null ||
                     p.opening === undefined) ? null : Number(p.opening),
    opening_per_vasy: (p.perVasy === '' || p.perVasy === null ||
                       p.perVasy === undefined) ? null : Number(p.perVasy),
    status: p.status,
    verified_by: p.by ? String(p.by) : null,
    verified_on: p.on ? String(p.on) :
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    method: p.method ? String(p.method) : null,
    note: p.note ? String(p.note) : null,
    updated_at: new Date().toISOString(),
  };
  rcaPatch_(row);
  rcaInvalidate();
  return { ok: true, customer: row.customer_name, status: row.status };
}

function rcaSummary() {
  const s = rcaGet_('v_reconciliation_summary?select=*&order=next_step');
  Logger.log(JSON.stringify(s, null, 2));
  try {
    const L = ['RECONCILIATION', ''];
    s.forEach(function (r) {
      L.push(r.next_step);
      L.push('   ' + Number(r.customers).toLocaleString() + ' customers, ' +
        Number(r.to_close || 0).toLocaleString() + ' to close');
    });
    SpreadsheetApp.getUi().alert(L.join('\n'));
  } catch (e) {}
  return s;
}

/* ---------- the page ---------- */

/**
 * Serves the page AND answers data calls.
 *
 * The first version only served the HTML, which assumed the page would be
 * opened from the /exec URL so google.script.run existed. Opened as a local
 * file that function is not there, so every call hung and the screen loaded
 * for ever with nothing to click.
 *
 * Now:
 *   /exec                    -> the page, as before
 *   /exec?action=rows&...    -> JSONP, so the file also works locally
 *
 * Same as the floor and office apps, so all three behave alike.
 */
function doGetRecon(e) {
  const p = (e && e.parameter) ? e.parameter : {};

  if (!p.action) {
    return HtmlService.createHtmlOutputFromFile('VT_Recon')
      .setTitle('Vithya Traders — Reconciliation')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  let body;
  try {
    let d;
    switch (p.action) {
      case 'rows':     d = rcaRows(); break;
      case 'invoices': d = rcaInvoices(p.customer || p.arg || ''); break;
      case 'summary':  d = rcaSummary(); break;
      case 'save':     d = rcaSave({
                         customer: p.customer, status: p.status,
                         opening: p.opening, perVasy: p.perVasy,
                         by: p.by, on: p.on, method: p.method, note: p.note });
                       break;
      default: throw new Error('Unknown action: ' + p.action);
    }
    body = { ok: true, data: d };
  } catch (err) {
    body = { ok: false, error: String(err && err.message ? err.message : err) };
  }

  const txt = p.callback
    ? p.callback + '(' + JSON.stringify(body) + ');'
    : JSON.stringify(body);
  return ContentService.createTextOutput(txt).setMimeType(
    p.callback ? ContentService.MimeType.JAVASCRIPT
               : ContentService.MimeType.JSON);
}