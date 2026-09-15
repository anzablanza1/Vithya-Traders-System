/**********************************************************************
 * VITHYA TRADERS — Dash_Data builder  v2
 *
 * WHY v2
 *   The old builder read column names that the price-model restructure
 *   renamed or replaced (cost_active, margin_w_pct, master_sell_w …).
 *   It found nothing, wrote blanks, and the dashboard showed empty price
 *   columns while the text columns looked fine.
 *
 *   v2 reads the CURRENT Pricing columns and writes Dash_Data with exactly
 *   the field names the dashboard API expects — so the two can never drift
 *   apart silently again. If a column is missing it is reported by name at
 *   the end of the run instead of failing quietly.
 *
 * SOURCES
 *   Pricing        costs, charges, margins, prices, flags   (most fields)
 *   Products_Core  brand, variant_flag, description
 *   ERP_Snapshot   what Vasy currently shows + stock qty
 *   Batch_Cost     last purchase date
 *
 * RUN buildDashboardData() after any refresh. It also clears the dashboard
 * cache so the web app picks the new data up immediately.
 **********************************************************************/

const DBX = {
  CORE: 'Products_Core',
  PRICING: 'Pricing',
  ERP: 'ERP_Snapshot',
  BATCH: 'Batch_Cost',
  MEDIA: 'Media',
  DATA: 'Dash_Data',
};

/* must match AP_FIELDS in DashboardAPI_v2.gs, with product_id first */
const DBX_COLS = ['product_id',
  'item_code','description','category','brand','variant_flag',
  'cost_source','gst_rate',
  'cost_w_exGST','cost_w_incGST','cost_wo',
  'transport_w_value','transport_w_type','packing_w_value','packing_w_type',
  'transport_wo_value','transport_wo_type','packing_wo_value','packing_wo_type',
  'wo_rate_increase','wo_price_mode','wo_margin_increase',
  'loaded_cost_w','loaded_cost_wo',
  'selling_w_incGST','selling_w_exGST','selling_wo',
  'true_margin_w','true_margin_wo','vasy_margin_w','vasy_margin_wo',
  'discount_w_pct','discount_wo_pct','mrp_w','mrp_wo',
  'wh_disc_w','wh_disc_wo','rt_disc_w','rt_disc_wo',
  'wh_price_w','wh_price_wo','rt_price_w','rt_price_wo',
  'buy_w_sell_wo','buy_wo_sell_w','cross_gain_w_to_wo','cross_gain_wo_to_w',
  'buy_lane','eff_cost_w','eff_cost_wo','margin_flag','wo_cost_basis',
  'image_url','image_url_2','image_url_3','barcode','short_description','long_description',
  'erp_sell_w','erp_sell_wo','erp_qty_w','erp_qty_wo','last_bill_date'];

/* fields taken straight from Pricing under the same name */
const DBX_FROM_PRICING = ['cost_source','gst_rate','cost_w_exGST','cost_w_incGST','cost_wo',
  'transport_w_value','transport_w_type','packing_w_value','packing_w_type',
  'transport_wo_value','transport_wo_type','packing_wo_value','packing_wo_type',
  'wo_rate_increase','wo_price_mode','wo_margin_increase',
  'loaded_cost_w','loaded_cost_wo','selling_w_incGST','selling_w_exGST','selling_wo',
  'true_margin_w','true_margin_wo','vasy_margin_w','vasy_margin_wo',
  'discount_w_pct','discount_wo_pct','mrp_w','mrp_wo',
  'wh_disc_w','wh_disc_wo','rt_disc_w','rt_disc_wo',
  'wh_price_w','wh_price_wo','rt_price_w','rt_price_wo',
  'buy_w_sell_wo','buy_wo_sell_w','cross_gain_w_to_wo','cross_gain_wo_to_w',
  'buy_lane','eff_cost_w','eff_cost_wo','margin_flag','wo_cost_basis'];

/* image_url may hold several links separated by , ; | or newline */
function dbxImg_(s, i) {
  if (!s) return '';
  const parts = String(s).split(/[\n,;|]+/).map(x => x.trim()).filter(Boolean);
  return parts[i] || '';
}

function dbxNum_(v) { const n = Number(v); return isFinite(n) ? n : ''; }
function dbxDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v);
}
function dbxVal_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return dbxDate_(v);
  return v;
}

function dbxHeaderRow_(sh, key) {
  const top = sh.getRange(1, 1, Math.min(6, sh.getLastRow()), sh.getLastColumn()).getValues();
  for (let r = 0; r < top.length; r++) {
    for (let c = 0; c < top[r].length; c++) {
      if (String(top[r][c]).trim() === key) return r + 1;
    }
  }
  throw new Error(sh.getName() + ': header "' + key + '" not found');
}

function dbxRead_(name, key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return { rows: [], H: {} };
  const hRow = dbxHeaderRow_(sh, key);
  const all = sh.getRange(hRow, 1, sh.getLastRow() - hRow + 1, sh.getLastColumn()).getValues();
  const H = {};
  all[0].forEach((h, i) => { const k = String(h).trim(); if (k) H[k] = i; });
  return { rows: all.slice(1), H: H };
}

function buildDashboardData() {
  const t0 = Date.now();
  const core = dbxRead_(DBX.CORE, 'product_id');
  const pricing = dbxRead_(DBX.PRICING, 'product_id');
  const erp = dbxRead_(DBX.ERP, 'itemCode');
  const batch = dbxRead_(DBX.BATCH, 'canonical_code');
  const media = dbxRead_(DBX.MEDIA, 'product_id');

  if (!core.rows.length) throw new Error('Products_Core is empty.');
  if (!pricing.rows.length) throw new Error('Pricing is empty.');

  const PH = pricing.H;
  const missing = DBX_FROM_PRICING.filter(f => PH[f] === undefined);

  /* index Pricing by item_code */
  const priMap = {};
  pricing.rows.forEach(r => {
    const c = String(r[PH.item_code] || '').trim();
    if (c) priMap[c] = r;
  });

  /* index ERP by itemCode */
  const erpMap = {};
  erp.rows.forEach(r => {
    const c = String(r[erp.H.itemCode] || '').trim();
    if (c) erpMap[c] = { sell: dbxNum_(r[erp.H.sellingPrice]), qty: dbxNum_(r[erp.H.qty]) };
  });

  /* index Media by item_code */
  const medMap = {};
  media.rows.forEach(r => {
    const c = String(r[media.H.item_code] || '').trim();
    if (!c) return;
    medMap[c] = {
      img: String(r[media.H.image_url] || '').trim(),
      bar: String(r[media.H.barcode] || '').trim(),
      sd: String(r[media.H.short_description] || '').trim(),
      ld: String(r[media.H.long_description] || '').trim(),
    };
  });

  /* index Batch_Cost by canonical */
  const batMap = {};
  batch.rows.forEach(r => {
    const c = String(r[batch.H.canonical_code] || '').trim();
    if (c) batMap[c] = dbxDate_(r[batch.H.last_bill_date]);
  });

  const out = [];
  core.rows.forEach(r => {
    const pid = String(r[core.H.product_id] || '').trim();
    const canon = String(r[core.H.item_code] || '').trim();
    if (!canon) return;
    const codeW = String(r[core.H.item_code_w] || '').trim();
    const codeWO = String(r[core.H.item_code_wo] || '').trim();
    const p = priMap[canon] || [];
    const g = f => (PH[f] !== undefined && p[PH[f]] !== undefined) ? dbxVal_(p[PH[f]]) : '';

    const eW = erpMap[codeW] || {}, eWO = erpMap[codeWO] || {};

    const row = [];
    DBX_COLS.forEach(f => {
      switch (f) {
        case 'product_id':   row.push(pid); break;
        case 'item_code':    row.push(canon); break;
        case 'description':  row.push(String(r[core.H.description] || '')); break;
        case 'category':     row.push(r[core.H.category] || ''); break;
        case 'brand':        row.push(r[core.H.brand] || ''); break;
        case 'variant_flag': row.push(r[core.H.variant_flag] || ''); break;
        case 'erp_sell_w':   row.push(eW.sell === undefined ? '' : eW.sell); break;
        case 'erp_sell_wo':  row.push(eWO.sell === undefined ? '' : eWO.sell); break;
        case 'erp_qty_w':    row.push(eW.qty === undefined ? '' : eW.qty); break;
        case 'erp_qty_wo':   row.push(eWO.qty === undefined ? '' : eWO.qty); break;
        case 'image_url': {
          const m = medMap[canon] || {};
          row.push(dbxImg_(m.img, 0)); break;
        }
        case 'image_url_2': { const m = medMap[canon] || {}; row.push(dbxImg_(m.img, 1)); break; }
        case 'image_url_3': { const m = medMap[canon] || {}; row.push(dbxImg_(m.img, 2)); break; }
        case 'barcode': row.push((medMap[canon] || {}).bar || ''); break;
        case 'short_description': row.push((medMap[canon] || {}).sd || ''); break;
        case 'long_description': row.push((medMap[canon] || {}).ld || ''); break;
        case 'last_bill_date': row.push(batMap[canon] || ''); break;
        default:             row.push(g(f));
      }
    });
    out.push(row);
  });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(DBX.DATA);
  if (!sh) sh = ss.insertSheet(DBX.DATA);
  sh.clear();
  sh.getRange(1, 1, 1, DBX_COLS.length).setValues([DBX_COLS]);
  if (out.length) sh.getRange(2, 1, out.length, DBX_COLS.length).setValues(out);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, DBX_COLS.length).setFontWeight('bold')
    .setBackground('#1F3864').setFontColor('#FFFFFF');

  try { apClearCache_(); } catch (e) {}

  /* how much actually landed? */
  const probe = ['cost_w_exGST','loaded_cost_w','selling_w','true_margin_w','mrp_w'];
  const ix = {}; DBX_COLS.forEach((c, i) => ix[c] = i);
  const fill = {};
  probe.forEach(f => {
    fill[f] = out.filter(r => r[ix[f]] !== '' && r[ix[f]] !== null).length;
  });

  const msg = 'Dash_Data rebuilt: ' + out.length + ' products in ' +
    Math.round((Date.now() - t0) / 1000) + 's.\n\n' +
    'Filled:\n' + probe.map(f => '   ' + f + ': ' + fill[f]).join('\n') +
    (missing.length ? '\n\nMISSING from Pricing (will be blank):\n   ' + missing.join('\n   ') : '') +
    '\n\nDashboard cache cleared.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return out.length;
}

function onOpenDataBuilder() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Dashboard')
    .addItem('Rebuild data (Dash_Data)', 'buildDashboardData')
    .addItem('Clear dashboard cache', 'apClearCacheMenu')
    .addItem('Show connection settings', 'apShowSetup')
    .addToUi();
}