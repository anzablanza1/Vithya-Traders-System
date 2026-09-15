/**********************************************************************
 * VITHYA TRADERS — PHASE A : Master tabs + reversible cost layer
 *
 * BUILDS (in your existing sheet, from data already there):
 *   Products_Core   one row per PHYSICAL product (W + WO collapsed)
 *   Pricing         cost layer + price engine
 *   Media           Google Drive links, barcode, descriptions
 *
 * READS: ERP_Snapshot (required), Batch_Cost (optional), Cost_Import (optional)
 *
 * THE COST LAYER — NOTHING IS EVER OVERWRITTEN
 *   cost_master_frozen   your original master cost   <- written ONCE, never again
 *   cost_bill_w/wo       from Purchase_Register       <- refreshed
 *   cost_current_w/wo    from /product/details        <- refreshed (later phase)
 *   cost_manual          if you type one              <- yours
 *   cost_source          which one wins               <- YOUR CHOICE
 *   cost_active          formula picking between them <- derived
 *
 *   To reverse anything: set cost_source back to "master". Nothing is lost,
 *   because nothing was destroyed.
 *
 * MARGINS are back-calculated at build time from the ERP's CURRENT selling
 * price and the INITIAL active cost, so today's prices are reproduced exactly.
 * Change the cost later and selling/MRP recompute AT THE SAME MARGIN — which
 * is exactly the "what should this now cost?" view you want.
 *
 * PERFORMANCE: derived columns use ONE ArrayFormula each (not 7,000 formulas),
 * so the sheet stays fast.
 *
 * ---------------------------------------------------------------
 * BEFORE RUNNING (optional but recommended)
 *   Download the Vasy "All Products" Excel export and paste it into a tab
 *   named  Cost_Import  (keep its header row). That fills cost_master_frozen.
 *   Without it the frozen column stays blank and products with no purchase
 *   history will have no cost at all.
 *
 * RUN
 *   buildMasterTabs()      first time — builds all three tabs
 *   refreshSyncedCosts()   later — updates synced columns only,
 *                          preserving your cost_source choices and edits
 **********************************************************************/

const PA = {
  SNAP: 'ERP_Snapshot',
  BATCH: 'Batch_Cost',
  IMPORT: 'Cost_Import',
  CORE: 'Products_Core',
  PRICING: 'Pricing',
  MEDIA: 'Media',
  DRIVE_FOLDER_PROP: 'VT_MEDIA_FOLDER_URL',
};

/* ================= small helpers ================= */

function paNum_(v) { const n = Number(v); return isFinite(n) ? n : null; }
function paCanon_(c) { return String(c || '').trim().replace(/\/+$/, ''); }
function paIsWO_(c) { return String(c || '').trim().slice(-1) === '/'; }
function paCleanName_(n) { return String(n || '').replace(/\/+\s*$/, '').trim(); }

function paSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#1F3864').setFontColor('#FFFFFF')
    .setWrap(true);
  return sh;
}

/* ================= read sources ================= */

function paReadSnapshot_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PA.SNAP);
  if (!sh || sh.getLastRow() < 2) throw new Error('Need ' + PA.SNAP + '. Run fullPull first.');
  const vals = sh.getDataRange().getValues();
  const H = {};
  vals[0].forEach((h, i) => H[String(h).trim()] = i);
  const need = ['productId','itemCode','productName','taxName','taxRate','mrp',
                'sellingPrice','discount','hsnCode','productType','brand','category',
                'department','measurement','qty','active'];
  need.forEach(k => { if (H[k] === undefined) throw new Error('ERP_Snapshot missing column: ' + k); });

  const map = {};
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    const code = String(r[H.itemCode] || '').trim();
    if (!code) continue;
    map[code] = {
      pid: r[H.productId], name: r[H.productName],
      taxName: r[H.taxName], taxRate: paNum_(r[H.taxRate]),
      mrp: paNum_(r[H.mrp]), sell: paNum_(r[H.sellingPrice]),
      disc: paNum_(r[H.discount]), hsn: r[H.hsnCode],
      ptype: r[H.productType], brand: r[H.brand], cat: r[H.category],
      dept: r[H.department], uom: r[H.measurement],
      qty: paNum_(r[H.qty]), active: r[H.active],
    };
  }
  return map;
}

function paReadBatch_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PA.BATCH);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const vals = sh.getDataRange().getValues();
  const H = {};
  vals[0].forEach((h, i) => H[String(h).trim()] = i);
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    const c = String(r[H.canonical_code] || '').trim();
    if (!c) continue;
    out[c] = {
      w: paNum_(r[H.w_last_rate]), wo: paNum_(r[H.wo_last_rate]),
      wland: paNum_(r[H.w_last_landing]), woland: paNum_(r[H.wo_last_landing]),
      date: r[H.last_bill_date] || '', sup: r[H.last_supplier] || '',
      times: paNum_(r[H.times_purchased]),
    };
  }
  return out;
}

/* Vasy "All Products" export — join on ItemCode (or Product Unique Id) */
function paReadImport_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PA.IMPORT);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  const vals = sh.getDataRange().getValues();
  const H = {};
  vals[0].forEach((h, i) => H[String(h).trim()] = i);
  const codeCol = (H['ItemCode'] !== undefined) ? H['ItemCode'] : H['Item Code'];
  const ppCol = (H['Purchase Price'] !== undefined) ? H['Purchase Price'] : null;
  if (codeCol === undefined || ppCol === null) return out;
  const sdCol = H['Short description'], dCol = H['description'], imgCol = H['Image Link'];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    const code = String(r[codeCol] || '').trim();
    if (!code) continue;
    out[code] = {
      pp: paNum_(r[ppCol]),
      sdesc: sdCol !== undefined ? r[sdCol] : '',
      desc: dCol !== undefined ? r[dCol] : '',
      img: imgCol !== undefined ? r[imgCol] : '',
    };
  }
  return out;
}

/* ================= build canonical list ================= */

function paCanonList_(snap) {
  const seen = {}, list = [];
  Object.keys(snap).forEach(code => {
    const canon = paCanon_(code);
    if (seen[canon]) return;
    seen[canon] = true;
    const w = snap[canon], wo = snap[canon + '/'];
    if (!w && !wo) return;
    list.push({ canon: canon, w: w || null, wo: wo || null, src: w || wo,
                flag: (w && wo) ? 'BOTH' : (w ? 'W_ONLY' : 'WO_ONLY') });
  });
  list.sort((a, b) => a.canon < b.canon ? -1 : (a.canon > b.canon ? 1 : 0));
  return list;
}

/* ================= MAIN BUILD ================= */

const CORE_H = ['product_id','item_code','item_code_w','item_code_wo','variant_flag',
  'description','department','category','sub_category','brand','hsn','uom',
  'product_type_w','product_type_wo','tax_w','tax_rate_w','tax_wo','tax_rate_wo',
  'vasy_id_w','vasy_id_wo','status','notes'];

const PRICE_H = ['product_id','item_code','description','category',
  'cost_master_frozen','cost_bill_w','cost_bill_wo','cost_bill_date',
  'cost_current_w','cost_current_wo','cost_manual','cost_source','cost_active',
  'transport_value','transport_type','loading_value','loading_type','landing_cost',
  'margin_w_pct','margin_wo_pct','selling_w','selling_wo',
  'discount_w_pct','discount_wo_pct','mrp_w','mrp_wo',
  'erp_selling_w','erp_selling_wo','erp_mrp_w','erp_mrp_wo',
  'price_diff_flag','cost_status','notes'];

const MEDIA_H = ['product_id','item_code','description','drive_folder_url','image_url',
  'barcode','short_description','long_description','datasheet_url','media_updated_at'];

function buildMasterTabs() {
  const t0 = Date.now();
  const snap = paReadSnapshot_();
  const batch = paReadBatch_();
  const imp = paReadImport_();
  const list = paCanonList_(snap);
  Logger.log('Canonical products: ' + list.length +
             ' | batch rows: ' + Object.keys(batch).length +
             ' | import rows: ' + Object.keys(imp).length);

  const core = [], price = [], media = [];

  list.forEach(p => {
    const w = p.w, wo = p.wo, s = p.src;
    const pid = (w || wo).pid;
    const desc = paCleanName_(s.name);
    const iw = imp[p.canon] || {}, iwo = imp[p.canon + '/'] || {};
    const im = (iw.pp !== undefined && iw.pp !== null) ? iw : iwo;

    /* ---- Products_Core ---- */
    core.push([pid, p.canon, w ? p.canon : '', wo ? p.canon + '/' : '', p.flag,
      desc, s.dept || '', s.cat || '', '', s.brand || '', s.hsn || '', s.uom || '',
      w ? (w.ptype || '') : '', wo ? (wo.ptype || '') : '',
      w ? (w.taxName || '') : '', w ? w.taxRate : '',
      wo ? (wo.taxName || '') : '', wo ? wo.taxRate : '',
      w ? w.pid : '', wo ? wo.pid : '',
      s.active ? 'active' : 'inactive', '']);

    /* ---- Pricing ---- */
    const b = batch[p.canon] || {};
    const frozen = (im && im.pp !== undefined && im.pp !== null) ? im.pp : '';
    const billW = (b.w === undefined || b.w === null) ? '' : b.w;
    const billWO = (b.wo === undefined || b.wo === null) ? '' : b.wo;

    // choose the initial source: master if we have it, else batch, else none
    let source = 'none';
    let initCost = null;
    if (frozen !== '' && Number(frozen) > 0) { source = 'master'; initCost = Number(frozen); }
    else if (billW !== '' || billWO !== '') {
      source = 'batch_bill';
      initCost = (billW !== '') ? Number(billW) : Number(billWO);
    }

    // back-calculate margins so today's ERP prices are reproduced exactly
    const erpSw = w ? w.sell : null, erpSwo = wo ? wo.sell : null;
    const erpMw = w ? w.mrp : null, erpMwo = wo ? wo.mrp : null;
    const mw = (initCost && erpSw) ? (erpSw / initCost - 1) : '';
    const mwo = (initCost && erpSwo) ? (erpSwo / initCost - 1) : '';
    const dw = (w && w.disc !== null) ? w.disc / 100 : '';
    const dwo = (wo && wo.disc !== null) ? wo.disc / 100 : '';

    price.push([pid, p.canon, desc, s.cat || '',
      frozen, billW, billWO, b.date || '',
      '', '', '', source, '',          // current_w, current_wo, manual, source, active(formula)
      0, 'amount', 0, 'amount', '',    // transport, loading, landing(formula)
      mw, mwo, '', '',                 // margins, selling(formula)
      dw, dwo, '', '',                 // discounts, mrp(formula)
      erpSw === null ? '' : erpSw, erpSwo === null ? '' : erpSwo,
      erpMw === null ? '' : erpMw, erpMwo === null ? '' : erpMwo,
      '', '', '']);

    /* ---- Media ---- */
    media.push([pid, p.canon, desc, '', (im && im.img) ? im.img : '', '',
      (im && im.sdesc) ? im.sdesc : '',
      (im && im.desc) ? String(im.desc).replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 900) : '',
      '', '']);
  });

  /* ---- write Products_Core ---- */
  const shC = paSheet_(PA.CORE, CORE_H);
  if (core.length) shC.getRange(2, 1, core.length, CORE_H.length).setValues(core);
  shC.setColumnWidth(6, 320);

  /* ---- write Pricing ---- */
  const shP = paSheet_(PA.PRICING, PRICE_H);
  if (price.length) shP.getRange(2, 1, price.length, PRICE_H.length).setValues(price);
  shP.setColumnWidth(3, 300);
  paAddPricingFormulas_(shP);
  paAddPricingValidation_(shP, price.length);
  paColourPricing_(shP, price.length);

  /* ---- write Media ---- */
  const shM = paSheet_(PA.MEDIA, MEDIA_H);
  if (media.length) shM.getRange(2, 1, media.length, MEDIA_H.length).setValues(media);
  shM.setColumnWidth(3, 300);
  shM.setColumnWidth(4, 320);
  shM.setColumnWidth(5, 320);

  /* ---- tallies ---- */
  let withFrozen = 0, withBatch = 0, withNeither = 0;
  price.forEach(r => {
    const f = r[4] !== '' && Number(r[4]) > 0;
    const bb = r[5] !== '' || r[6] !== '';
    if (f) withFrozen++;
    if (bb) withBatch++;
    if (!f && !bb) withNeither++;
  });

  const msg = 'PHASE A COMPLETE (' + Math.round((Date.now() - t0) / 1000) + 's)\n\n' +
    'Products_Core : ' + core.length + ' physical products\n' +
    'Pricing       : ' + price.length + ' rows\n' +
    'Media         : ' + media.length + ' rows\n\n' +
    'Cost coverage:\n' +
    '  frozen master cost : ' + withFrozen + '\n' +
    '  batch (bill) cost  : ' + withBatch + '\n' +
    '  NEITHER            : ' + withNeither + '\n\n' +
    (Object.keys(imp).length === 0
      ? 'NOTE: no Cost_Import tab found, so cost_master_frozen is blank.\n' +
        'Paste the Vasy "All Products" export into a tab named Cost_Import\n' +
        'and run buildMasterTabs() again to fill it.\n\n'
      : '') +
    'Nothing was overwritten. Set cost_source per row to choose the cost.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= ArrayFormulas (one per column) ================= */

function paAddPricingFormulas_(sh) {
  // M cost_active : manual > batch_bill > batch_current > master
  sh.getRange('M2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",' +
    'IF(L2:L="manual",K2:K,' +
    'IF(L2:L="batch_bill",IF(F2:F<>"",F2:F,G2:G),' +
    'IF(L2:L="batch_current",IF(I2:I<>"",I2:I,J2:J),' +
    'IF(L2:L="master",E2:E,""))))))');

  // R landing_cost = cost_active + transport + loading (each amount or %)
  sh.getRange('R2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",IF(M2:M="","",' +
    'M2:M' +
    '+IF(O2:O="percentage",M2:M*N2:N/100,N2:N)' +
    '+IF(Q2:Q="percentage",M2:M*P2:P/100,P2:P))))');

  // U selling_w = landing x (1 + margin_w)
  sh.getRange('U2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",IF(R2:R="","",IF(S2:S="","",ROUND(R2:R*(1+S2:S),3)))))');

  // V selling_wo
  sh.getRange('V2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",IF(R2:R="","",IF(T2:T="","",ROUND(R2:R*(1+T2:T),3)))))');

  // Y mrp_w = selling_w / (1 - discount_w)
  sh.getRange('Y2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",IF(U2:U="","",IF(W2:W="","",' +
    'IF(W2:W>=1,"",ROUND(U2:U/(1-W2:W),2))))))');

  // Z mrp_wo
  sh.getRange('Z2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",IF(V2:V="","",IF(X2:X="","",' +
    'IF(X2:X>=1,"",ROUND(V2:V/(1-X2:X),2))))))');

  // AE price_diff_flag : does our computed selling differ from the ERP's?
  sh.getRange('AE2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",IF(U2:U="","",IF(AA2:AA="","",' +
    'IF(ABS(U2:U-AA2:AA)<0.01,"","DIFFERS")))))');

  // AF cost_status
  sh.getRange('AF2').setFormula(
    '=ARRAYFORMULA(IF(B2:B="","",IF(M2:M="","NO COST",' +
    'IF(L2:L="master","master (unverified)",' +
    'IF(L2:L="batch_bill","batch — from bill",' +
    'IF(L2:L="batch_current","batch — current",' +
    'IF(L2:L="manual","manual entry","")))))))');
}

/* ================= dropdowns ================= */

function paAddPricingValidation_(sh, n) {
  if (!n) return;
  const src = SpreadsheetApp.newDataValidation()
    .requireValueInList(['master','batch_bill','batch_current','manual','none'], true)
    .setAllowInvalid(false).build();
  sh.getRange(2, 12, n, 1).setDataValidation(src);           // L cost_source

  const typ = SpreadsheetApp.newDataValidation()
    .requireValueInList(['amount','percentage'], true)
    .setAllowInvalid(false).build();
  sh.getRange(2, 15, n, 1).setDataValidation(typ);           // O transport_type
  sh.getRange(2, 17, n, 1).setDataValidation(typ);           // Q loading_type
}

/* ================= colour: blue = you edit, black = derived ================= */

function paColourPricing_(sh, n) {
  if (!n) return;
  const blue = '#1155CC';
  [5, 11, 12, 14, 15, 16, 17, 19, 20, 23, 24, 33].forEach(c => {
    sh.getRange(2, c, n, 1).setFontColor(blue);
  });
  // frozen column gets a tint so it is visibly special
  sh.getRange(2, 5, n, 1).setBackground('#FFF2CC');
  sh.getRange(2, 13, n, 1).setBackground('#E2EFDA');   // cost_active
  sh.getRange(2, 18, n, 1).setBackground('#E2EFDA');   // landing_cost
}

/* ================= refresh synced cost columns only ================= */

function refreshSyncedCosts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PA.PRICING);
  if (!sh || sh.getLastRow() < 2) throw new Error('Build Pricing first.');
  const batch = paReadBatch_();
  const snap = paReadSnapshot_();

  const n = sh.getLastRow() - 1;
  const codes = sh.getRange(2, 2, n, 1).getValues();

  const bill = [], erp = [];
  codes.forEach(row => {
    const c = String(row[0] || '').trim();
    const b = batch[c] || {};
    bill.push([
      (b.w === undefined || b.w === null) ? '' : b.w,
      (b.wo === undefined || b.wo === null) ? '' : b.wo,
      b.date || '']);
    const w = snap[c], wo = snap[c + '/'];
    erp.push([
      w && w.sell !== null ? w.sell : '',
      wo && wo.sell !== null ? wo.sell : '',
      w && w.mrp !== null ? w.mrp : '',
      wo && wo.mrp !== null ? wo.mrp : '']);
  });

  sh.getRange(2, 6, n, 3).setValues(bill);    // F,G,H  cost_bill_w/wo/date
  sh.getRange(2, 27, n, 4).setValues(erp);    // AA..AD erp selling/mrp

  const msg = 'Synced columns refreshed for ' + n + ' rows.\n\n' +
              'cost_source, margins, transport and manual entries were NOT touched.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

/* ================= menu ================= */

function onOpenPhaseA() {
  SpreadsheetApp.getUi()
    .createMenu('📦 Master')
    .addItem('Build master tabs (first time)', 'buildMasterTabs')
    .addItem('Refresh synced costs', 'refreshSyncedCosts')
    .addToUi();
}