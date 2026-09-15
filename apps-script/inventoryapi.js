/**********************************************************************
 * VITHYA TRADERS — INVENTORY DASHBOARD API              [VT-073]
 *
 * Globals declared here (check before pasting):
 *   INV_API, doGetInventory, invApiRows, invApiSummary, invApiProduct,
 *   invGet_, invProp_, inventoryApiCheck
 *
 * Serves the inventory dashboard and answers its JSONP calls, the same shape
 * as ReconAPI. Route it from the main doGet with:
 *     if (p.app === 'inventory') return doGetInventory(e);
 *
 * Reads v_inventory / v_inventory_summary from Supabase. Writes nothing.
 * Needs stock_live populated — run pushStockToSupabase first.
 **********************************************************************/

const INV_API = {
  URL_PROP: 'SUPABASE_URL',
  KEY_PROP: 'SUPABASE_SERVICE_KEY',
  PAGE: 1000,
  MAX_PAGES: 20,
};

function invProp_(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Missing Script Property: ' + k);
  return String(v).trim();
}

function invGet_(path) {
  const base = invProp_(INV_API.URL_PROP).replace(/\/+$/, '');
  const key = invProp_(INV_API.KEY_PROP);
  const out = [];
  for (let p = 0; p < INV_API.MAX_PAGES; p++) {
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    const res = UrlFetchApp.fetch(
      base + '/rest/v1/' + path + sep + 'limit=' + INV_API.PAGE +
      '&offset=' + (p * INV_API.PAGE),
      { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
        muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('HTTP ' + res.getResponseCode() + ' on ' + path +
        ' — ' + res.getContentText().slice(0, 200));
    }
    const arr = JSON.parse(res.getContentText());
    if (!arr.length) break;
    arr.forEach(function (r) { out.push(r); });
    if (arr.length < INV_API.PAGE) break;
  }
  return out;
}

function invApiSummary() {
  const s = invGet_('v_inventory_summary?select=*');
  return (s && s[0]) || {};
}

/** the whole product list — the browser filters and sorts locally, so one
    fetch and every click after is instant */
function invApiRows() {
  return invGet_('v_inventory?select=item_code,product_name,category,brand,' +
    'qty_w,qty_wo,qty_total,units_12m,revenue_12m,units_90d,days_since_sale,' +
    'daily_rate,days_cover,abc,xyz,flag&order=revenue_12m.desc');
}

function invApiProduct(code) {
  if (!code) throw new Error('Which product?');
  const rows = invGet_('v_inventory?item_code=eq.' +
    encodeURIComponent(code) + '&select=*');
  return (rows && rows[0]) || null;
}

function doGetInventory(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  if (!p.action) {
    return HtmlService.createHtmlOutputFromFile('VT_Inventory')
      .setTitle('Vithya Traders — Inventory')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  let body;
  try {
    let d;
    switch (p.action) {
      case 'summary': d = invApiSummary(); break;
      case 'rows':    d = invApiRows(); break;
      case 'product': d = invApiProduct(p.code || p.customer || ''); break;
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
    p.callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function inventoryApiCheck() {
  const L = ['INVENTORY API', ''];
  try {
    const s = invApiSummary();
    if (!s.products) {
      L.push('v_inventory is empty — run pushStockToSupabase() first,');
      L.push('then buildProductAnalytics so velocity is current.');
    } else {
      L.push('products : ' + s.products);
      L.push('in stock : ' + s.in_stock);
      L.push('dead     : ' + s.dead + '   excess: ' + s.excess +
             '   low: ' + s.low);
      L.push('stockout : ' + s.stockout + '   negative: ' + s.negative);
      L.push('12m revenue: ' + Number(s.revenue_12m || 0).toLocaleString());
    }
  } catch (e) { L.push('FAILED: ' + e.message); }
  const msg = L.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}